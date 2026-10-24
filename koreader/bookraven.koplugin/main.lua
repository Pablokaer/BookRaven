--[[--
BookRaven for KOReader.

  * Settings → BookRaven → Theme: "KOReader (original)", "BookRaven" (the look of bookraven.cloud,
    modern with engraved details), "Cyberdeck" (neon noir) or "Classic e-reader" (inspired by the
    Kindle's stock look). Themes restyle fonts, icons, menus, dialogs, title bars and the file
    browser.
  * The BookRaven library home (br_home): continue reading, illustrated shelves, new books;
    offline, a single shelf with every book on the device.
    Settings → BookRaven → Start with the BookRaven library (also offered in "Start with").
  * The raven at the top left of every plugin screen and of the catalog goes back to the home;
    screens come and go with a full-screen refresh (br_nav).
  * Search (br_search): one search for every book (device, library, Public Library) from the
    home, and a magnifier in every shelf.
  * Quick settings (br_quick): Wi-Fi (br_wifi), brightness, warmth, dark mode, text size, bold and
    font, from a swipe down at the top of the plugin's screens, the sun at the end of the top
    menu's tabs (in a book too) or an assignable gesture.
  * OPDS book lists as cards with covers from the server, shelves as illustrated tiles.
  * One-step account setup for the BookRaven catalog and progress sync.

Start-up never fails as a whole: KOReader silently leaves out a plugin whose main.lua raises an
error while it loads, so every step here (the theme, each module, each hook into KOReader) is
guarded, and one that fails is logged ("BookRaven: …" in crash.log) and left out on its own. If
the plugin's core modules cannot load at all, Settings → BookRaven says so instead of vanishing.

@module koplugin.BookRaven
]]

local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local logger = require("logger")
local _ = require("gettext")

local PLUGIN_DIR = (debug.getinfo(1, "S").source or ""):match("^@(.*)/[^/]*$") or "plugins/bookraven.koplugin"

--- Runs fn(...) and logs its error instead of raising it. Returns ok and fn's first result.
local function try(what, fn, ...)
    local ok, res = pcall(fn, ...)
    if not ok then logger.err("BookRaven: " .. what .. " failed:", res) end
    return ok, res
end

local failed = {} -- modules that could not load

local T = require("ffi/util").template
local InfoMessage = require("ui/widget/infomessage")

--- What stands in for a module that could not load: any field of it is itself, and calling it
--- does nothing but say (once) that this part of the plugin is missing. So a button whose module
--- failed shows a message instead of stopping KOReader.
local function standIn(name)
    local stub, told = {}, false
    setmetatable(stub, {
        __index = function() return stub end,
        __call = function()
            if not told then
                told = true
                UIManager:show(InfoMessage:new{
                    text = T(_("This part of BookRaven could not load (%1). See crash.log for details."), name),
                })
            end
        end,
    })
    return stub
end

--- Our modules are only findable while plugins load (KOReader puts the plugin's folder on the
--- module path just for that), so each is loaded now; a module that fails is replaced by a
--- stand-in (above), and the rest of the plugin goes on without it.
local function loadModule(name)
    local ok, mod = try("loading " .. name, require, name)
    if ok then return mod end
    table.insert(failed, name)
    package.loaded[name] = standIn(name)
end

local Settings = loadModule("br_settings")
local Theme = Settings and loadModule("br_theme")
local Covers = Settings and loadModule("br_covers")

-- Runs while plugins load, before the first screen is laid out: fonts and theme must be in
-- place before any title bar or menu is built.
if Theme then
    try("registering the fonts", Theme.registerFonts, PLUGIN_DIR)
    local ok_name, name = try("reading the theme", Settings.themeName)
    if ok_name and name then
        try("applying the theme " .. tostring(name), Theme.apply, PLUGIN_DIR, name)
    end
    for _, mod in ipairs({ "br_widgets", "br_wifi", "br_nav", "br_account", "br_cards", "br_gallery",
            "br_search", "br_quick", "br_home" }) do
        loadModule(mod)
    end
end
if #failed > 0 then logger.err("BookRaven: modules left out:", table.concat(failed, ", ")) end

local hooks_installed = false
local start_done = false

local BookRaven = WidgetContainer:extend{
    name = "bookraven",
    is_doc_only = false,
}

-- ------------------------------------------------------------------ hooks into KOReader

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

-- ------------------------------------------------------------------ the core modules failed

if not (Settings and Theme) then
    --- A plugin that only says it could not start (Settings → BookRaven), instead of vanishing.
    function BookRaven:init()
        try("adding the menu entries", placeMenuItems)
        try("registering the menu", function() self.ui.menu:registerToMainMenu(self) end)
    end

    function BookRaven:addToMainMenu(menu_items)
        menu_items.bookraven = {
            text = "BookRaven",
            sub_item_table = {
                {
                    text = _("BookRaven could not start"),
                    callback = function()
                        UIManager:show(InfoMessage:new{
                            text = T(_("BookRaven could not load %1.\n\nSee crash.log for details, and reinstall the plugin."),
                                table.concat(failed, ", ")),
                        })
                    end,
                },
            },
        }
    end

    return BookRaven
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

--- The sun, last on the top menu's tab bar (after ☰, in a book and in the file browser): a tap
--- closes the menu and opens the quick settings. KOReader's own "file browser" tab is made the
--- same way: a tab with an icon, a callback and remember = false, and no items. We add ours to
--- the tabs each time KOReader builds them (setUpdateItemTable), so a custom menu order cannot
--- drop it. If a future KOReader builds its menu differently, the sun is simply not there.
local QUICK_TAB_ICON = "br.tab.quick"

local function patchMenuTabs(Menu, close_method)
    if type(Menu) ~= "table" or type(Menu.setUpdateItemTable) ~= "function" or rawget(Menu, "_br_quick_tab") then return end
    Menu._br_quick_tab = true
    local orig_update = Menu.setUpdateItemTable
    Menu.setUpdateItemTable = function(self, ...)
        local ret = orig_update(self, ...)
        local ok, err = pcall(function()
            local tabs = self.tab_item_table
            if type(tabs) ~= "table" or #tabs == 0 then return end
            for _, tab in ipairs(tabs) do
                if type(tab) == "table" and tab._br_quick then return end
            end
            table.insert(tabs, {
                icon = QUICK_TAB_ICON,
                remember = false, -- never reopened as the last tab used
                _br_quick = true,
                callback = function()
                    local close = self[close_method]
                    if type(close) == "function" then close(self) end
                    -- Once the menu is gone, so the panel comes down over the book or the files.
                    UIManager:nextTick(function() require("br_quick").show(self.ui) end)
                end,
            })
        end)
        if not ok then logger.warn("BookRaven: no quick settings tab", err) end
        return ret
    end
    -- A swipe down at the far right opens the last tab: keep that one KOReader's ☰.
    local orig_index = Menu._getTabIndexFromLocation
    if type(orig_index) == "function" then
        Menu._getTabIndexFromLocation = function(self, ...)
            local index = orig_index(self, ...)
            local tab = type(index) == "number" and type(self.tab_item_table) == "table" and self.tab_item_table[index]
            if type(tab) == "table" and tab._br_quick and index > 1 then return index - 1 end
            return index
        end
    end
end

local function installQuickTab()
    local Style = require("br_style")
    Style.addIcon(QUICK_TAB_ICON, require("br_widgets").icon(QUICK_TAB_ICON))
    local ok_r, ReaderMenu = pcall(require, "apps/reader/modules/readermenu")
    if ok_r then patchMenuTabs(ReaderMenu, "onTapCloseMenu") end
    local ok_f, FileManagerMenu = pcall(require, "apps/filemanager/filemanagermenu")
    if ok_f then patchMenuTabs(FileManagerMenu, "onCloseFileManagerMenu") end
end

local function installCards()
    local ok, OPDSBrowser = pcall(require, "opdsbrowser")
    if ok and OPDSBrowser then
        require("br_cards").install(OPDSBrowser)
    else
        logger.warn("BookRaven: OPDS plugin not available, cards view disabled")
    end
end

--- Each hook on its own: one that fails leaves the others (and the plugin) working.
local function installHooks()
    if hooks_installed then return end
    hooks_installed = true
    try("adding the menu entries", placeMenuItems)
    try("adding the Start with choice", patchStartWith)
    try("adding the quick settings tab", installQuickTab)
    try("adding the raven and the magnifier to title bars", function() require("br_nav").install() end)
    try("installing the cards view", installCards)
end

function BookRaven:init()
    installHooks()
    try("registering the menu", function() self.ui.menu:registerToMainMenu(self) end)
    try("registering the gesture actions", function()
        local Dispatcher = require("dispatcher")
        -- So a gesture or corner tap can open the library (Settings → Taps and gestures).
        Dispatcher:registerAction("bookraven_open_library", {
            category = "none",
            event = "BookRavenOpenLibrary",
            title = _("BookRaven library"),
            filemanager = true,
        })
        -- The quick settings panel, for a gesture of your choice, also in a book. (On the plugin's
        -- own screens a swipe down from the top edge opens it; KOReader's swipe in books is untouched.)
        Dispatcher:registerAction("bookraven_quick_settings", {
            category = "none",
            event = "BookRavenQuickSettings",
            title = _("BookRaven quick settings"),
            general = true,
        })
    end)

    if not self.ui.document then
        try("restyling the file browser", function() self:decorateFileManager() end)
    end

    if not start_done then
        start_done = true
        UIManager:scheduleIn(5, function() if Covers then pcall(Covers.prune, Covers) end end)
    end
    if not self.ui.document and G_reader_settings:readSetting("start_with") == Settings.START_WITH then
        -- At start-up, and when coming back from a book: the home, over the file browser, as soon
        -- as the file browser is shown (onShow, before anything is painted: the file browser never
        -- flashes by). If it is never shown that way, on the next tick.
        self._open_on_show = true
        UIManager:nextTick(function()
            if self._open_on_show then
                self._open_on_show = nil
                self:openLibrary()
            end
        end)
    end
end

--- The file browser is titled after the app it belongs to, and its rows get the theme's looks.
function BookRaven:decorateFileManager()
    local theme = Theme.current()
    if not theme then return end
    if theme.fm_title and self.ui.title then
        self.ui.title = theme.fm_title
    end
    -- The file browser's list is built after the plugins: restyle its rows once it exists.
    local function decorate()
        local fc = self.ui.file_chooser
        if not fc then return end
        require("br_style").decorateFileChooser(fc)
        if fc.refreshPath then pcall(fc.refreshPath, fc) end
    end
    if type(self.ui.postInitCallback) == "table" then
        table.insert(self.ui.postInitCallback, function() try("restyling the file list", decorate) end)
    else
        UIManager:nextTick(function() try("restyling the file list", decorate) end)
    end
end

--- The file browser was just shown (its Show event reaches its plugins): the home goes over it
--- before the first paint.
function BookRaven:onShow()
    if self._open_on_show then
        self._open_on_show = nil
        self:openLibrary()
    end
end

--- Shows the BookRaven library home over the file browser.
function BookRaven:openLibrary()
    if self.ui.document then return end
    if self.home and not self.home._closed then return end
    local ok, Home = pcall(require, "br_home")
    if not ok then
        logger.err("BookRaven: home unavailable", Home)
        UIManager:show(InfoMessage:new{ text = _("The BookRaven library could not open. See crash.log for details.") })
        return
    end
    local ok_new, home = pcall(Home.new, Home, { ui = self.ui })
    if not ok_new then
        logger.err("BookRaven: the home could not be built", home)
        UIManager:show(InfoMessage:new{ text = _("The BookRaven library could not open. See crash.log for details.") })
        return
    end
    self.home = home
    UIManager:show(self.home, "flashui")
end

function BookRaven:onCloseWidget()
    self._open_on_show = nil
    if self.home and not self.home._closed then
        self.home._closed = true
        UIManager:close(self.home)
    end
    self.home = nil
end

function BookRaven:onBookRavenOpenLibrary()
    if not require("br_nav").goHome() then self:openLibrary() end
    return true
end

function BookRaven:onBookRavenQuickSettings()
    require("br_quick").show(self.ui)
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
            choice(_("Classic e-reader (Kindle-style)"), "classic"),
        },
    }
