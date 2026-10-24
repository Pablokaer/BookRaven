--[[--
Shelves you add from folders on the device.

  * Gallery: a folder's books as cards with their covers (and its sub-folders as cards you can
    open), like the catalog's "My library". Tap a book to open it. The arrow at the bottom left
    goes back up to the parent folder, down to the shelf's own folder.
  * ShelfMenu: every shelf on one page (the catalog's and yours, and "Add a shelf"), for when the
    home has no room left to show them all.

Both have a magnifier in the title bar (br_search): the gallery searches its folder and all the
folders in it, and shows the books found in the same grid (the back arrow, or "Clear search",
returns to the shelf); All shelves searches every shelf (your folders and the catalog) at once.
A swipe down from the top edge opens the quick settings (br_quick).

Folder shelves are kept in the plugin settings under "local_shelves" ({ path, title }).
]]

local DocumentRegistry = require("document/documentregistry")
local InfoMessage = require("ui/widget/infomessage")
local Menu = require("ui/widget/menu")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local _ = require("gettext")
local T = require("ffi/util").template

local Cards = require("br_cards")
local Covers = require("br_covers")
local Settings = require("br_settings")
local Theme = require("br_theme")
local W = require("br_widgets")

local Shelves = {}

function Shelves.folderName(path)
    return (path or ""):match("([^/]+)/*$") or path
end

--- The folder shelves, as saved.
function Shelves.list()
    local list = {}
    for _, shelf in ipairs(Settings.get("local_shelves") or {}) do
        if type(shelf) == "table" and shelf.path then table.insert(list, shelf) end
    end
    return list
end

--- Adds a folder. Returns false (and the shelf) if it is already there.
function Shelves.add(path)
    local list = Shelves.list()
    for _, shelf in ipairs(list) do
        if shelf.path == path then return false, shelf end
    end
    local shelf = { path = path, title = Shelves.folderName(path) }
    table.insert(list, shelf)
    Settings.set("local_shelves", list)
    return true, shelf
end

function Shelves.remove(path)
    local list = {}
    for _, shelf in ipairs(Shelves.list()) do
        if shelf.path ~= path then table.insert(list, shelf) end
    end
    Settings.set("local_shelves", list)
end

local function isBookFile(path)
    local ok, has = pcall(DocumentRegistry.hasProvider, DocumentRegistry, path)
    return ok and has
end

--- How many books a folder holds (not counting sub-folders), or nil if it is gone.
function Shelves.count(path)
    if lfs.attributes(path, "mode") ~= "directory" then return nil end
    local n = 0
    for name in lfs.dir(path) do
        if name:sub(1, 1) ~= "." then
            local full = path .. "/" .. name
            if lfs.attributes(full, "mode") == "file" and isBookFile(full) then n = n + 1 end
        end
    end
    return n
end

--- A shelf's note on its tile.
function Shelves.note(path)
    local n = Shelves.count(path)
    if not n then return _("Folder not found on this device") end
    if n == 0 then return _("No books yet · on this device") end
    if n == 1 then return _("1 book · on this device") end
    return T(_("%1 books · on this device"), n)
end

--- Title and author of a book file, from the cover browser's index or the file name.
local function describe(path)
    local title, author
    local ok_bim, BookInfoManager = pcall(require, "bookinfomanager")
    if ok_bim and BookInfoManager then
        local ok, info = pcall(BookInfoManager.getBookInfo, BookInfoManager, path, false)
        if ok and info then
            title = info.title
            author = info.authors and info.authors:gsub("\n", ", ")
        end
    end
    if not title or title == "" then
        local name = path:match("([^/]+)%.[^./]+$") or path:match("([^/]+)$")
        local a, t = name:match("^(.-) %- (.+)$")
        title = t or name
        author = author or a
    end
    return title, author
end
Shelves.describe = describe

local function natural(a, b)
    return a:lower() < b:lower()
end

-- ------------------------------------------------------------------ Gallery

local Gallery = Menu:extend{
    covers_fullscreen = true,
    is_borderless = true,
    is_popout = false,
    title_bar_fm_style = true,
    root = nil, -- the shelf's folder
    home = nil, -- the library home, closed when a book opens
}
Shelves.Gallery = Gallery

function Gallery:list(dir)
    local dirs, books = {}, {}
    for name in lfs.dir(dir) do
        if name:sub(1, 1) ~= "." then
            local path = dir .. "/" .. name
            local mode = lfs.attributes(path, "mode")
            if mode == "directory" and not name:match("%.sdr$") then
                table.insert(dirs, { text = name, title = name, dir = path })
            elseif mode == "file" and isBookFile(path) then
                local title, author = describe(path)
                table.insert(books, {
                    text = title, title = title, author = author,
                    local_file = path, cover_path = Covers:cachedBook(path),
                })
            end
        end
    end
    table.sort(dirs, function(a, b) return natural(a.title, b.title) end)
    table.sort(books, function(a, b) return natural(a.title, b.title) end)
    local used_art = {}
    for i, folder in ipairs(dirs) do
        folder.art = W.shelfArt(Theme.plugin_dir, folder.title, i, used_art)
        local n = Shelves.count(folder.dir) or 0
        folder.note = n == 1 and _("1 book") or T(_("%1 books"), n)
    end
    for _, book in ipairs(books) do table.insert(dirs, book) end
    return dirs
end

