--[[--
Getting around the plugin's screens.

  * Screen changes refresh the whole screen. The plugin's full-screen screens (the library home,
    folder shelves, On this Kindle, All shelves, search results, and the catalog) are shown and
    closed with a full-screen "flashui" refresh (Nav.show, Nav.flashOnClose). KOReader only adds
    a full-screen refresh of its own when nothing else asked for one: a button's highlight asks
    for its own small area, and on e-ink everything outside it kept showing the previous screen.
  * The raven: the theme's raven (its home button) at the top left of every plugin screen, of the
    catalog, and of the file browser when a theme is on or the library is the start screen. A tap
    closes every screen open over the file browser and comes back to the library home
    (Nav.goHome); on the home itself it asks the server again and lays the home out anew.
  * The title bar extras (Nav.installTitleBar): the raven on the left and the magnifier
    (br_search) on the right, for the screens that ask for them: a window-level widget with
    _br_title_home(self) and/or _br_title_search(self) returning the tap callback (or nil).
]]

local Device = require("device")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local Screen = Device.screen

local Nav = {
    RAVEN = "br.raven", -- the icon name of the raven (see Nav.ravenFile)
}

--- The size of KOReader's title bar icons (DGENERIC_ICON_SIZE, 40 at 160 dpi) times ratio.
function Nav.iconSize(ratio)
    local defaults = rawget(_G, "G_defaults")
    local ok, base = pcall(function() return defaults and defaults:readSetting("DGENERIC_ICON_SIZE") end)
    base = ok and tonumber(base) or 40
    return Screen:scaleBySize(base * (ratio or 1))
end

-- ------------------------------------------------------------------ refreshes

--- Shows a full-screen screen with a full-screen flashing refresh.
function Nav.show(widget)
    UIManager:show(widget, "flashui")
end

--- From a full-screen screen's CloseWidget: refresh the whole screen with a flash, once what is
--- under it has been painted. Not while the file browser is going away (a book is opening: the
--- reader refreshes the whole screen itself), and not when the screen was closed to open a book.
function Nav.flashOnClose(widget)
    if widget and widget._br_quiet then return end
    UIManager:setDirty(nil, function()
        local ok, FileManager = pcall(require, "apps/filemanager/filemanager")
        local fm = ok and FileManager.instance
        if not fm or fm.tearing_down then return end
        return "flashui"
    end)
end

--- Closes a screen without a flash of its own (a book is about to open over everything).
function Nav.closeQuietly(widget)
    if not widget then return end
    widget._br_quiet = true
    UIManager:close(widget)
end

-- ------------------------------------------------------------------ the raven

--- The theme's raven: its own br.raven, else its home button (the medallion), else BookRaven's.
function Nav.ravenFile()
    local Theme = require("br_theme")
    local dir = Theme.plugin_dir or "."
    local theme = Theme.current()
    local candidates = {}
    if theme and theme.icons then
        for _, name in ipairs({ "br.raven.svg", "home.svg", "home.png" }) do
            table.insert(candidates, dir .. "/" .. theme.icons .. "/" .. name)
        end
    end
    table.insert(candidates, dir .. "/icons/bookraven/home.svg")
    for _, path in ipairs(candidates) do
        if lfs.attributes(path, "mode") == "file" then return path end
    end
end

local function fileManager()
    local ok, FileManager = pcall(require, "apps/filemanager/filemanager")
    return ok and FileManager.instance or nil
end

--- Closes every screen open over the file browser and shows the library home (the one already
--- open, laid out again, or a new one). Returns false in a book (nothing to do there).
function Nav.goHome()
    local fm = fileManager()
    if not fm or fm.tearing_down then return false end
    local above, home = {}, nil
    for n = 1, 100 do
        local w = UIManager:getNthTopWidget(n)
        if not w or w == fm then break end
        if w.name == "bookraven_home" and not w._closed then
            home = w
            break
        end
        table.insert(above, w)
    end
    for _, w in ipairs(above) do
        if not w.toast then
            -- Menus (shelves, results, the catalog) close with their close_callback (the catalog
            -- forgets its browser there); anything else is simply closed.
            local ok, err = pcall(function()
                if type(w.onCloseAllMenus) == "function" then
                    w:onCloseAllMenus()
                else
                    UIManager:close(w)
                end
            end)
            if not ok then
                logger.warn("BookRaven: could not close a screen", err)
                UIManager:close(w)
            end
        end
    end
    if home then
        -- What changed meanwhile (a book read or downloaded), then the server if it is due.
        if home.resetToHome then home:resetToHome() end -- CyberUI: its home screen
        home:rebuild(true)
        UIManager:nextTick(function() home:refresh() end)
    elseif fm.bookraven and fm.bookraven.openLibrary then
        fm.bookraven:openLibrary()
    end
    return true
