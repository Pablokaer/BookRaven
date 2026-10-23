--[[--
BookRaven for KOReader.

  * Settings → BookRaven → Theme: "KOReader (original)", "BookRaven" (the look of bookraven.cloud,
    modern with engraved details) or "Cyberdeck" (neon noir). Themes restyle fonts, icons, menus,
    dialogs, title bars and the file browser.
  * The BookRaven library home (br_home): continue reading, illustrated shelves, new books.
    Settings → BookRaven → Start with the BookRaven library (also offered in "Start with").
  * OPDS book lists as cards with covers from the server, shelves as illustrated tiles.
  * One-step account setup for the BookRaven catalog and progress sync.

@module koplugin.BookRaven
]]

local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local logger = require("logger")
local _ = require("gettext")
local T = require("ffi/util").template

local PLUGIN_DIR = (debug.getinfo(1, "S").source or ""):match("^@(.*)/[^/]*$") or "plugins/bookraven.koplugin"

local Settings = require("br_settings")
local Theme = require("br_theme")
local Covers = require("br_covers")

-- Runs while plugins load, before the first screen is laid out: fonts and theme must be in
-- place before any title bar or menu is built.
Theme.registerFonts(PLUGIN_DIR)
if Settings.themeName() then
    local ok, err = pcall(Theme.apply, PLUGIN_DIR, Settings.themeName())
    if not ok then logger.err("BookRaven: could not apply the theme", err) end
end
-- Our other modules are only findable while plugins load, so load them now.
for _, mod in ipairs({ "br_widgets", "br_account", "br_cards", "br_gallery", "br_home" }) do
    local ok, err = pcall(require, mod)
    if not ok then logger.err("BookRaven: could not load", mod, err) end
end

local hooks_installed = false
local start_done = false

local BookRaven = WidgetContainer:extend{
    name = "bookraven",
    is_doc_only = false,
}

local function insertAfter(list, after, key)
    for _, v in ipairs(list) do
        if v == key then return end
    end
    for i, v in ipairs(list) do
        if v == after then
            table.insert(list, i + 1, key)
            return
        end
    end
    table.insert(list, key)
end

local function insertBefore(list, before, key)
    for _, v in ipairs(list) do
        if v == key then return true end
    end
    for i, v in ipairs(list) do
        if v == before then
            table.insert(list, i, key)
            return true
        end
    end
end

--- Puts our entries in the menus: Settings → BookRaven (after Screen), and in the file
--- browser's main menu (☰) "BookRaven library" at the top, before History.
local function placeMenuItems()
    for _, mod in ipairs({ "ui/elements/filemanager_menu_order", "ui/elements/reader_menu_order" }) do
        local ok, order = pcall(require, mod)
        if ok and type(order) == "table" and type(order.setting) == "table" then
            insertAfter(order.setting, "screen", "bookraven")
        end
    end
    local ok, order = pcall(require, "ui/elements/filemanager_menu_order")
    if ok and type(order) == "table" and type(order.main) == "table" then
        if not insertBefore(order.main, "history", "bookraven_library") then
            table.insert(order.main, 1, "bookraven_library")
        end
    end
end

--- Adds "BookRaven library" to the core "Start with" choices.
local function patchStartWith()
    local ok, FileManagerMenu = pcall(require, "apps/filemanager/filemanagermenu")
    if not ok or not FileManagerMenu.getStartWithMenuTable then return end
    local orig = FileManagerMenu.getStartWithMenuTable
    FileManagerMenu.getStartWithMenuTable = function(self, ...)
        local t = orig(self, ...)
        if type(t) ~= "table" or type(t.sub_item_table) ~= "table" then return t end
        table.insert(t.sub_item_table, {
            text = _("BookRaven library"),
            checked_func = function()
                return G_reader_settings:readSetting("start_with") == Settings.START_WITH
            end,
            callback = function()
                G_reader_settings:saveSetting("start_with", Settings.START_WITH)
            end,
            radio = true,
        })
        local orig_text_func = t.text_func
        t.text_func = function()
            if G_reader_settings:readSetting("start_with") == Settings.START_WITH then
                return T(_("Start with: %1"), _("BookRaven library"))
            end
            return orig_text_func and orig_text_func() or _("Start with")
        end
        return t
    end
end

local function installHooks()
    if hooks_installed then return end
    hooks_installed = true
    placeMenuItems()
    patchStartWith()
    local ok, OPDSBrowser = pcall(require, "opdsbrowser")
    if ok and OPDSBrowser then
        require("br_cards").install(OPDSBrowser)
    else
        logger.warn("BookRaven: OPDS plugin not available, cards view disabled")
    end
end

