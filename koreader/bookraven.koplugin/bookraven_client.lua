--[[--
HTTP client for the BookRaven server's KOReader API (apps/api/src/routes/koreader.ts).

Signs in with HTTP Basic: the account email and an app password (Profile → Other apps). Requests
and answers are JSON. Every network call is wrapped in pcall and has a timeout, so a bad
connection ends in an error message, never a crash or a hang.

KOReader APIs used here (from its source; not run here, no KOReader was available when this was
written): socket.http (LuaSocket 3, which handles https through LuaSec), ltn12, mime.b64,
socketutil:set_timeout / reset_timeout and its *_TIMEOUT constants, and the json module.

@module bookraven_client
]]

local http = require("socket.http")
local logger = require("logger")
local ltn12 = require("ltn12")
local mime = require("mime")
local socket = require("socket")
local socketutil = require("socketutil")

-- KOReader ships a json module (used by the Wallabag plugin); rapidjson is the fallback.
local has_json, json = pcall(require, "json")
if not has_json then
    json = require("rapidjson")
end

local USER_AGENT = "BookRaven-KOReader/1.0"

-- Timeouts in seconds: (block, total). Sync answers are small; book files can be large.
local API_TIMEOUTS = { socketutil.LARGE_BLOCK_TIMEOUT or 10, socketutil.LARGE_TOTAL_TIMEOUT or 30 }
local FILE_TIMEOUTS = { socketutil.FILE_BLOCK_TIMEOUT or 15, socketutil.FILE_TOTAL_TIMEOUT or 600 }

local Client = {}
Client.__index = Client

--- A client for `server` (e.g. "https://books.example.com"), signed in as `email` with `password`.
function Client.new(server, email, password)
    local self = setmetatable({}, Client)
    self.server = (server or ""):gsub("%s+", ""):gsub("/+$", "")
    self.email = (email or ""):gsub("^%s+", ""):gsub("%s+$", "")
    self.password = password or ""
    return self
end

function Client:isConfigured()
    return self.server ~= "" and self.email ~= "" and self.password ~= ""
end

--- The full address of `path` ("/api/…"); addresses that already are full stay as they are.
function Client:url(path)
    if path:match("^https?://") then
        return path
    end
    return self.server .. path
end

function Client:headers()
    return {
        ["Authorization"] = "Basic " .. mime.b64(self.email .. ":" .. self.password),
        ["Accept"] = "application/json",
        ["User-Agent"] = USER_AGENT,
    }
end

--- Runs an http.request with timeouts. Returns the status code (a number) or nil and an error.
local function perform(request, timeouts)
    socketutil:set_timeout(timeouts[1], timeouts[2])
    local ok, code, _, status = pcall(function()
        return socket.skip(1, http.request(request))
    end)
    socketutil:reset_timeout()
    if not ok then
        logger.warn("BookRaven: request failed:", code)
        return nil, tostring(code)
    end
    if type(code) ~= "number" then
        -- LuaSocket returns the error message (e.g. "timeout", "connection refused") instead of a code.
        logger.warn("BookRaven: network error:", code, status)
        return nil, tostring(code or status or "network error")
    end
    return code
end

--[[--
Sends a JSON request. Returns `ok, status, body`: `body` is the decoded answer (a table) or nil;
`ok` is true for 2xx answers. On a network error, `status` is nil and `body` the message.
]]
function Client:request(method, path, body)
    local payload
    if body ~= nil then
        local encoded, result = pcall(json.encode, body)
        if not encoded then
            return false, nil, "could not encode the request: " .. tostring(result)
        end
        payload = result
    end
    local headers = self:headers()
    if payload then
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = tostring(#payload)
    end
    local sink = {}
    local code, err = perform({
        url = self:url(path),
        method = method,
        headers = headers,
        source = payload and ltn12.source.string(payload) or nil,
        sink = ltn12.sink.table(sink),
    }, API_TIMEOUTS)
    if not code then
        return false, nil, err
    end
    local text = table.concat(sink)
    local decoded
    if text ~= "" then
        local parsed, result = pcall(json.decode, text)
        if parsed and type(result) == "table" then
            decoded = result
        end
    end
    return code >= 200 and code < 300, code, decoded
end

--[[--
Downloads `path` into the file `dest`, through `dest .. ".part"` so a failed download never leaves
a broken book behind. Returns true, or false and a message.
]]
function Client:download(path, dest)
    local tmp = dest .. ".part"
    local file, open_err = io.open(tmp, "wb")
    if not file then
        return false, "could not write " .. tmp .. ": " .. tostring(open_err)
    end
    local code, err = perform({
        url = self:url(path),
        method = "GET",
        headers = self:headers(),
        -- ltn12.sink.file closes the file when the transfer ends.
        sink = ltn12.sink.file(file),
    }, FILE_TIMEOUTS)
    pcall(file.close, file) -- in case the transfer stopped before the end
    if code == 200 then
        os.remove(dest)
        local renamed, rename_err = os.rename(tmp, dest)
        if renamed then
            return true
        end
        os.remove(tmp)
        return false, tostring(rename_err)
    end
    os.remove(tmp)
    return false, err or ("HTTP " .. tostring(code))
end

return Client