function Gallery:init()
    self.current = self.root
    self.title = self.title or Shelves.folderName(self.root)
    self.item_table = self:list(self.root)
    Menu.init(self)
    self.paths = {} -- Menu's own trail, used here for sub-folders
    if #self.item_table == 0 then
        UIManager:nextTick(function()
            UIManager:show(InfoMessage:new{ text = _("No books in this folder yet."), timeout = 3 })
        end)
    end
end

function Gallery:updateItems(select_number, no_recalculate_dimen)
    local ok, err = pcall(Cards.updateItems, self, select_number)
    if ok then return end
    logger.err("BookRaven: folder gallery failed, showing a list", err)
    self.perpage = nil
    return Menu.updateItems(self, select_number, false)
end

function Gallery:onMenuSelect(entry)
    if entry.dir then
        table.insert(self.paths, { path = self.current, title = self.title })
        self.current = entry.dir
        self:switchItemTable(entry.title, self:list(entry.dir))
    elseif entry.local_file then
        self._br_closed = true
        UIManager:close(self)
        if self.home then
            self.home:openBook(entry.local_file)
        elseif self.ui then
            self.ui:openFile(entry.local_file)
        end
    end
    return true
end

function Gallery:onMenuHold()
    return true
end

function Gallery:onReturn()
    local back = table.remove(self.paths)
    if not back then return true end
    self.query, self.show_where = nil, false -- leaving the search results, if they were shown
    self.current = back.path
    self:switchItemTable(back.title, self:list(back.path))
    return true
end

--- The magnifier: search this shelf's folder and every folder in it.
function Gallery:_br_title_search()
    return function()
        local Search = require("br_search")
        Search.prompt{
            title = T(_("Search in %1"), Shelves.folderName(self.root)),
            query = self.query,
            on_clear = self.query and function() self:onReturn() end or nil,
            on_search = function(query) self:search(query) end,
        }
    end
end

function Gallery:search(query)
    local Search = require("br_search")
    local root = self.root
    local function where(path)
        -- the folder it is in, inside the shelf ("Gothic/Deep"), or the shelf itself
        local dir = path:match("^(.*)/[^/]+$") or root
        local inside = dir:sub(#root + 2)
        return inside ~= "" and inside or Shelves.folderName(root)
    end
    local found
    local ok, err = pcall(function() found = Search.inFolders({ root }, query, where) end)
    if not ok then
        logger.err("BookRaven: shelf search failed", err)
        return
    end
    if #found == 0 then
        UIManager:show(InfoMessage:new{
            text = T(_("Nothing in “%1” matches “%2”."), Shelves.folderName(root), query), timeout = 3,
        })
        return
    end
    if not self.query then
        table.insert(self.paths, { path = self.current, title = self.title_bar and self.title_bar.title or self.title })
    end
    self.query, self.show_where = query, true
    self:switchItemTable(T(_("Search: %1"), query), found)
end

function Gallery:onSwipe(arg, ges_ev)
    local Quick = require("br_quick")
    if Quick.fromTop(ges_ev) then
        Quick.show(self)
        return true
    end
    return Menu.onSwipe(self, arg, ges_ev)
end

function Gallery:onBookRavenTextChanged()
    self:updateItems()
end

function Gallery:onCloseWidget()
    self._br_closed = true
    return Menu.onCloseWidget(self)
end

-- ------------------------------------------------------------------ All shelves

local ShelfMenu = Menu:extend{
    covers_fullscreen = true,
    is_borderless = true,
    is_popout = false,
    title_bar_fm_style = true,
    home = nil,
}
Shelves.ShelfMenu = ShelfMenu

function ShelfMenu:init()
    self.title = _("Shelves")
    self.item_table = self.home:shelfEntries()
    Menu.init(self)
end

function ShelfMenu:reload()
    self:switchItemTable(nil, self.home:shelfEntries())
end

function ShelfMenu:updateItems(select_number)
    local ok, err = pcall(Cards.updateShelves, self, select_number)
    if ok then return end
    logger.err("BookRaven: shelves page failed, showing a list", err)
    self.perpage = nil
    return Menu.updateItems(self, select_number, false)
end

function ShelfMenu:onMenuSelect(entry)
    self.home:shelfAction(entry, self)
    return true
end

function ShelfMenu:onMenuHold(entry)
    self.home:shelfHold(entry, self)
    return true
end

--- The magnifier: every shelf at once (your folders, and the catalog when it is on them).
function ShelfMenu:_br_title_search()
    return function()
        local roots, catalog, public = {}, false, false
        for _, entry in ipairs(self.home:shelfEntries()) do
            if entry.kind == "folder" then
                table.insert(roots, entry.local_path)
            elseif entry.kind == "catalog" then
                catalog = true
                if entry.url and entry.url:match("/public/?$") then public = true end
            end
        end
        require("br_search").start{
            ui = self.home.ui,
            home = self.home,
            title = _("Search all shelves"),
            scope = { roots = roots, catalog = catalog, public = public },
            close_also = { self },
        }
    end
end

function ShelfMenu:onSwipe(arg, ges_ev)
    local Quick = require("br_quick")
    if Quick.fromTop(ges_ev) then
        Quick.show(self)
        return true
    end
    return Menu.onSwipe(self, arg, ges_ev)
end

function ShelfMenu:onBookRavenTextChanged()
    self:updateItems()
end

return Shelves
