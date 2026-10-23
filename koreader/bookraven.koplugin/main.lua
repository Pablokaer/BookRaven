--[[--
BookRaven for KOReader: syncs highlights, notes and bookmarks with a BookRaven server both ways,
and downloads the books sent to this device from BookRaven ("Send to Kindle").

Tools → BookRaven:
- Settings: the server's address, the account email and an app password (Profile → Other apps
  in BookRaven). They are kept in KOReader's settings file in plain text, as KOReader's own
  progress sync plugin keeps its login; an app password can be revoked on its own.
- Sync highlights and bookmarks now (with a book open).
- Download sent books: into a "BookRaven" folder in KOReader's home folder.
- Automatic sync when a book opens and closes, and when Wi-Fi comes on; automatic downloads of
  sent books when Wi-Fi comes on.

Needs KOReader 2024.07 or later for highlights and bookmarks (its annotation module); downloads
work on older versions too.

KOReader APIs used (from its source, plugins/kosync.koplugin and frontend/; this plugin could not
be run in KOReader when it was written, see README → Other reading apps): WidgetContainer,
ui.menu:registerToMainMenu, the ReaderReady / CloseDocument / NetworkConnected events,
NetworkMgr:runWhenOnline / isOnline, UIManager:show / nextTick / scheduleIn / setDirty,
InfoMessage, ConfirmBox, MultiInputDialog, Trapper:wrap / info, G_reader_settings,
ui.doc_settings, util.partialMD5 / makePath, lfs, FileManager.instance:onRefresh.

@module koplugin.bookraven
]]

local DataStorage = require("datastorage")
local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local Trapper = require("ui/trapper")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local _ = require("gettext")
local T = require("ffi/util").template

local Annotations = require("bookraven_annotations")
local Client = require("bookraven_client")

local SETTINGS_KEY = "bookraven"
local FOLDER_NAME = "BookRaven"

-- The reader and the file browser each have an instance of the plugin: one sync or download at a time.
local busy = { syncing = false, downloading = false }

local BookRaven = WidgetContainer:extend({
    name = "bookraven",
    is_doc_only = false,
})

local function readSettings()
    local s = G_reader_settings:readSetting(SETTINGS_KEY)
    if type(s) ~= "table" then
        s = {}
    end
    if s.auto_sync == nil then
        s.auto_sync = true
    end
    if s.auto_download == nil then
        s.auto_download = true
    end
    return s
end

local function saveSettings(s)
    G_reader_settings:saveSetting(SETTINGS_KEY, s)
end

local function notify(text, timeout)
    UIManager:show(InfoMessage:new({ text = text, timeout = timeout or 3 }))
end

function BookRaven:init()
    self.settings = readSettings()
    if self.ui and self.ui.menu then
        self.ui.menu:registerToMainMenu(self)
    end
end

function BookRaven:client()
    -- Read each time: the other instance (reader or file browser) may have saved new settings.
    self.settings = readSettings()
    local s = self.settings
    return Client.new(s.server, s.email, s.password)
end

function BookRaven:isConfigured()
    return self:client():isConfigured()
end

function BookRaven:hasBook()
    return self.ui ~= nil and self.ui.document ~= nil and self.ui.doc_settings ~= nil
end

-- ---------------------------------------------------------------------------------------------
-- Menu

function BookRaven:addToMainMenu(menu_items)
    menu_items.bookraven = {
        text = _("BookRaven"),
        sorting_hint = "tools",
        sub_item_table = {
            {
                text = _("Settings"),
                keep_menu_open = true,
                callback = function(touchmenu_instance)
                    self:showSettings(touchmenu_instance)
                end,
            },
            {
                text = _("Sync highlights and bookmarks now"),
                enabled_func = function()
                    return self:hasBook()
                end,
                callback = function()
                    self:syncAnnotations(true)
                end,
            },
            {
                text = _("Download sent books"),
                callback = function()
                    self:downloadSentBooks(true)
                end,
                separator = true,
            },
            {
                text = _("Sync when opening and closing a book"),
                checked_func = function()
                    return self.settings.auto_sync
                end,
                callback = function()
                    self.settings.auto_sync = not self.settings.auto_sync
                    saveSettings(self.settings)
                end,
            },
            {
                text = _("Download sent books when Wi-Fi comes on"),
                checked_func = function()
                    return self.settings.auto_download
                end,
                callback = function()
                    self.settings.auto_download = not self.settings.auto_download
                    saveSettings(self.settings)
                end,
            },
        },
    }
end

