--[[--
Cover thumbnails for OPDS cards.

Each cover is downloaded once (with the catalog's credentials), shrunk to at most
MAX_W x MAX_H and saved as a small PNG in koreader/cache/bookraven-covers, so it shows
instantly next time, works offline, and serves every card size. Downloads are blocking,
so the cards view fetches one cover per UI tick.
]]

local DataStorage = require("datastorage")
local RenderImage = require("ui/renderimage")
local http = require("socket.http")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local ltn12 = require("ltn12")
local md5 = require("ffi/sha2").md5
local socket = require("socket")
local socketutil = require("socketutil")

local Covers = {
    dir = DataStorage:getDataDir() .. "/cache/bookraven-covers",
    max_files = 800, -- prune the oldest beyond this
    MAX_W = 600,
    MAX_H = 900,
    failed = {}, -- url -> true, so a broken cover is not retried on every page turn this session
}

local function ensureDir(dir)
    if lfs.attributes(dir, "mode") ~= "directory" then
        local parent = dir:match("^(.*)/[^/]+$")
        if parent and parent ~= "" then ensureDir(parent) end
        lfs.mkdir(dir)
    end
end

function Covers:path(url)
    return string.format("%s/%s.png", self.dir, md5(url))
end

--- Returns the cached thumbnail path for this url, or nil.
function Covers:cached(url)
    if not url then return nil end
    local p = self:path(url)
    if lfs.attributes(p, "mode") == "file" then
        return p
    end
end

local function download(url, username, password)
    local sink = {}
    socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    local ok, code, headers = pcall(function()
        return socket.skip(1, http.request{
            url = url,
            method = "GET",
            headers = {
                ["Accept-Encoding"] = "identity",
                ["Accept"] = "image/*",
            },
            sink = ltn12.sink.table(sink),
            user = username,
            password = password,
        })
    end)
    socketutil:reset_timeout()
    if not ok then
        logger.warn("BookRaven: cover request failed", url, code)
        return nil
    end
    if code ~= 200 then -- a status, or the error message on a network failure
        logger.dbg("BookRaven: cover request", url, code)
        return nil
    end
    local data = table.concat(sink)
    if data == "" then return nil end
    return data
end

--- Fits (iw, ih) inside (w, h) keeping the aspect ratio.
function Covers.fit(iw, ih, w, h)
    local scale = math.min(w / iw, h / ih)
    return math.max(1, math.floor(iw * scale + 0.5)), math.max(1, math.floor(ih * scale + 0.5))
end

--- Downloads, shrinks and caches one cover. Returns the thumbnail path, or nil.
function Covers:fetch(url, username, password)
    if not url then return nil end
    local cached = self:cached(url)
    if cached then return cached end
    if self.failed[url] then return nil end

    local data = download(url, username, password)
    if not data then
        self.failed[url] = true
        return nil
    end
    local bb = RenderImage:renderImageData(data, #data, false)
    data = nil -- luacheck: ignore
    if not bb then
        self.failed[url] = true
        return nil
    end
    return self:store(url, bb)
end

--- Shrinks a cover blitbuffer and saves it under this key. Frees bb. Returns the path or nil.
function Covers:store(key, bb)
    if not bb then return nil end
    local thumb = bb
    if bb:getWidth() > self.MAX_W or bb:getHeight() > self.MAX_H then
        local tw, th = Covers.fit(bb:getWidth(), bb:getHeight(), self.MAX_W, self.MAX_H)
        thumb = RenderImage:scaleBlitBuffer(bb, tw, th) -- frees bb
    end
    ensureDir(self.dir)
    local dest = self:path(key)
    local tmp = dest .. ".tmp"
    local ok, err = pcall(thumb.writePNG, thumb, tmp)
    thumb:free()
    if not ok then
        logger.warn("BookRaven: could not save cover", dest, err)
        os.remove(tmp)
        return nil
    end
    os.rename(tmp, dest)
    return dest
end

local function bookKey(file)
    local mtime = lfs.attributes(file, "modification")
    return mtime and ("book:" .. file .. ":" .. mtime)
end

--- The cached cover of a book on the device, without extracting it. Path or nil.
function Covers:cachedBook(file)
    local key = bookKey(file)
    return key and self:cached(key)
end

--- The cover of a book on the device (library home, folder shelves), cached like the catalog's.
function Covers:forBook(file)
    local key = bookKey(file)
    if not key then return nil end
    local cached = self:cached(key)
    if cached then return cached end
    if self.failed[key] then return nil end
    local bb
    local ok_bim, BookInfoManager = pcall(require, "bookinfomanager")
    if ok_bim and BookInfoManager then
        local ok, info = pcall(BookInfoManager.getBookInfo, BookInfoManager, file, true)
        if ok and info and info.cover_bb then
            bb = info.cover_bb:copy()
            info.cover_bb:free()
        end
    end
    if not bb then
        local ok, cover = pcall(function()
            return require("apps/filemanager/filemanagerbookinfo"):getCoverImage(nil, file)
        end)
        if ok then bb = cover end
    end
    if not bb then
        self.failed[key] = true
        return nil
    end
    return self:store(key, bb)
end

--- Width and height of a cached PNG, read from its header.
function Covers:size(path)
    local f = io.open(path, "rb")
    if not f then return nil end
    local head = f:read(24)
    f:close()
    if not head or #head < 24 or head:sub(2, 4) ~= "PNG" then return nil end
    local function u32(i)
        local b1, b2, b3, b4 = head:byte(i, i + 3)
        return ((b1 * 256 + b2) * 256 + b3) * 256 + b4
    end
    return u32(17), u32(21)
end

--- Removes every cached cover. Returns how many files were deleted.
function Covers:clear()
    local n = 0
    if lfs.attributes(self.dir, "mode") ~= "directory" then return 0 end
    for f in lfs.dir(self.dir) do
        if f ~= "." and f ~= ".." then
            if os.remove(self.dir .. "/" .. f) then n = n + 1 end
        end
    end
    self.failed = {}
    return n
end

--- Keeps the cache bounded: deletes the least recently modified files beyond max_files.
function Covers:prune()
    if lfs.attributes(self.dir, "mode") ~= "directory" then return end
    local files = {}
    for f in lfs.dir(self.dir) do
        if f:sub(-4) == ".png" then
            local p = self.dir .. "/" .. f
            table.insert(files, { path = p, mtime = lfs.attributes(p, "modification") or 0 })
        end
    end
    if #files <= self.max_files then return end
    table.sort(files, function(a, b) return a.mtime < b.mtime end)
    for i = 1, #files - self.max_files do
        os.remove(files[i].path)
    end
end

return Covers