end

-- ------------------------------------------------------------------ title bars

--- parent[key](parent), when it is a function that returns a callback.
local function ask(parent, key)
    local fn = type(parent) == "table" and parent[key]
    if type(fn) ~= "function" then return nil end
    local ok, callback = pcall(fn, parent)
    if ok and type(callback) == "function" then return callback end
    if not ok then logger.warn("BookRaven title bar:", key, callback) end
end

--- Adds the raven (left) and the magnifier (right, next to the close button) to the title bars
--- of the screens that ask for them. A title bar without a left button gets the raven as its
--- left button, and so does the file browser's home button (its long-press is kept); one with
--- another left button (the catalog's menu) gets the raven before it.
function Nav.installTitleBar()
    local TitleBar = require("ui/widget/titlebar")
    if TitleBar._br_extras then return end
    TitleBar._br_extras = true
    local IconButton = require("ui/widget/iconbutton")
    local orig_init = TitleBar.init
    TitleBar.init = function(self, ...)
        -- (init runs again when a title that shrinks to fit changes: start from the original padding)
        if self._br_pad ~= nil then self.title_h_padding = self._br_pad end
        local parent = self.show_parent
        local search = ask(parent, "_br_title_search")
        local home = ask(parent, "_br_title_home")
        if not search and not home then return orig_init(self, ...) end
        self._br_pad = self._br_pad or self.title_h_padding or 0
        local pad = self.button_padding or Screen:scaleBySize(11)
        local extra_raven = false
        if home then
            if self._br_raven_own or not self.left_icon or self.left_icon == "home" then
                self._br_raven_own = true
                self.left_icon = Nav.RAVEN
                self.left_icon_tap_callback = home
                self.left_icon_allow_flash = false -- it closes the screen
            else
                extra_raven = true
            end
        end
        local lsize = Nav.iconSize(self.left_icon_size_ratio or 0.6)
        local rsize = Nav.iconSize(self.right_icon_size_ratio or 0.6)
        -- Keep the title clear of the extra buttons (the padding applies to both of its sides).
        local extra = math.max(extra_raven and (lsize + pad) or 0, search and (rsize + pad) or 0)
        self.title_h_padding = self._br_pad + extra
        local ret = orig_init(self, ...)
        for _, w in ipairs(self) do
            if w._br_extra then return ret end -- already added by a nested init
        end
        if search then
            local right = (self.close_callback or self.right_icon) and (rsize + 2 * pad) or 0
            local button = IconButton:new{
                icon = "appbar.search",
                width = rsize,
                height = rsize,
                padding = pad,
                padding_bottom = rsize,
                overlap_offset = { self.width - right - rsize - 2 * pad, 0 },
                callback = search,
                show_parent = parent,
            }
            button._br_extra = true
            table.insert(self, 1, button) -- before the other buttons, whose tap zones reach this far
        end
        if extra_raven and self.left_button then
            local raven = IconButton:new{
                icon = Nav.RAVEN,
                width = lsize,
                height = lsize,
                padding = pad,
                padding_bottom = lsize,
                overlap_offset = { 0, 0 },
                callback = home,
                allow_flash = false,
                show_parent = parent,
            }
            raven._br_extra = true
            -- The title bar's own left button moves right, after the raven.
            self.left_button.overlap_align = nil
            self.left_button.overlap_offset = { lsize + 2 * pad, 0 }
            table.insert(self, 1, raven)
        end
        return ret
    end
end

--- Once, while the plugin starts: the raven's icon, the file browser's raven, the title bars.
function Nav.install()
    local Style = require("br_style")
    local raven = Nav.ravenFile()
    if raven then Style.addIcon(Nav.RAVEN, raven) end
    local ok, FileManager = pcall(require, "apps/filemanager/filemanager")
    if ok and FileManager and not rawget(FileManager, "_br_title_home") then
        -- The file browser's home button (top left) is the raven when the theme draws it as one
        -- (any theme but KOReader's own) or when the library is the start screen: a tap opens the
        -- library. "Go to HOME folder" stays in its + menu, and a long-press still opens its
        -- folder menu.
        FileManager._br_title_home = function(fm)
            local Settings = require("br_settings")
            local themed = require("br_theme").current() ~= nil
            local start = G_reader_settings:readSetting("start_with") == Settings.START_WITH
            if fm.tearing_down or not (themed or start) then return nil end
            return function() Nav.goHome() end
        end
    end
    Nav.installTitleBar()
end

return Nav