end

--- Text on the plugin's screens: size, bold and font (the quick settings have the same).
function BookRaven:textMenu()
    local function changed()
        UIManager:broadcastEvent(require("ui/event"):new("BookRavenTextChanged"))
        if Theme.textPending() then
            UIManager:askForRestart(_("KOReader's menus and dialogs use the new text after a restart."))
        end
    end
    local sizes = {}
    for _, v in ipairs(Settings.TEXT_SCALES) do
        table.insert(sizes, {
            text = string.format("%d%%", v),
            radio = true,
            checked_func = function() return Settings.text().scale == v end,
            callback = function()
                Settings.set("text_scale", v)
                changed()
            end,
        })
    end
    local fonts = {}
    for _, fam in ipairs(Theme.FAMILIES) do
        table.insert(fonts, {
            text = fam.label,
            radio = true,
            checked_func = function() return Settings.text().font == fam.key end,
            callback = function()
                Settings.set("text_font", fam.key)
                changed()
            end,
        })
    end
    return {
        text = _("Text"),
        sub_item_table = {
            {
                text_func = function() return T(_("Text size: %1%"), Settings.text().scale) end,
                sub_item_table = sizes,
            },
            {
                text = _("Bold text"),
                checked_func = function() return Settings.text().bold end,
                callback = function()
                    Settings.set("text_bold", not Settings.text().bold)
                    changed()
                end,
            },
            {
                text_func = function()
                    local fam = Theme.family(Settings.text().font)
                    return T(_("Font: %1"), fam and fam.label or _("Theme's own"))
                end,
                sub_item_table = fonts,
            },
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
                    local n = Covers and Covers:clear() or 0
                    UIManager:show(InfoMessage:new{ text = T(_("Removed %1 cached covers."), n), timeout = 2 })
                end,
            },
        },
    }