function BookRaven:showSettings(touchmenu_instance)
    self.settings = readSettings()
    local s = self.settings
    local dialog
    dialog = MultiInputDialog:new({
        title = _("BookRaven"),
        fields = {
            {
                description = _("Server address"),
                text = s.server or "",
                hint = "https://books.example.com",
            },
            {
                description = _("Email"),
                text = s.email or "",
                hint = "reader@example.com",
            },
            {
                description = _("App password (Profile → Other apps)"),
                text = s.password or "",
                hint = "otter-pecan-quilt-lunar-robin-tulip",
                text_type = "password",
            },
        },
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Save"),
                    is_enter_default = true,
                    callback = function()
                        local fields = dialog:getFields()
                        local server = (fields[1] or ""):gsub("%s+", ""):gsub("/+$", "")
                        if server ~= "" and not server:match("^https?://") then
                            server = "https://" .. server
                        end
                        s.server = server
                        s.email = (fields[2] or ""):gsub("^%s+", ""):gsub("%s+$", "")
                        -- App passwords are lowercase words; the server ignores capitals and spaces around them.
                        s.password = (fields[3] or ""):gsub("^%s+", ""):gsub("%s+$", ""):lower()
                        saveSettings(s)
                        UIManager:close(dialog)
                        if touchmenu_instance then
                            touchmenu_instance:updateItems()
                        end
                        self:testConnection()
                    end,
                },
            },
        },
    })
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

--- Signs in once, so a typo in the settings shows at once.
function BookRaven:testConnection()
    if not self:isConfigured() then
        return
    end
    NetworkMgr:runWhenOnline(function()
        local ok, status, answer = self:client():request("GET", "/api/koreader/me")
        if ok then
            notify(T(_("Signed in to BookRaven as %1."), type(answer) == "table" and answer.email or self.settings.email))
        elseif status == 401 then
            notify(_("BookRaven didn't accept this email and app password. Check them in Profile → Other apps."), 6)
        else
            notify(T(_("Could not reach BookRaven: %1"), tostring(status or answer)), 6)
        end
    end)
end

-- ---------------------------------------------------------------------------------------------
-- Highlights and bookmarks

--- KOReader's id for the open book, as its progress sync computes it (binary matching).
function BookRaven:documentId()
    local digest = self.ui.doc_settings:readSetting("partial_md5_checksum")
    if not digest and self.ui.document.file then
        digest = util.partialMD5(self.ui.document.file)
        if digest then
            self.ui.doc_settings:saveSetting("partial_md5_checksum", digest)
        end
    end
    return digest
end

--[[--
Syncs the open book's highlights and bookmarks. `interactive`: started from the menu, so it may
turn Wi-Fi on and always says how it went; automatic syncs stay quiet unless something changed.
]]
function BookRaven:syncAnnotations(interactive)
    if not self:hasBook() then
        return
    end
    if not self:isConfigured() then
        if interactive then
            notify(_("Set up BookRaven first: Tools → BookRaven → Settings."))
        end
        return
    end
    if not Annotations.isSupported(self.ui) then
        if interactive then
            notify(_("Syncing highlights needs KOReader 2024.07 or later. Downloading sent books works on this version."), 6)
        end
        return
    end
    local run = function()
        if busy.syncing then
            return
        end
        busy.syncing = true
        local ok, result = pcall(function()
            local document_id = self:documentId()
            if not document_id then
                return { code = "server", message = "no document id" }, false
            end
            local done, answer = Annotations.new(self.ui):run(self:client(), document_id)
            return answer, done
        end)
        busy.syncing = false
        if not ok then
            logger.warn("BookRaven: sync failed:", result)
            if interactive then
                notify(T(_("Could not sync with BookRaven: %1"), tostring(result)), 6)
            end
            return
        end
        self:reportSync(result, interactive)
    end
    if interactive then
        NetworkMgr:runWhenOnline(run)
    elseif NetworkMgr:isOnline() then
        run()
    end
end

function BookRaven:reportSync(result, interactive)
    if result.code == "unknown_document" then
        if interactive then
            notify(_("This book isn't in your BookRaven library. Upload it there (the same file) to sync its highlights."), 6)
        end
        return
    elseif result.code == "unauthorized" then
        notify(_("BookRaven didn't accept this email and app password. Check them in Tools → BookRaven → Settings."), 6)
        return
    elseif result.code then
        if interactive then
            notify(T(_("Could not sync with BookRaven: %1"), tostring(result.message or result.code)), 6)
        end
        return
    end
    local changed = (result.added or 0) + (result.updated or 0) + (result.deleted or 0)
    if changed > 0 then
        -- Redraw the page with the new highlights, and save them with the book.
        UIManager:setDirty(self.ui.dialog or "all", "ui")
        if self.ui.saveSettings then
            pcall(function()
                self.ui:saveSettings()
            end)
        end
    end
    if interactive or changed > 0 then
        local lines = {
            T(_("Highlights and bookmarks synced with BookRaven.\nFrom BookRaven: %1 new, %2 changed, %3 deleted."), result.added or 0, result.updated or 0, result.deleted or 0),
        }
        if (result.skipped or 0) > 0 then
            table.insert(lines, T(_("%1 couldn't be placed in this book."), result.skipped))
        end
        notify(table.concat(lines, "\n"), interactive and 4 or 2)
    end
