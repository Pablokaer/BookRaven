--[[--
CyberUI library: the books on the device, by folder (KOReader's home folder first).

  * the header: search (this folder and the ones in it), + NEW (a folder here), the sort order
    (title, author, last opened, newest, progress);
  * the path as tags (tap one to go back up to it);
  * filters with their counts: ALL, READING, UNREAD (never opened), DONE; grid or list;
  * a grid of cards (the cover, framed, with NEW or the percentage; the title; a progress bar)
    or a list. Folders come first, as stacked cards. Tap a book to read it, long-press it for its
    dossier; tap a folder to open it;
  * the pager (SECTOR 01 / 03), also turned with a swipe left or right.

It also shows a collection's books (route.args.collection, from Caches) and search results
(route.args.query). Missing covers are extracted after the page is shown, one at a time.
]]

local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local _ = require("gettext")
local T = require("ffi/util").template

local Cover = require("cy_cover")
local D = require("cy_data")
local Settings = require("br_settings")
local U = require("cy_ui")
local s = U.s

local M = {}

M.SORTS = {
    { key = "title", text = "Title" }, { key = "author", text = "Author" },
    { key = "recent", text = "Last opened" }, { key = "added", text = "Newest" },
    { key = "progress", text = "Progress" },
}

local FILTERS = {
    { key = "all", text = "All" }, { key = "reading", text = "Reading" },
    { key = "unread", text = "Unread" }, { key = "done", text = "Done" },
}

local function filterOf(status)
    if status == "new" then return "unread" end
    if status == "complete" then return "done" end
    return "reading"
end

local function sortBooks(books, how)
    local opened = how == "recent" and D.lastOpened() or nil
    table.sort(books, function(a, b)
        if how == "author" and (a.author or "") ~= (b.author or "") then
            return (a.author or "~"):lower() < (b.author or "~"):lower()
        elseif how == "recent" then
            local ta, tb = opened[a.file] or 0, opened[b.file] or 0
            if ta ~= tb then return ta > tb end
        elseif how == "added" and (a.mtime or 0) ~= (b.mtime or 0) then
            return (a.mtime or 0) > (b.mtime or 0)
        elseif how == "progress" and (a.st.percent or 0) ~= (b.st.percent or 0) then
            return (a.st.percent or 0) > (b.st.percent or 0)
        end
        return (a.title or ""):lower() < (b.title or ""):lower()
    end)
end

--- The books (and folders) this route shows, with their statuses and the filter counts.
local function gather(args)
    local dirs, books = {}, {}
    if args.collection then
        for _, c in ipairs(D.collections()) do
            if c.name == args.collection then
                for _, file in ipairs(c.files) do
                    local title, author = D.describe(file)
                    table.insert(books, { file = file, title = title, author = author,
                        mtime = lfs.attributes(file, "modification") })
                end
            end
        end
    elseif args.query then
        local ok, found = pcall(function() return require("br_search").inFolders({ args.dir }, args.query) end)
        for _, e in ipairs(ok and found or {}) do
            table.insert(books, { file = e.local_file, title = e.title, author = e.author,
                mtime = lfs.attributes(e.local_file, "modification") })
        end
    else
        dirs, books = D.folder(args.dir)
    end
    local counts = { all = #books, reading = 0, unread = 0, done = 0 }
    for _, b in ipairs(books) do
        b.st = D.status(b.file)
        local f = filterOf(b.st.status)
        counts[f] = counts[f] + 1
    end
    return dirs, books, counts
end

-- ------------------------------------------------------------------ pieces

local function squareButton(icon, kind, callback)
    local size = s(44)
    return U.Tap:new{
        callback = callback,
        U.Box:new{ width = size, height = size, line = kind == "outline" and "fg" or nil,
            fill = kind ~= "outline" and (kind == "accent" and "accent" or "fg") or nil,
            cuts = kind == "outline" and nil or { tr = s(10) }, align = "center",
            U.icon(icon, s(22), kind == "outline" and "fg" or "ink") },
    }
end

local function breadcrumb(app, args, w)
    local tags = {}
    local function tag(text, callback, last)
        table.insert(tags, U.Tap:new{
            callback = callback,
            U.Box:new{ fill = last and "accent" or "panel", cuts = { tr = s(8) }, pad_l = s(12), pad_r = s(14),
                pad_t = s(5), pad_b = s(5),
                U.text{ text = text, kind = "mono", size = 13, color = last and "ink" or "fg", max_width = math.floor(w * 0.45) } },
        })
    end
    if args.collection then
        tag("Caches", function() app:tab("caches") end, false)
        tag(args.title or args.collection, nil, not args.query)
    else
        local root = D.root()
        local rel = args.dir:sub(#root + 2)
        local parts = {}
        for p in rel:gmatch("[^/]+") do table.insert(parts, p) end
        tag("Library", function() M.open(app, args, root) end, #parts == 0 and not args.query)
        local path = root
        for i, p in ipairs(parts) do
            path = path .. "/" .. p
            local target = path
            tag(p, function() M.open(app, args, target) end, i == #parts and not args.query)
        end
    end
    if args.query then tag("grep: " .. args.query, nil, true) end
    -- keep the last tags when the path is long
    local row = U.row(tags, s(8))
    while #tags > 1 and row:getSize().w > w - s(20) do
        table.remove(tags, 1)
        row = U.row(tags, s(8))
    end
    return U.Box:new{ width = w, height = s(48), line = "fg", cuts = { tr = s(12) }, pad_l = s(6), row }
end

--- Goes to another folder in place (the path's tags), first page.
function M.open(app, args, dir)
    args.dir, args.page, args.query = dir, 1, nil
    app:rebuild(true)
end

local function filterRow(app, args, counts, w)
    local chips = {}
    for _, f in ipairs(FILTERS) do
        local on = (args.filter or "all") == f.key
        table.insert(chips, U.button{
            text = f.text, sub = tostring(counts[f.key] or 0), kind = on and "accent" or "outline",
            size = 13, sub_size = 11, height = s(48), cuts = { tr = s(10) }, pad = s(14),
            callback = function()
                args.filter, args.page = f.key, 1
                app:rebuild(true)
            end,
        })
    end
    local view = Settings.get("cyber_library_view") or "grid"
    local function viewButton(key, icon)
        return squareButton(icon, view == key and "fill" or "outline", function()
            Settings.set("cyber_library_view", key)
            args.page = 1
            app:rebuild(true)
        end)
    end
    local toggles = U.row({ viewButton("grid", "grid"), viewButton("list", "list") }, s(8))
    local left = U.row(chips, s(8))
    while left:getSize().w + toggles:getSize().w + s(12) > w and #chips > 1 do
        -- narrow screens: the counts go
        for i, f in ipairs(FILTERS) do
            local on = (args.filter or "all") == f.key
            chips[i] = U.button{ text = f.text, kind = on and "accent" or "outline", size = 12, height = s(40),
                cuts = { tr = s(8) }, pad = s(8),
                callback = function() args.filter, args.page = f.key, 1; app:rebuild(true) end }
        end
        left = U.row(chips, s(6))
        break
    end
    local h = math.max(left:getSize().h, toggles:getSize().h)
    return U.Layers:new{
        width = w, height = h,
        { left, x = 0, y = 0 },
        { toggles, x = w - toggles:getSize().w, y = math.floor((h - toggles:getSize().h) / 2) },
    }
end

local function bookTag(st)
    if st.status == "new" then return U.tag("New", "accent", 10) end
    if st.status == "complete" then return U.tag("Done", "panel", 10) end
    return U.tag(string.format("%d%%", math.floor((st.percent or 0) * 100 + 0.5)), "fill", 10)
end

local function bookCard(app, b, w, cover_h, missing)
    local cover, path = Cover.framed(b.file, b.title, b.author, w, cover_h, { cached_only = true, tag = bookTag(b.st) })
    if not path then table.insert(missing, b.file) end
    local items = {
        cover,
        U.vspace(s(6)),
        U.text{ text = b.title, kind = "body", size = 13, color = "fg", max_width = w },
        U.vspace(s(6)),
        U.bar(w, s(5), b.st.status == "complete" and 1 or b.st.percent),
    }
    return U.Tap:new{
        callback = function() app:openBook(b.file) end,
        hold_callback = function() app:dossier(b.file, "LIBRARY") end,
        U.column(items, 0),
    }
end

local function folderCard(app, args, d, w, cover_h)
    local off = s(8)
    local inner_w, inner_h = w - off, cover_h - off
    local sample = d.sample and (D.cachedCover(d.sample) or nil)
    local cover = Cover.framed(d.sample, d.name, nil, inner_w, inner_h, { path = sample or false })
    local label = U.Box:new{ width = inner_w - s(4), height = s(30), fill = "fg", pad_l = s(8),
        U.row({ U.icon("folder", s(18), "ink"),
            U.text{ text = string.format(inner_w >= s(130) and "FOLDER // %d" or "DIR // %d", d.count or 0), kind = "display", size = 12, color = "ink",
                tracked = true, max_width = inner_w - s(40) } }, s(8)) }
    local stack = U.Layers:new{
        width = w, height = cover_h,
        { U.Painter:new{ width = inner_w, height = inner_h, paint = function(bb, x, y, pw, ph)
            U.frame(bb, x, y, pw, ph, math.max(2, s(1.5)), "muted", "bg", { tr = s(8) }) end }, x = off, y = 0 },
        { U.Painter:new{ width = inner_w, height = inner_h, paint = function(bb, x, y, pw, ph)
            U.frame(bb, x, y, pw, ph, math.max(2, s(1.5)), "fg", "bg", { tr = s(8) }) end }, x = math.floor(off / 2), y = math.floor(off / 2) },
        { cover, x = 0, y = off },
        { label, x = s(2), y = cover_h - s(32) },
    }
    return U.Tap:new{
        callback = function() app:go("library", { dir = d.path, page = 1, filter = "all" }) end,
        U.column({
            stack,
            U.vspace(s(6)),
            U.text{ text = d.name, kind = "body", size = 13, color = "fg", max_width = w },
            U.vspace(s(11)),
        }, 0),
    }
end

local function listRow(app, b, w, h, missing)
    local cw, ch = math.floor((h - s(12)) / 1.5), h - s(12)
    local cover, path = Cover.framed(b.file, b.title, b.author, cw, ch, { cached_only = true })
    if not path then table.insert(missing, b.file) end
    local text_w = w - cw - s(14) - s(80)
    local pct = math.floor((b.st.percent or 0) * 100 + 0.5)
    local texts = U.column({
        U.text{ text = b.title, kind = "semi", size = 15, color = "fg", max_width = text_w },
        U.text{ text = "// " .. (b.author or "?"), kind = "mono", size = 11, color = "muted", max_width = text_w },
        U.vspace(s(4)),
        U.bar(math.min(text_w, s(200)), s(5), b.st.status == "complete" and 1 or b.st.percent),
    }, s(2))
    local tag = bookTag(b.st)
    local right = U.text{ text = b.st.status == "new" and "" or string.format("%d%%", pct), kind = "mono", size = 13, color = "fg" }
    return U.Tap:new{
        callback = function() app:openBook(b.file) end,
        hold_callback = function() app:dossier(b.file, "LIBRARY") end,
        U.column({
            U.Layers:new{
                width = w, height = h - s(2),
                { U.row({ cover, texts }, s(14)), x = 0, y = s(4) },
                { tag, x = w - tag:getSize().w, y = s(8) },
                { right, x = w - right:getSize().w, y = h - s(8) - right:getSize().h },
            },
            U.rule(w, "rule"),
        }, 0),
    }
end

--- Extracts the covers that were missing, one at a time, then draws the page again (once).
local function fetchMissing(app, missing)
    if #missing == 0 then return end
    app._cy_cover_gen = (app._cy_cover_gen or 0) + 1
    local gen = app._cy_cover_gen
    local got = 0
    local function step()
        if app._closed or app._cy_cover_gen ~= gen then return end
        local file = table.remove(missing, 1)
        if file and D.cover(file) then got = got + 1 end
        if #missing > 0 then
            UIManager:scheduleIn(0.05, step)
        elseif got > 0 then
            app:rebuild()
        end
    end
    UIManager:scheduleIn(0.3, step)
end

-- ------------------------------------------------------------------ the screen

local function newFolder(app, args)
    local InputDialog = require("ui/widget/inputdialog")
    local dialog
    dialog = InputDialog:new{
        title = _("New folder"),
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            { text = _("Create"), is_enter_default = true, callback = function()
                local name = dialog:getInputText()
                UIManager:close(dialog)
                if name == "" or name:find("/", 1, true) then return end
                local ok = lfs.mkdir(args.dir .. "/" .. name)
                if not ok then
                    UIManager:show(InfoMessage:new{ text = T(_("Could not create the folder \"%1\"."), name) })
                end
                app:rebuild(true)
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

local function search(app, args)
    require("br_search").prompt{
        title = args.collection and _("Search the library") or T(_("Search in %1"), args.dir:match("([^/]+)$") or "/"),
        on_search = function(query)
            app:go("library", { dir = args.collection and D.root() or args.dir, query = query, page = 1, filter = "all" })
        end,
    }
end

function M.build(app, w, h, route)
    local args = route.args
    args.dir = args.dir or D.root()
    args.page = args.page or 1
    args.filter = args.filter or "all"
    local sort = Settings.get("cyber_sort") or "title"

    local right = {
        squareButton("search", "outline", function() search(app, args) end),
    }
    if not args.collection and not args.query then
        table.insert(right, U.button{ text = "+ New", kind = "accent", size = 14, height = s(44), cuts = { tr = s(12) },
            callback = function() newFolder(app, args) end })
    end
    table.insert(right, squareButton("sort", "outline", function()
        U.popup{ title = "Sort", choices = M.SORTS, selected = sort, on_select = function(key)
            Settings.set("cyber_sort", key)
            args.page = 1
            app:rebuild(true)
        end }
    end))
    local title = args.collection and (args.title or args.collection) or (args.query and "Grep" or "Library")
    local head = U.header{ width = w, title = title, path = args.collection and "/SYS/CACHES/" or nil,
        on_back = function() app:back() end, right = right }

    local dirs, books, counts = gather(args)
    local shown = {}
    if args.filter == "all" then
        for _, d in ipairs(dirs) do table.insert(shown, { dir = d }) end
    end
    local list = {}
    for _, b in ipairs(books) do
        if args.filter == "all" or filterOf(b.st.status) == args.filter then table.insert(list, b) end
    end
    sortBooks(list, sort)
    for _, b in ipairs(list) do table.insert(shown, { book = b }) end

    local crumbs = breadcrumb(app, args, w)
    local filters = filterRow(app, args, counts, w)
    local top = U.column({ head, U.vspace(s(14)), crumbs, U.vspace(s(12)), filters, U.vspace(s(14)) }, 0)
    local pager_h = s(42)
    local area_h = h - top:getSize().h - pager_h - s(12)

    local view = Settings.get("cyber_library_view") or "grid"
    local missing = {}
    local area
    local perpage
    if view == "list" then
        local row_h = s(76)
        perpage = math.max(1, math.floor(area_h / row_h))
        local pages = math.max(1, math.ceil(#shown / perpage))
        args.page = math.min(args.page, pages)
        local rows = {}
        for i = (args.page - 1) * perpage + 1, math.min(#shown, args.page * perpage) do
            local it = shown[i]
            if it.dir then
                local d = it.dir
                table.insert(rows, U.Tap:new{
                    callback = function() app:go("library", { dir = d.path, page = 1, filter = "all" }) end,
                    U.column({
                        U.place(U.row({ U.Box:new{ width = math.floor((row_h - s(12)) / 1.5), height = row_h - s(12), line = "fg",
                            cuts = { tr = s(6) }, align = "center", U.icon("folder", s(24), "fg") },
                            U.column({ U.text{ text = d.name, kind = "semi", size = 15, color = "fg", max_width = w - s(120) },
                                U.text{ text = string.format("FOLDER // %d FILE%s", d.count or 0, d.count == 1 and "" or "S"), kind = "mono", size = 11, color = "muted" } }, s(2)) }, s(14)),
                            w, row_h - s(2)),
                        U.rule(w, "rule"),
                    }, 0),
                })
            else
                table.insert(rows, listRow(app, it.book, w, row_h, missing))
            end
        end
        area = U.column(rows, 0)
        app.pager = { page = args.page, pages = pages }
    else
        local cols = tonumber(Settings.get("cyber_grid_cols")) or 4
        if w > h then cols = cols + 2 end
        local gap = s(14)
        local card_w = math.floor((w - (cols - 1) * gap) / cols)
        -- under the cover: the title and the progress bar; between rows: gap_v
        local extra, gap_v = s(6) + U.lineHeight("body", 13) + s(11), s(18)
        local pitch = function(cover) return cover + extra + gap_v end
        local cover_h = math.floor(card_w * 1.5)
        local rows = math.max(1, math.floor((area_h + gap_v) / pitch(cover_h)))
        -- one more row if the covers can stay at least 1.25 times as tall as wide
        local squat = math.floor((area_h + gap_v) / (rows + 1)) - extra - gap_v
        if squat >= card_w * 1.25 then
            rows = rows + 1
            cover_h = squat
        else
            cover_h = math.min(cover_h, math.floor((area_h + gap_v) / rows) - extra - gap_v)
        end
        perpage = cols * rows
        local pages = math.max(1, math.ceil(#shown / perpage))
        args.page = math.min(args.page, pages)
        local grid = {}
        local row
        local first = (args.page - 1) * perpage + 1
        for i = first, math.min(#shown, args.page * perpage) do
            if (i - first) % cols == 0 then
                row = U.row({}, 0, "top")
                table.insert(grid, row)
            else
                table.insert(row, U.hspace(gap))
            end
            local it = shown[i]
            table.insert(row, it.dir and folderCard(app, args, it.dir, card_w, cover_h)
                or bookCard(app, it.book, card_w, cover_h, missing))
        end
        area = U.column(grid, gap_v)
        app.pager = { page = args.page, pages = pages }
    end
    if #shown == 0 then
        area = U.column({
            U.text{ text = args.query and "NO MATCH" or "EMPTY SECTOR", kind = "display", size = 18, color = "fg", tracked = true },
            U.text{ text = args.query and ("grep: " .. args.query) or _("No books here."), kind = "mono", size = 12, color = "muted" },
        }, s(6))
    end
    app.pager.go = function(n)
        args.page = n
        app:rebuild(Settings.get("cyber_flash") ~= false)
    end
    local pager = U.pager{ width = w, label = "Sector", page = app.pager.page, pages = app.pager.pages, on_page = app.pager.go }
    fetchMissing(app, missing)
    logger.dbg("CyberUI library:", #shown, "items,", #missing, "covers to extract")
    return U.Layers:new{
        width = w, height = h,
        { top, x = 0, y = 0 },
        { area, x = 0, y = top:getSize().h },
        { pager, x = 0, y = h - pager_h },
    }
end

return M