end

function BookRaven:addToMainMenu(menu_items)
    if not self.ui.document then -- next to "OPDS catalog", which only the file browser has
        menu_items.bookraven_library = {
            text = _("BookRaven library"),
            callback = function()
                self:openLibrary()
            end,
        }
    end
    local items = {}
    for _, build in ipairs({ "themeMenu", "textMenu", "viewMenu" }) do
        local ok, item = try("building the " .. build, self[build], self)
        if ok and item then table.insert(items, item) end
    end
    table.insert(items, {
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
    })
    table.insert(items, {
        text_func = function()
            local ok, Account = pcall(require, "br_account")
            local email = ok and Account.credentials(self.ui)
            return email and T(_("Account: %1"), email) or _("Set up BookRaven account…")
        end,
        keep_menu_open = true,
        callback = function(touchmenu_instance)
            require("br_account").showDialog(self.ui, function()
                if touchmenu_instance then touchmenu_instance:updateItems() end
            end)
        end,
    })
    table.insert(items, {
        text = _("Open the BookRaven library"),
        enabled_func = function() return not self.ui.document end,
        callback = function() self:openLibrary() end,
    })
    table.insert(items, {
        text = _("Quick settings…"),
        help_text = _("Wi-Fi, brightness, warmth, dark mode, text size, bold and font. On the BookRaven screens, swipe down from the top edge to open them."),
        callback = function() require("br_quick").show(self.ui) end,
    })
    menu_items.bookraven = {
        text = "BookRaven",
        sub_item_table = items,
    }
end

return BookRaven