end

function BookRaven:onReaderReady()
    self.settings = readSettings()
    if self.settings.auto_sync and self:isConfigured() then
        -- After the book is shown, so opening it isn't slower.
        UIManager:scheduleIn(2, function()
            self:syncAnnotations(false)
        end)
    end
end

function BookRaven:onCloseDocument()
    self.settings = readSettings()
    if self.settings.auto_sync and self:isConfigured() then
        self:syncAnnotations(false)
    end
end

function BookRaven:onNetworkConnected()
    -- isConfigured reads the settings again.
    if not self:isConfigured() then
        return
    end
    UIManager:nextTick(function()
        if self.settings.auto_sync and self:hasBook() then
            self:syncAnnotations(false)
        end
        if self.settings.auto_download then
            self:downloadSentBooks(false)
        end
    end)
end

-- ---------------------------------------------------------------------------------------------
-- Sent books

--- The folder sent books go to: "BookRaven" in KOReader's home folder.
function BookRaven:downloadFolder()
    local home = G_reader_settings:readSetting("home_dir")
    if not home then
        local ok, filemanagerutil = pcall(require, "apps/filemanager/filemanagerutil")
        if ok and filemanagerutil.getDefaultDir then
            home = filemanagerutil.getDefaultDir()
        end
    end
    home = home or Device.home_dir or DataStorage:getDataDir()
    return home:gsub("/+$", "") .. "/" .. FOLDER_NAME
end

local function fileSize(path)
    local attributes = lfs.attributes(path)
    return attributes and attributes.mode == "file" and attributes.size or nil
end

--[[--
Downloads the books sent to this device. `interactive`: from the menu, so it may turn Wi-Fi on
and always says how it went.
]]
function BookRaven:downloadSentBooks(interactive)
    if not self:isConfigured() then
        if interactive then
            notify(_("Set up BookRaven first: Tools → BookRaven → Settings."))
        end
        return
    end
    local run = function()
        if busy.downloading then
            return
        end
        busy.downloading = true
        Trapper:wrap(function()
            local ok, err = pcall(function()
                self:downloadSent(interactive)
            end)
            busy.downloading = false
            if not ok then
                logger.warn("BookRaven: downloads failed:", err)
                if interactive then
                    notify(T(_("Could not download sent books: %1"), tostring(err)), 6)
                end
            end
        end)
    end
    if interactive then
        NetworkMgr:runWhenOnline(run)
    elseif NetworkMgr:isOnline() then
        run()
    end
end

function BookRaven:downloadSent(interactive)
    local client = self:client()
    local ok, status, list = client:request("GET", "/api/koreader/sent")
    if not ok or type(list) ~= "table" then
        if status == 401 then
            notify(_("BookRaven didn't accept this email and app password. Check them in Tools → BookRaven → Settings."), 6)
        elseif interactive then
            notify(T(_("Could not reach BookRaven: %1"), tostring(status or list)), 6)
        end
        return
    end
    if #list == 0 then
        if interactive then
            notify(_("No books waiting: send one from BookRaven with Send to Kindle in a book's menu."))
        end
        return
    end
    local folder = self:downloadFolder()
    if not util.makePath(folder) and lfs.attributes(folder, "mode") ~= "directory" then
        notify(T(_("Could not create the folder %1."), folder), 6)
        return
    end
    local done, failed = 0, 0
    for i, book in ipairs(list) do
        if type(book) == "table" and type(book.url) == "string" and type(book.fileName) == "string" and type(book.id) == "string" then
            -- The server names files safely ("Author - Title.ext"); keep slashes out all the same.
            local path = folder .. "/" .. book.fileName:gsub("[/\\]", "_")
            Trapper:info(T(_("Downloading from BookRaven (%1 of %2)…\n%3"), i, #list, book.title or book.fileName))
            local have = fileSize(path)
            local got = have ~= nil and (type(book.sizeBytes) ~= "number" or have == book.sizeBytes)
            if not got then
                local downloaded, err = client:download(book.url, path)
                if not downloaded then
                    logger.warn("BookRaven: download failed:", book.url, err)
                end
                got = downloaded
            end
            if got then
                client:request("POST", "/api/koreader/sent/" .. book.id .. "/delivered")
                done = done + 1
            else
                failed = failed + 1
            end
        end
    end
    Trapper:clear()
    -- Show the new files if the file browser is open.
    local has_fm, FileManager = pcall(require, "apps/filemanager/filemanager")
    if has_fm and FileManager.instance then
        pcall(function()
            FileManager.instance:onRefresh()
        end)
    end
    if done > 0 or failed > 0 or interactive then
        local text = T(_("%1 book(s) from BookRaven are in %2."), done, folder)
        if failed > 0 then
            text = text .. "\n" .. T(_("%1 couldn't be downloaded; they'll be tried again next time."), failed)
        end
        notify(text, 5)
    end
end

return BookRaven
