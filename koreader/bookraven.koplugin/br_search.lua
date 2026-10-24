--[[--
Search for the BookRaven plugin.

  * One search for everything (the magnifier on the home's top bar): the books on this device
    (KOReader's home folder, the folder shelves, the download folder, the last folder you were
    in and the books you have opened), your BookRaven library (the catalog's OpenSearch) and the
    Public Library. The results are one grid of cards, each saying where the book is; tap one to
    open it (a catalog book is downloaded first, like the catalog's own download button; long-press
    it for KOReader's download dialog: formats, folder, book information).
  * A magnifier in the title bar of every shelf: it searches that shelf. A folder shelf with all
    its sub-folders (br_gallery), a catalog shelf with all its pages (searchFeed), All shelves
    with every shelf, and the search results themselves (a new search).

The device's books are listed once, then kept for ten minutes: the walk skips hidden folders,
".sdr" folders and KOReader's own folder, and stops at MAX_FILES books, MAX_DIRS folders or
WALK_SECONDS seconds, so it stays quick on a Kindle. Titles and authors come from KOReader's
book information cache (the cover browser's) when it has them, else from the file name
("Author - Title.epub"). The Public Library has no search of its own on the server: its "All
books" feed is read once per session (up to PUBLIC_PAGES pages) and searched here.
]]

local Device = require("device")
local DocumentRegistry = require("document/documentregistry")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local Menu = require("ui/widget/menu")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local _ = require("gettext")
local T = require("ffi/util").template

local Cards = require("br_cards")
local Covers = require("br_covers")
local Settings = require("br_settings")

local Search = {
    MAX_FILES = 6000,
    MAX_DIRS = 2500,
    MAX_DEPTH = 10,
    WALK_SECONDS = 4,
    INDEX_TTL = 600, -- seconds the list of the device's books is kept
    CATALOG_PAGES = 4, -- pages of server search results (50 books each on BookRaven)
    PUBLIC_PAGES = 20, -- pages of the Public Library's "All books" read for searching it
    PUBLIC_TTL = 1800,
    FEED_PAGES = 20, -- pages of a catalog shelf read when searching it
    index = nil, -- { time, key, files = { { path, title, author, key } } }
    public = nil, -- { time, url, items }
    search_urls = {}, -- catalog url -> its OpenSearch template ("…?q=%s")
}

-- Files KOReader opens that are not books: a search for books leaves them out.
local NOT_BOOKS = { png = true, jpg = true, jpeg = true, gif = true, webp = true, bmp = true, svg = true, tif = true, tiff = true }

-- ------------------------------------------------------------------ matching

-- Accented Latin letters, after lowercasing, and what they are searched as.
local FOLD = { ["ß"] = "ss", ["æ"] = "ae", ["œ"] = "oe" }
for plain, chars in pairs({ a = "àáâãäåā", c = "çč", e = "èéêëēě", i = "ìíîïī", n = "ñń", o = "òóôõöøō",
        u = "ùúûüū", y = "ýÿ", s = "šś", z = "žź", r = "ř", l = "ł", g = "ğ" }) do
    for ch in chars:gmatch("[\192-\255][\128-\191]*") do FOLD[ch] = plain end
end

--- Text as it is compared: lowercase, accents and punctuation dropped, single spaces.
function Search.norm(text)
    if type(text) ~= "string" or text == "" then return "" end
    local ok, low = pcall(require("ffi/utf8proc").lowercase, text)
    text = ok and low or text:lower()
    text = text:gsub("[\192-\255][\128-\191]*", FOLD)
    return (text:gsub("[%p%c]", " "):gsub("%s+", " "):gsub("^ ", ""):gsub(" $", ""))
end
local norm = Search.norm

--- The words of a search, compared as above.
function Search.words(query)
    local words = {}
    for w in norm(query):gmatch("%S+") do table.insert(words, w) end
    return words
end

--- 0 when the title starts with the search, 1 when it holds it, 2 when every word is
--- somewhere (title, author or file name), nil when it does not match.
local function rank(key, title, words, phrase)
    for _, w in ipairs(words) do
        if not key:find(w, 1, true) then return nil end
    end
    if title:sub(1, #phrase) == phrase then return 0 end
    if title:find(phrase, 1, true) then return 1 end
    return 2
end

--- Keeps the entries that match, best first. Each entry needs _key and _title (normalized).
local function filter(entries, query)
    local words = Search.words(query)
    if #words == 0 then return {} end
    local phrase = table.concat(words, " ")
    local found = {}
    for _, e in ipairs(entries) do
        local r = rank(e._key, e._title, words, phrase)
        if r then
            e._rank = r
            table.insert(found, e)
        end
    end
    table.sort(found, function(a, b)
        if a._rank ~= b._rank then return a._rank < b._rank end
        return a._title < b._title
    end)
    return found
end
Search.filter = filter

local function keyed(e, title, author, extra)
    e._title = norm(title)
    e._key = e._title .. " | " .. norm(author) .. " | " .. norm(extra)
    return e
end

-- ------------------------------------------------------------------ books on the device

local function now()
    local ok, socket = pcall(require, "socket")
    return ok and socket.gettime() or os.time()
end

local function isBook(path)
    local ext = util.getFileNameSuffix(path)
    if not ext or NOT_BOOKS[ext:lower()] then return false end
    local ok, has = pcall(DocumentRegistry.hasProvider, DocumentRegistry, path)
    return ok and has and true or false
end

--- The book files under these folders (breadth first, capped). Returns the paths and whether
--- the walk stopped early.
function Search.walk(roots, seen)
    seen = seen or {}
    local skip = {}
    local ok_ds, DataStorage = pcall(require, "datastorage")
    if ok_ds then skip[DataStorage:getDataDir()] = true end
    local files, dirs = {}, 0
    local deadline = now() + Search.WALK_SECONDS
    local queue, head = {}, 1
    for _, root in ipairs(roots) do table.insert(queue, { root, 0 }) end
    while queue[head] do
        local dir, depth = queue[head][1], queue[head][2]
        head = head + 1
        if not seen[dir] and not skip[dir] then
            seen[dir] = true
            dirs = dirs + 1
            local ok, iter, obj = pcall(lfs.dir, dir)
            if ok and iter then
                for name in iter, obj do
                    if name:sub(1, 1) ~= "." then
                        local path = (dir == "/" and "" or dir) .. "/" .. name
                        local mode = lfs.attributes(path, "mode")
                        if mode == "directory" then
                            if depth < Search.MAX_DEPTH and not name:match("%.sdr$") then
                                table.insert(queue, { path, depth + 1 })
                            end
                        elseif mode == "file" and isBook(path) then
                            table.insert(files, path)
                            if #files >= Search.MAX_FILES then return files, true end
                        end
                    end
                end
            end
            if dirs >= Search.MAX_DIRS or now() > deadline then
                return files, queue[head] ~= nil
            end
        end
    end
    return files, false
end

--- Titles and authors KOReader's book information cache knows, by path (one query for all).
local function knownMetadata()
    local meta = {}
    local ok_bim, BookInfoManager = pcall(require, "bookinfomanager")
    if not ok_bim or not BookInfoManager then return meta end
    local ok, err = pcall(function()
        BookInfoManager:openDbConnection()
        local stmt = BookInfoManager.db_conn:prepare(
            "SELECT directory, filename, title, authors FROM bookinfo WHERE has_meta = 'Y';")
        local row = stmt:step()
        while row do
            meta[tostring(row[1]) .. tostring(row[2])] = { title = row[3], authors = row[4] }
            row = stmt:step()
        end
        stmt:close()
    end)
    if not ok then logger.dbg("BookRaven search: no book information cache", err) end
    return meta
end

--- Title and author of a file name: "Author - Title.epub", or the name.
local function fromName(path)
    local name = path:match("([^/]+)%.[^./]+$") or path:match("([^/]+)$") or path
    local author, title = name:match("^(.-) %- (.+)$")
    return title or name, author
end

local function folderName(path)
    return (path:match("^(.*)/[^/]+$") or ""):match("([^/]+)$") or "/"
end

local function format(path)
    local ext = util.getFileNameSuffix(path)
    return ext and ext:upper() or ""
end

--- Where the plugin looks for books on the device, without folders inside others.
function Search.deviceRoots()
    local list = {}
    local function add(path)
        if type(path) ~= "string" or path == "" then return end
        path = path:gsub("/+$", "")
        if path == "" then path = "/" end
        if lfs.attributes(path, "mode") == "directory" then table.insert(list, path) end
    end
    add(G_reader_settings:readSetting("home_dir"))
    add(Device.home_dir)
    add(G_reader_settings:readSetting("download_dir"))
    add(G_reader_settings:readSetting("lastdir"))
    for _, shelf in ipairs(require("br_gallery").list()) do add(shelf.path) end
    table.sort(list, function(a, b) return #a < #b end)
    local roots = {}
    for _, path in ipairs(list) do
        local inside = false
        for _, root in ipairs(roots) do
            if root == "/" or path == root or path:sub(1, #root + 1) == root .. "/" then inside = true; break end
        end
        if not inside then table.insert(roots, path) end
    end
    return roots
end

--- Turns book paths into search entries (cards), with what KOReader knows about each.
local function describeFiles(paths, meta, where_of)
    local list = {}
    for _, path in ipairs(paths) do
        local info = meta[path]
        local title, author
        if info and info.title and info.title ~= "" then
            title = info.title
            author = info.authors and info.authors:gsub("\n", ", ")
        end
        local name_title, name_author = fromName(path)
        title = title or name_title
        author = author or name_author
        local entry = {
            text = title, title = title, author = author,
            local_file = path, cover_path = Covers:cachedBook(path),
            where = where_of(path), format = format(path),
        }
        table.insert(list, keyed(entry, title, author, path:match("([^/]+)$")))
    end
    return list
end

local function onDevice(path)
    return T(_("On device · %1"), folderName(path))
end

--- The list of the device's books, made the first time and kept for INDEX_TTL seconds.
function Search.deviceIndex(force)
    local roots = Search.deviceRoots()
    local key = table.concat(roots, "\n")
    local idx = Search.index
    if not force and idx and idx.key == key and os.time() - idx.time < Search.INDEX_TTL then return idx end
    local started = now()
    local paths, capped = Search.walk(roots)
    -- The books you opened, wherever they are.
    local have = {}
    for _, p in ipairs(paths) do have[p] = true end
    local ok, ReadHistory = pcall(require, "readhistory")
    if ok and ReadHistory then
        for _, item in ipairs(ReadHistory.hist or {}) do
            if item.file and not have[item.file] and lfs.attributes(item.file, "mode") == "file" and isBook(item.file) then
                have[item.file] = true
                table.insert(paths, item.file)
            end
        end
    end
    local files = describeFiles(paths, knownMetadata(), onDevice)
    Search.index = { time = os.time(), key = key, files = files, capped = capped }
    logger.info("BookRaven search: listed", #files, "books on the device in", string.format("%.2fs", now() - started),
        capped and "(capped)" or "")
    return Search.index
end

--- Books in these folders (and their sub-folders) that match. where_of(path) labels each.
function Search.inFolders(roots, query, where_of)
    local paths = Search.walk(roots)
    return filter(describeFiles(paths, knownMetadata(), where_of or onDevice), query)
end

-- ------------------------------------------------------------------ the catalog

--- The BookRaven catalog's OPDS entry (title, url, username, password), if the account is set up.
function Search.account(ui)
    local opds = ui and ui.opds
    if not opds then return nil end
    pcall(opds.loadSettings, opds)
    return require("br_account").findCatalog(opds.servers)
end

--- A stand-in OPDS browser that reads feeds with the catalog's login, without touching the
--- one on screen. sync = true: no OpenSearch lookup on every page.
local function feedReader(entry, sync)
    local ok, OPDSBrowser = pcall(require, "opdsbrowser")
    if not ok or not OPDSBrowser then return nil end
    return setmetatable({
        root_catalog_title = entry.title,
        root_catalog_username = entry.username,
        root_catalog_password = entry.password,
        paths = {},
        item_table = {},
        sync = sync ~= false,
    }, { __index = OPDSBrowser }), OPDSBrowser
end
Search.feedReader = feedReader

--- One page of a feed as OPDS items (with .hrefs.next when there is a next page), or nil.
local function fetchItems(reader, OPDSBrowser, url)
    local ok, body = pcall(OPDSBrowser.fetchFeed, reader, url)
    if not ok or type(body) ~= "string" then return nil end
    local list
    ok, list = pcall(function()
        if body:sub(1, 1) == "{" then
            local catalog = require("json").decode(body)
            return OPDSBrowser.genItemTableFromCatalog2(reader, catalog, url)
        end
        local catalog = require("opdsparser"):parse(body)
        return OPDSBrowser.genItemTableFromCatalog(reader, catalog, url)
    end)
    if not ok then
        logger.warn("BookRaven search: could not read", url, list)
        return nil
    end
    return list
end

local function isBookItem(item)
    return item.acquisitions and item.acquisitions[1] ~= nil
end

--- The books of a feed and its next pages, up to max_pages pages.
local function feedBooks(reader, OPDSBrowser, url, max_pages)
    local books, pages = {}, 0
    while url and pages < max_pages do
        local list = fetchItems(reader, OPDSBrowser, url)
        if not list then break end
        pages = pages + 1
        for _, item in ipairs(list) do
            if isBookItem(item) then table.insert(books, item) end
        end
        url = list.hrefs and list.hrefs.next
    end
    return books
end

--- The file type of a catalog book ("EPUB", "CBZ"…) and the link it is downloaded from.
local function acquisition(item)
    local ok, OPDSBrowser = pcall(require, "opdsbrowser")
    if not ok then return nil end
    for _, acq in ipairs(item.acquisitions or {}) do
        if acq.href and not acq.count and acq.type ~= "borrow" then
            local ok2, ext = pcall(OPDSBrowser.getFiletype, acq)
            if ok2 and ext then return acq, ext end
        end
    end
end

--- Catalog items as search entries, labelled with where they come from.
local function catalogEntries(items, label, account)
    local list = {}
    for _, item in ipairs(items) do
        local _acq, ext = acquisition(item)
        local entry = {}
        for k, v in pairs(item) do entry[k] = v end
        entry.where = label
        entry.format = ext and ext:upper() or nil
        entry._account = account
        table.insert(list, keyed(entry, item.title or item.text, item.author, nil))
    end
    return list
end

--- The catalog's root items and its OpenSearch template, read once per session.
local function catalogRoot(entry)
    local cached = Search.search_urls[entry.url]
    if cached then return cached end
    local reader, OPDSBrowser = feedReader(entry, false)
    if not reader then return nil end
    local root = fetchItems(reader, OPDSBrowser, entry.url)
    if not root then return nil end
    cached = { items = root, search_url = reader.search_url }
    Search.search_urls[entry.url] = cached
    return cached
end

--- Your BookRaven library's books that match (the server searches titles, authors, series and tags).
function Search.inCatalog(entry, query)
    local root = catalogRoot(entry)
    if not root or not root.search_url then return nil end
    local reader, OPDSBrowser = feedReader(entry)
    local encoded = util.urlEncode(query)
    local url = root.search_url:gsub("%%s", function() return encoded end)
    local items = feedBooks(reader, OPDSBrowser, url, Search.CATALOG_PAGES)
    -- The server also matches series and tags; keep its answer, best titles first.
    local list = catalogEntries(items, _("BookRaven library"), entry)
    local found = filter(list, query)
    local kept = {}
    for _, e in ipairs(found) do kept[e] = true end
    for _, e in ipairs(list) do
        if not kept[e] then
            e._rank = 3
            table.insert(found, e)
        end
    end
    return found
end

--- The Public Library's "All books" feed, from the catalog's root.
local function publicUrl(entry)
    local root = catalogRoot(entry)
    if not root then return nil end
    local nav
    for _, item in ipairs(root.items) do
        local t = (item.title or ""):lower()
        if item.url and (item.url:match("/public/?$") or t == "public library") then nav = item.url; break end
    end
    if not nav then return nil end
    local reader, OPDSBrowser = feedReader(entry)
    local list = fetchItems(reader, OPDSBrowser, nav) or {}
    for _, item in ipairs(list) do
        local t = (item.title or ""):lower()
        if item.url and (item.url:match("/public/all/?$") or t == "all books") then return item.url end
    end
    return nav
end

--- The Public Library's books that match: its "All books" feed, read once per session.
function Search.inPublic(entry, query)
    local pub = Search.public
    if not pub or pub.account ~= entry.url or os.time() - pub.time > Search.PUBLIC_TTL then
        local url = publicUrl(entry)
        if not url then return nil end
        local reader, OPDSBrowser = feedReader(entry)
        local items = feedBooks(reader, OPDSBrowser, url, Search.PUBLIC_PAGES)
        pub = { time = os.time(), account = entry.url, items = catalogEntries(items, _("Public Library"), entry) }
        Search.public = pub
    end
    return filter(pub.items, query)
end

-- ------------------------------------------------------------------ running a search

local function online()
    local NetworkMgr = require("ui/network/manager")
    local ok, connected = pcall(NetworkMgr.isConnected, NetworkMgr)
    return not ok or connected ~= false
end

--- Shows a message while fn runs (the work blocks the UI), then closes it.
local function busy(text, fn)
    local msg = InfoMessage:new{ text = text }
    UIManager:show(msg)
    UIManager:forceRePaint()
    local ok, a, b = pcall(fn)
    UIManager:close(msg)
    if not ok then
        logger.err("BookRaven search failed", a)
        UIManager:show(InfoMessage:new{ text = _("The search failed. See crash.log for details.") })
        return nil
    end
    return a, b
end

--- Runs a search. scope: device (every book on the device), roots (only these folders),
--- catalog, public. Returns the entries (device first, then library, then Public Library) and a
--- summary line.
function Search.run(ui, scope, query)
    return busy(T(_("Searching for “%1”…"), query), function()
        local results, parts = {}, {}
        local function add(list, one, many)
            for _, e in ipairs(list or {}) do table.insert(results, e) end
            local n = list and #list or 0
            if n > 0 then table.insert(parts, n == 1 and one or T(many, n)) end
        end
        if scope.device then
            add(filter(Search.deviceIndex().files, query), _("1 on device"), _("%1 on device"))
        elseif scope.roots and #scope.roots > 0 then
            add(Search.inFolders(scope.roots, query), _("1 on your shelves"), _("%1 on your shelves"))
        end
        local account = (scope.catalog or scope.public) and Search.account(ui)
        if account and online() then
            if scope.catalog then
                add(Search.inCatalog(account, query), _("1 in your library"), _("%1 in your library"))
            end
            if scope.public then
                add(Search.inPublic(account, query), _("1 public"), _("%1 public"))
            end
        elseif account then
            table.insert(parts, _("offline: catalog not searched"))
        end
        return results, table.concat(parts, " · ")
    end)
end

--- Asks what to look for. args: title, query (pre-filled), description, on_search(query),
--- on_clear() (shows "Clear search": back to the shelf).
function Search.prompt(args)
    local dialog
    local row = {
        {
            text = _("Cancel"),
            id = "close",
            callback = function() UIManager:close(dialog) end,
        },
    }
    if args.on_clear then
        table.insert(row, {
            text = _("Clear search"),
            callback = function()
                UIManager:close(dialog)
                args.on_clear()
            end,
        })
    end
    table.insert(row, {
        text = _("Search"),
        is_enter_default = true,
        callback = function()
            local query = (dialog:getInputText() or ""):gsub("^%s+", ""):gsub("%s+$", "")
            if query == "" then return end
            UIManager:close(dialog)
            Settings.set("last_search", query)
            UIManager:nextTick(function() args.on_search(query) end)
        end,
    })
    dialog = InputDialog:new{
        title = args.title or _("Search"),
        input = args.query or "",
        input_hint = _("Title, author or file name"),
        description = args.description,
        buttons = { row },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

-- ------------------------------------------------------------------ opening a result

local function fileManager(ui)
    if ui then return ui end
    local ok, FileManager = pcall(require, "apps/filemanager/filemanager")
    return ok and FileManager.instance or nil
end

--- Opens a book on the device from a results screen (closing it, and the home under it).
function Search.openLocal(menu, path)
    if menu then
        menu._br_closed = true
        UIManager:close(menu)
        for _, w in ipairs(menu.close_also or {}) do UIManager:close(w) end
    end
    if menu and menu.home and not menu.home._closed then
        menu.home:openBook(path)
        return
    end
    local ui = fileManager(menu and menu.ui)
    if ui then ui:openFile(path) end
end

local function downloadDir()
    -- (not ipairs: any of these may be unset)
    local dirs = {
        G_reader_settings:readSetting("download_dir"), G_reader_settings:readSetting("home_dir"),
        G_reader_settings:readSetting("lastdir"), Device.home_dir,
    }
    for i = 1, 4 do
        local dir = dirs[i]
        if type(dir) == "string" and lfs.attributes(dir, "mode") == "directory" then
            return dir == "/" and "" or (dir:gsub("/+$", ""))
        end
    end
    return require("datastorage"):getDataDir()
end

--- A catalog book: downloaded into the download folder (or opened, if it is already there), then opened.
function Search.openRemote(menu, entry)
    local account = entry._account
    local acq, ext = acquisition(entry)
    if not account or not acq then
        UIManager:show(InfoMessage:new{ text = _("This book has no file KOReader can open.") })
        return
    end
    local reader, OPDSBrowser = feedReader(account)
    local name = OPDSBrowser.getFileName(reader, entry) or entry.title or "book"
    local dir = downloadDir()
    local path = dir .. "/" .. util.getSafeFilename(name .. "." .. ext:lower(), dir)
    if lfs.attributes(path, "mode") == "file" then
        Search.openLocal(menu, path)
        return
    end
    require("ui/network/manager"):runWhenConnected(function()
        local ok = busy(T(_("Downloading “%1”…"), entry.title or name), function()
            return OPDSBrowser.downloadFile(reader, path, acq.href, account.username, account.password)
        end)
        if ok then
            Search.index = nil -- the device has a new book
            Search.openLocal(menu, path)
        end
    end)
end

--- Long-press on a catalog book: KOReader's own download dialog (formats, folder, information).
function Search.downloadDialog(menu, entry)
    local account = entry._account
    if not account then return end
    local reader, OPDSBrowser = feedReader(account)
    local ui = fileManager(menu and menu.ui)
    local opds = ui and ui.opds
    if opds then
        pcall(opds.loadSettings, opds)
        reader._manager = opds
        reader.downloads = opds.downloads or {}
    else
        reader.downloads = {}
        reader._manager = { ui = ui or {} }
    end
    reader.file_downloaded_callback = function(path)
        Search.index = nil
        UIManager:nextTick(function() Search.openLocal(menu, path) end)
    end
    OPDSBrowser.showDownloads(reader, entry)
end

-- ------------------------------------------------------------------ the results screen

local Results = Menu:extend{
    covers_fullscreen = true,
    is_borderless = true,
    is_popout = false,
    title_bar_fm_style = true,
    show_where = true,
    home = nil,
    ui = nil,
    scope = nil,
    query = nil,
    summary = nil,
    close_also = nil, -- screens to close too when a book opens
}
Search.Results = Results

function Results:init()
    self.title = T(_("Search: %1"), self.query)
    self.subtitle = self.summary or ""
    local account
    for _, e in ipairs(self.item_table) do
        if e._account then account = e._account; break end
    end
    if account then -- for the covers of catalog books
        self.root_catalog_username = account.username
        self.root_catalog_password = account.password
    end
    Menu.init(self)
end

function Results:updateItems(select_number)
    local ok, err = pcall(Cards.updateItems, self, select_number)
    if ok then return end
    logger.err("BookRaven: search results failed, showing a list", err)
    self.perpage = nil
    return Menu.updateItems(self, select_number, false)
end

function Results:onMenuSelect(entry)
    if entry.local_file then
        Search.openLocal(self, entry.local_file)
    else
        Search.openRemote(self, entry)
    end
    return true
end

function Results:onMenuHold(entry)
    if not entry.local_file then Search.downloadDialog(self, entry) end
    return true
end

--- The magnifier on the results: a new search, same places.
function Results:_br_title_search()
    return function()
        Search.prompt{
            title = self.prompt_title,
            query = self.query,
            on_search = function(query)
                local results, summary = Search.run(self.ui, self.scope, query)
                if not results then return end
                if #results == 0 then
                    Search.nothingFound(query)
                    return
                end
                self.query, self.summary = query, summary
                self:switchItemTable(T(_("Search: %1"), query), results, nil, nil, summary)
            end,
        }
    end
end

function Results:onSwipe(arg, ges_ev)
    local Quick = require("br_quick")
    if Quick.fromTop(ges_ev) then
        Quick.show(self)
        return true
    end
    return Menu.onSwipe(self, arg, ges_ev)
end

function Results:onBookRavenTextChanged()
    self:updateItems()
end

function Results:onCloseWidget()
    self._br_closed = true
    return Menu.onCloseWidget(self)
end

function Search.nothingFound(query)
    UIManager:show(InfoMessage:new{ text = T(_("No books found for “%1”."), query), timeout = 3 })
end

--- Asks, searches, and shows the results. args: ui, home, scope, title (of the dialog), close_also.
function Search.start(args)
    Search.prompt{
        title = args.title,
        description = args.description,
        on_search = function(query)
            local results, summary = Search.run(args.ui, args.scope, query)
            if not results then return end
            if #results == 0 then
                Search.nothingFound(query)
                return
            end
            UIManager:show(Results:new{
                item_table = results,
                query = query,
                summary = summary,
                scope = args.scope,
                prompt_title = args.title,
                ui = args.ui,
                home = args.home,
                close_also = args.close_also,
            })
        end,
    }
end

--- The magnifier on the home: every book, wherever it is.
function Search.everything(home)
    Search.start{
        ui = home.ui,
        home = home,
        title = _("Search everything"),
        description = _("Books on this device, your BookRaven library and the Public Library."),
        scope = { device = true, catalog = true, public = true },
    }
end

-- ------------------------------------------------------------------ searching a catalog shelf

--- The books of the shelf on screen that match: its feed and next pages, the server's search
--- for the whole library, or, on a page of shelves, the shelves under it.
local function shelfResults(browser, base, query)
    local entry = {
        title = browser.root_catalog_title,
        username = browser.root_catalog_username,
        password = browser.root_catalog_password,
    }
    local reader, OPDSBrowser = feedReader(entry)
    if not reader then return {} end
    local url = base.url or ""
    local has_books = false
    for _, item in ipairs(base.items or {}) do
        if isBookItem(item) then has_books = true; break end
    end
    local function serverSearch()
        local encoded = util.urlEncode(query)
        return feedBooks(reader, OPDSBrowser, base.search_url:gsub("%%s", function() return encoded end), Search.CATALOG_PAGES)
    end
    local items
    local server = base.search_url and (base.depth == 1 or url:match("/opds/library$") or url:match("/opds/library%?sort=[%w_]+$"))
    local extra = {}
    if server then
        -- The library itself (or the catalog's start): the server searches all of it.
        items = serverSearch()
        if base.depth == 1 then
            -- The catalog's start also lists the Public Library: search it too.
            for _, item in ipairs(base.items or {}) do
                if item.url and item.url:match("/public/?$") then
                    entry.url = browser.paths[1] and browser.paths[1].url or url
                    extra = Search.inPublic(entry, query) or {}
                    break
                end
            end
        end
    elseif has_books then
        items = feedBooks(reader, OPDSBrowser, url, Search.FEED_PAGES)
    else
        -- A page of shelves: "All books" if there is one, else every shelf on it (two pages each).
        items = {}
        local all
        for _, item in ipairs(base.items or {}) do
            local t = (item.title or ""):lower()
            if item.url and (item.url:match("/all/?$") or t == "all books") then all = item.url end
        end
        if all then
            items = feedBooks(reader, OPDSBrowser, all, Search.FEED_PAGES)
        else
            local seen, n = {}, 0
            for _, item in ipairs(base.items or {}) do
                if item.url and n < 8 then
                    n = n + 1
                    for _, book in ipairs(feedBooks(reader, OPDSBrowser, item.url, 2)) do
                        local acq = book.acquisitions[1]
                        local id = acq and acq.href or book.title
                        if not seen[id] then
                            seen[id] = true
                            table.insert(items, book)
                        end
                    end
                end
            end
        end
    end
    local list = {}
    for _, item in ipairs(items) do
        table.insert(list, keyed(item, item.title or item.text, item.author, nil))
    end
    local found = filter(list, query)
    if server then
        -- The server also matched series and tags: keep those too, after the titles.
        local kept = {}
        for _, e in ipairs(found) do kept[e] = true end
        for _, e in ipairs(list) do
            if not kept[e] then table.insert(found, e) end
        end
    end
    for _, e in ipairs(extra) do table.insert(found, e) end
    return found
end

--- The magnifier in a catalog shelf's title bar: search this shelf, or (on its results) search
--- again or clear the search.
function Search.searchFeed(browser)
    local s = browser._br_search
    local in_results = s and s.items == browser.item_table and s.depth == #browser.paths
    local current = browser.paths[#browser.paths] or {}
    local title = in_results and s.base.title or browser.catalog_title or current.title or browser.root_catalog_title
    Search.prompt{
        title = T(_("Search in %1"), title or _("this shelf")),
        query = in_results and s.query or nil,
        on_clear = in_results and function()
            browser._br_search = nil
            browser:onReturn()
        end or nil,
        on_search = function(query)
            local base = in_results and s.base or {
                url = current.url, title = title, items = browser.item_table,
                search_url = browser.search_url, depth = #browser.paths,
            }
            local results = busy(T(_("Searching for “%1”…"), query), function()
                return shelfResults(browser, base, query)
            end)
            if not results then return end
            if #results == 0 then
                UIManager:show(InfoMessage:new{
                    text = T(_("Nothing in “%1” matches “%2”."), base.title or "", query), timeout = 3,
                })
                return
            end
            if not in_results then
                -- So the back arrow (and "Clear search") come back to the shelf.
                table.insert(browser.paths, { url = base.url, title = base.title })
            end
            browser.catalog_title = T(_("Search: %1"), query)
            browser:switchItemTable(browser.catalog_title, results)
            browser._br_search = { query = query, items = browser.item_table, base = base, depth = #browser.paths }
        end,
    }
end

-- ------------------------------------------------------------------ the magnifier in title bars

--- Adds a magnifier next to the close button of the title bars of the screens that ask for
--- one: a widget with _br_title_search(self) returning the callback (or nil for none).
function Search.installTitleBar()
    local TitleBar = require("ui/widget/titlebar")
    if TitleBar._br_search then return end
    TitleBar._br_search = true
    local IconButton = require("ui/widget/iconbutton")
    local Screen = Device.screen
    local orig_init = TitleBar.init
    TitleBar.init = function(self, ...)
        local parent = self.show_parent
        local wants = parent and parent._br_title_search
        local ok, callback = false, nil
        if type(wants) == "function" then ok, callback = pcall(wants, parent) end
        if not ok or not callback then
            if self._br_pad then self.title_h_padding = self._br_pad end
            return orig_init(self, ...)
        end
        local defaults = rawget(_G, "G_defaults")
        local base = defaults and defaults:readSetting("DGENERIC_ICON_SIZE") or 40
        local size = Screen:scaleBySize(base * (self.right_icon_size_ratio or 0.6))
        local pad = self.button_padding or Screen:scaleBySize(11)
        self._br_pad = self._br_pad or self.title_h_padding
        self.title_h_padding = self._br_pad + size + pad -- keep the title clear of the magnifier
        local ret = orig_init(self, ...)
        for _, w in ipairs(self) do
            if w._br_search_icon then return ret end -- already added by a nested init
        end
        local right = (self.close_callback or self.right_icon) and (size + 2 * pad) or 0
        local button = IconButton:new{
            icon = "appbar.search",
            width = size,
            height = size,
            padding = pad,
            padding_bottom = size,
            overlap_offset = { self.width - right - size - 2 * pad, 0 },
            callback = callback,
            show_parent = parent,
        }
        button._br_search_icon = true
        table.insert(self, 1, button) -- before the other buttons, whose tap zones reach this far
        return ret
    end
end

return Search
