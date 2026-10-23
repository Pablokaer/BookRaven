--[[--
One-step BookRaven account setup.

Asks for the server, the account email and an app password (BookRaven → Profile → Other apps),
checks them against the server, then:
  * adds or updates the "BookRaven" catalog in KOReader's OPDS catalogs, and
  * points KOReader's progress sync (KOSync) at <server>/kosync with the same login.
The account password itself is never used: BookRaven only accepts app passwords here.
]]

local DataStorage = require("datastorage")
local InfoMessage = require("ui/widget/infomessage")
local LuaSettings = require("luasettings")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local http = require("socket.http")
local logger = require("logger")
local ltn12 = require("ltn12")
local md5 = require("ffi/sha2").md5
local socket = require("socket")
local socketutil = require("socketutil")
local _ = require("gettext")
local T = require("ffi/util").template

local Settings = require("br_settings")

local Account = {}

local function request(url, opts)
    local sink = {}
    socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    local ok, code = pcall(function()
        return socket.skip(1, http.request{
            url = url,
            method = "GET",
            headers = opts.headers,
            sink = ltn12.sink.table(sink),
            user = opts.user,
            password = opts.password,
        })
    end)
    socketutil:reset_timeout()
    if not ok then return nil, tostring(code) end
    -- On a network error http.request gives (nil, message), which socket.skip turns into the message.
    if type(code) ~= "number" then return nil, tostring(code) end
    return code
end

--- Checks the login with both endpoints. Returns true, or false and a message.
function Account.check(server, email, password)
    local code, err = request(server .. "/opds", {
        user = email,
        password = password,
        headers = { ["Accept-Encoding"] = "identity" },
    })
    if not code then
        return false, T(_("Could not reach %1.\n%2"), server, err or "")
    end
    if code == 401 or code == 403 then
        return false, _("The email or app password was not accepted.\nCreate an app password in BookRaven: Profile → Other apps.")
    end
    if code ~= 200 then
        return false, T(_("The server answered %1 for its catalog."), tostring(code))
    end
    local sync_code = request(server .. "/kosync/users/auth", {
        headers = {
            ["Accept"] = "application/vnd.koreader.v1+json",
            ["x-auth-user"] = email,
            ["x-auth-key"] = md5(password),
        },
    })
    return true, nil, sync_code == 200
end

--- The OPDS plugin's catalog list (live instance if there is one, else its settings file).
local function opdsStore(ui)
    local opds = ui and ui.opds
    if opds and opds.loadSettings then
        opds:loadSettings()
        return opds.servers, function()
            opds.settings:saveSetting("servers", opds.servers)
            opds.settings:flush()
        end
    end
    local store = LuaSettings:open(DataStorage:getSettingsDir() .. "/opds.lua")
    local servers = store:readSetting("servers")
    if not servers then
        local OPDS = Account.pluginModule("opds")
        servers = OPDS and OPDS.default_servers and { unpack(OPDS.default_servers) } or {}
    end
    return servers, function()
        store:saveSetting("servers", servers)
        store:flush()
    end
end

function Account.pluginModule(name)
    local PluginLoader = require("pluginloader")
    for _, mod in ipairs(PluginLoader:loadPlugins()) do
        if mod.name == name then return mod end
    end
end

--- Finds the BookRaven catalog among the OPDS catalogs.
function Account.findCatalog(servers, url)
    url = url or Settings.opdsUrl()
    for i, server in ipairs(servers or {}) do
        if server.url == url or (server.url and server.url:gsub("/+$", "") == url) then
            return server, i
        end
    end
    for i, server in ipairs(servers or {}) do
        if server.title == "BookRaven" then return server, i end
    end
end

local function saveCatalog(ui, server, email, password)
    local servers, flush = opdsStore(ui)
    local url = server .. "/opds"
    local entry = Account.findCatalog(servers, url)
    if not entry then
        entry = {}
        table.insert(servers, 1, entry)
    end
    entry.title = "BookRaven"
    entry.url = url
    entry.username = email
    entry.password = password
    flush()
end

local function saveSync(server, email, password)
    local KOSync = Account.pluginModule("kosync")
    if not KOSync or not KOSync.settings_file then return false end
    if not KOSync.settings_obj then
        KOSync.settings_obj = LuaSettings:open(KOSync.settings_file)
    end
    local store = KOSync.settings_obj
    local s = store:readSetting("settings")
    if not s then
        s = {}
        for k, v in pairs(KOSync.default_settings or {}) do s[k] = v end
    end
    s.custom_server = server .. "/kosync"
    s.username = email
    s.userkey = md5(password)
    s.checksum_method = 0 -- "Binary": BookRaven matches books by KOReader's partial MD5
    store:saveSetting("settings", s)
    store:flush()
    return true
end

function Account.save(ui, server, email, password)
    Settings.set("server", server)
    Settings.set("email", email)
    saveCatalog(ui, server, email, password)
    return saveSync(server, email, password)
end

--- Current catalog credentials, if the account was set up.
function Account.credentials(ui)
    local servers = opdsStore(ui)
    local entry = Account.findCatalog(servers)
    if entry then
        return entry.username, entry.password, entry
    end
end

function Account.showDialog(ui, on_done)
    local email, password = Account.credentials(ui)
    local dialog
    dialog = MultiInputDialog:new{
        title = _("BookRaven account"),
        description = _("Use your account email and an app password from BookRaven → Profile → Other apps."),
        fields = {
            {
                description = _("Server"),
                text = Settings.server(),
                hint = Settings.DEFAULT_SERVER,
            },
            {
                description = _("Email"),
                text = email or Settings.get("email") or "",
                hint = "you@example.com",
            },
            {
                description = _("App password"),
                text = password or "",
                hint = _("app password"),
                text_type = "password",
            },
        },
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function() UIManager:close(dialog) end,
                },
                {
                    text = _("Save"),
                    is_enter_default = true,
                    callback = function()
                        local fields = dialog:getFields()
                        local server = (fields[1] or ""):gsub("%s", ""):gsub("/+$", "")
                        local mail = (fields[2] or ""):gsub("^%s+", ""):gsub("%s+$", "")
                        local pass = (fields[3] or ""):gsub("^%s+", ""):gsub("%s+$", "")
                        if server == "" then server = Settings.DEFAULT_SERVER end
                        if not server:find("^https?://") then server = "https://" .. server end
                        if mail == "" or pass == "" then
                            UIManager:show(InfoMessage:new{ text = _("Enter your email and an app password.") })
                            return
                        end
                        UIManager:close(dialog)
                        NetworkMgr:runWhenOnline(function()
                            local ok, err, sync_ok = Account.check(server, mail, pass)
                            if not ok then
                                UIManager:show(InfoMessage:new{ text = err })
                                return
                            end
                            local sync_saved = Account.save(ui, server, mail, pass)
                            logger.info("BookRaven: account saved for", server)
                            local text = T(_("Connected to %1 as %2.\n\nYour library is in OPDS catalogs as \"BookRaven\"."), server, mail)
                            if sync_saved and sync_ok then
                                text = text .. "\n" .. _("Progress sync now uses BookRaven too.")
                            end
                            UIManager:show(InfoMessage:new{ text = text })
                            if on_done then on_done() end
                        end)
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

return Account