function BookRaven:init()
    installHooks()
    self.ui.menu:registerToMainMenu(self)
    -- So a gesture or corner tap can open the library (Settings → Taps and gestures).
    require("dispatcher"):registerAction("bookraven_open_library", {
        category = "none",
        event = "BookRavenOpenLibrary",
        title = _("BookRaven library"),
        filemanager = true,
    })

    -- The file browser is titled after the app it belongs to.
    local theme = Theme.current()
    if theme and theme.fm_title and not self.ui.document and self.ui.title then
        self.ui.title = theme.fm_title
    end

    if not self.ui.document and Theme.current() then
        -- The file browser's list is built after the plugins: restyle its rows once it exists.
        local function decorate()
            local fc = self.ui.file_chooser
            if not fc then return end
            require("br_style").decorateFileChooser(fc)
            if fc.refreshPath then pcall(fc.refreshPath, fc) end
        end
        if type(self.ui.postInitCallback) == "table" then
            table.insert(self.ui.postInitCallback, decorate)
        else
            UIManager:nextTick(decorate)
        end
    end

    if not start_done then
        start_done = true
        UIManager:scheduleIn(5, function() pcall(Covers.prune, Covers) end)
    end
    if not self.ui.document and G_reader_settings:readSetting("start_with") == Settings.START_WITH then
        -- At start-up, and when coming back from a book: the home, over the file browser.
        UIManager:nextTick(function() self:openLibrary() end)
    end
end

--- Shows the BookRaven library home over the file browser.
function BookRaven:openLibrary()
    if self.ui.document then return end
    if self.home and not self.home._closed then return end
    local ok, Home = pcall(require, "br_home")
    if not ok then
        logger.err("BookRaven: home unavailable", Home)
        return
    end
    self.home = Home:new{ ui = self.ui }
    UIManager:show(self.home)
end

function BookRaven:onCloseWidget()
    if self.home and not self.home._closed then
        self.home._closed = true
        UIManager:close(self.home)
    end
    self.home = nil
end

function BookRaven:onBookRavenOpenLibrary()
    self:openLibrary()
    return true
end

local function askRestart()
    UIManager:askForRestart(_("KOReader needs to restart to change the theme."))
end

function BookRaven:themeMenu()
    local function choice(text, value)
        return {
            text = text,
            radio = true,
            checked_func = function() return Settings.get("theme") == value end,
            callback = function()
                if Settings.get("theme") ~= value then
                    Settings.set("theme", value)
                    askRestart()
                end
            end,
        }
    end
    return {
        text_func = function()
            local theme = Theme.THEMES[Settings.get("theme")]
            return T(_("Theme: %1"), theme and theme.label or _("KOReader (original)"))
        end,
        sub_item_table = {
            choice(_("KOReader (original)"), "original"),
            choice(_("BookRaven (bookraven.cloud)"), "bookraven"),
            choice(_("Cyberdeck (neon noir)"), "cyberdeck"),
        },
    }
end

function BookRaven:viewMenu()
    local function view(text, value)
        return {
            text = text,
            radio = true,
            checked_func = function() return Settings.get("opds_view") == value end,
            callback = function() Settings.set("opds_view", value) end,
        }
    end
    local function grid(text, value)
        return {
            text = text,
            radio = true,
            enabled_func = function() return Settings.get("opds_view") == "cards" end,
            checked_func = function() return Settings.get("cards_grid") == value end,
            callback = function() Settings.set("cards_grid", value) end,
        }
    end
    return {
        text_func = function()
            return T(_("Catalog view: %1"), Settings.get("opds_view") == "cards" and _("cards") or _("list"))
        end,
        sub_item_table = {
            view(_("Cards with covers"), "cards"),
            view(_("List (original)"), "list"),
            {
                text = _("Cards per page"),
                separator = true,
                enabled_func = function() return Settings.get("opds_view") == "cards" end,
                sub_item_table = {
                    grid(_("Large: 3 × 2"), "3x2"),
                    grid(_("Medium: 3 × 3"), "3x3"),
                    grid(_("Small: 4 × 3"), "4x3"),
                },
            },
            {
                text = _("Clear cached covers"),
                keep_menu_open = true,
                callback = function()
                    local n = Covers:clear()
                    UIManager:show(InfoMessage:new{ text = T(_("Removed %1 cached covers."), n), timeout = 2 })
                end,
            },
        },
    }
end

function BookRaven:addToMainMenu(menu_items)
    local Account = require("br_account")
    if not self.ui.document then -- next to "OPDS catalog", which only the file browser has
        menu_items.bookraven_library = {
            text = _("BookRaven library"),
            callback = function()
                self:openLibrary()
            end,
        }
    end
    menu_items.bookraven = {
        text = "BookRaven",
        sub_item_table = {
            self:themeMenu(),
            self:viewMenu(),
            {
                text = _("Start with the BookRaven library"),
                help_text = _("Open your BookRaven library when KOReader starts, instead of the file browser."),
                checked_func = function()
                    return G_reader_settings:readSetting("start_with") == Settings.START_WITH
                end,
                callback = function()
                    if G_reader_settings:readSetting("start_with") == Settings.START_WITH then
                        G_reader_settings:saveSetting("start_with", "filemanager")
                    else
                        G_reader_settings:saveSetting("start_with", Settings.START_WITH)
                    end
                end,
                separator = true,
            },
            {
                text_func = function()
                    local email = Account.credentials(self.ui)
                    return email and T(_("Account: %1"), email) or _("Set up BookRaven account…")
                end,
                keep_menu_open = true,
                callback = function(touchmenu_instance)
                    Account.showDialog(self.ui, function()
                        if touchmenu_instance then touchmenu_instance:updateItems() end
                    end)
                end,
            },
            {
                text = _("Open the BookRaven library"),
                enabled_func = function() return not self.ui.document end,
                callback = function() self:openLibrary() end,
            },
        },
    }
end

return BookRaven
