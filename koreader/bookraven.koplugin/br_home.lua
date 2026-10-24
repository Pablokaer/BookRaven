--[[--
The BookRaven library home: the start screen, like the Kindle's own home.

  * a top bar with the raven mark, search (every book, wherever it is: br_search), the quick
    settings (br_quick; also a swipe down from the top edge), the file browser and KOReader's menu;
  * a header with an engraving (Doré's "The Raven"), the greeting and the date;
  * "Continue reading": the last book you opened, with its cover and progress (tap to open);
  * "Shelves": the BookRaven catalog's top-level shelves as illustrated tiles, then the folder
    shelves you added with "+ Add shelf" (see br_gallery);
  * "New in your library": covers from the catalog's recently added shelf, when there is room.

Shelves and new books are kept in the plugin settings, so the home works offline and shows
straight away; it refreshes from the server when KOReader is online.
]]

local Blitbuffer = require("ffi/blitbuffer")
local Device = require("device")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local IconButton = require("ui/widget/iconbutton")
local ImageWidget = require("ui/widget/imagewidget")
local InfoMessage = require("ui/widget/infomessage")
local InputContainer = require("ui/widget/container/inputcontainer")
local LeftContainer = require("ui/widget/container/leftcontainer")
local OverlapGroup = require("ui/widget/overlapgroup")
local RightContainer = require("ui/widget/container/rightcontainer")
local BottomContainer = require("ui/widget/container/bottomcontainer")
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextWidget = require("ui/widget/textwidget")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
local _ = require("gettext")
local T = require("ffi/util").template
local Screen = Device.screen

local Covers = require("br_covers")
local Settings = require("br_settings")
local Theme = require("br_theme")
local W = require("br_widgets")
local s = W.s

local WHITE = Blitbuffer.COLOR_WHITE

--- Paints its child, then inverts it: a black HUD bar with a cut bottom-right corner.
local Inverted = WidgetContainer:extend{}

function Inverted:paintTo(bb, x, y)
    local size = self[1]:getSize()
    self.dimen = Geom:new{ x = x, y = y, w = size.w, h = size.h }
    self[1]:paintTo(bb, x, y)
    bb:invertRect(x, y, size.w, size.h)
    local cut = math.floor(size.h * 0.35)
    for r = 0, cut - 1 do
        bb:paintRect(x + size.w - (r + 1), y + size.h - cut + r, r + 1, 1, WHITE)
    end
end

local Home = InputContainer:extend{
    name = "bookraven_home",
    covers_fullscreen = true,
    ui = nil, -- the file browser underneath
}

local function clean(text)
    if type(text) ~= "string" then return nil end
    text = text:gsub("<[^>]+>", " "):gsub("%s+", " "):gsub("^ ", ""):gsub(" $", "")
    if #text > 90 then text = text:sub(1, 87):gsub("[\128-\191]*$", "") .. "…" end
    return text ~= "" and text or nil
end
Home.clean = clean

--- What we know about a book on the device: title, authors, progress.
local function bookFacts(file)
    local facts = { file = file }
    local ok, ds = pcall(function() return require("docsettings"):open(file) end)
    if ok and ds then
        facts.percent = ds:readSetting("percent_finished")
        local props = ds:readSetting("doc_props") or {}
        facts.title = props.title
        facts.authors = props.authors
        facts.pages = ds:readSetting("doc_pages")
        local summary = ds:readSetting("summary")
        facts.status = summary and summary.status
    end
    if not facts.title or facts.title == "" then
        local ok_bim, BookInfoManager = pcall(require, "bookinfomanager")
        if ok_bim and BookInfoManager then
            local ok2, info = pcall(BookInfoManager.getBookInfo, BookInfoManager, file, false)
            if ok2 and info then
                facts.title = info.title
                facts.authors = facts.authors or info.authors
            end
        end
    end
    if not facts.title or facts.title == "" then
        local name = file:match("([^/]+)%.[^./]+$") or file
        local author, title = name:match("^(.-) %- (.+)$")
        facts.title = title or name
        facts.authors = facts.authors or author
    end
    if type(facts.authors) == "string" then
        facts.authors = facts.authors:gsub("\n", ", ")
    end
    return facts
end

function Home:init()
    self.dimen = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    if Device:hasKeys() then
        self.key_events = { Close = { { Device.input.group.Back } } }
    end
    -- A swipe down from the top edge: the quick settings (br_quick.fromTop checks where it starts).
    self.ges_events = {
        BrHomeSwipe = { GestureRange:new{ ges = "swipe", range = function() return self.dimen end } },
    }
    self.plugin_dir = Theme.plugin_dir
    self.cache = Settings.get("home_cache") or {}
    self:loadReading()
    self:build()
    self._refresh = function() self:refresh() end
    UIManager:scheduleIn(0.4, self._refresh)
end

function Home:account()
    local opds = self.ui and self.ui.opds
    if not opds then return nil end
    pcall(opds.loadSettings, opds)
    return require("br_account").findCatalog(opds.servers)
end

function Home:loadReading()
    self.current, self.in_progress = nil, 0
    local ok, ReadHistory = pcall(require, "readhistory")
    if not ok then return end
    for i, item in ipairs(ReadHistory.hist or {}) do
        if i > 40 then break end
        if item.file and lfs.attributes(item.file, "mode") == "file" then
            local facts = bookFacts(item.file)
            local reading = facts.percent and facts.percent > 0 and facts.percent < 1 and facts.status ~= "complete"
            if reading then self.in_progress = self.in_progress + 1 end
            if not self.current and facts.status ~= "complete" then self.current = facts end
        end
    end
end

-- ------------------------------------------------------------------ layout

local function greeting()
    local hour = tonumber(os.date("%H")) or 12
    if hour < 5 then return _("Good night") end
    if hour < 12 then return _("Good morning") end
    if hour < 18 then return _("Good afternoon") end
    return _("Good evening")
end

function Home:markFile()
    local theme = Theme.current()
    local dir = self.plugin_dir .. "/" .. (theme and theme.icons or "icons/bookraven")
    for _, name in ipairs({ "home.svg", "home.png" }) do
        if lfs.attributes(dir .. "/" .. name, "mode") == "file" then return dir .. "/" .. name end
    end
end

function Home:topBar(sw, m, style, f)
    local bar_h = s(46)
    local classic = style == "classic"
    local left = HorizontalGroup:new{ align = "center" }
    table.insert(left, HorizontalSpan:new{ width = m })
    local mark = not classic and self:markFile()
    if mark then
        local size = math.floor(bar_h * 0.8)
        table.insert(left, W.Tap:new{
            callback = function() self:showMenu() end,
            ImageWidget:new{ file = mark, width = size, height = size, alpha = true },
        })
        table.insert(left, HorizontalSpan:new{ width = s(8) })
    end
    local name = (style == "hud" and "BOOKRAVEN") or (classic and _("Home")) or "BookRaven"
    table.insert(left, TextWidget:new{
        text = name,
        face = f.get("display", (style == "hud" and 21) or (classic and 22) or 25),
    })
    if style == "hud" then
        table.insert(left, TextWidget:new{ text = "  // DECK", face = f.get("mono", 13), bold = true, fgcolor = W.MUTED })
    end

    local icon = s(24)
    local right = HorizontalGroup:new{ align = "center" }
    local actions = {
        { "appbar.search", function() self:search() end },
        { "br.quick", function() require("br_quick").show(self) end, true },
        { "appbar.filebrowser", function() self:onClose() end },
        { "appbar.menu", function() self:showMenu() end },
    }
    for _, a in ipairs(actions) do
        if a[3] then -- one of our own icons (KOReader has no quick settings icon)
            table.insert(right, W.iconTap(a[1], icon, s(8), a[2]))
        else
            table.insert(right, IconButton:new{
                icon = a[1], width = icon, height = icon, padding = s(8),
                callback = a[2], show_parent = self,
            })
        end
    end
    table.insert(right, HorizontalSpan:new{ width = math.max(0, m - s(8)) })

    local dimen = Geom:new{ w = sw, h = bar_h }
    local bar = OverlapGroup:new{
        dimen = dimen,
        LeftContainer:new{ dimen = dimen:copy(), left },
        RightContainer:new{ dimen = dimen:copy(), right },
    }
    if style == "hud" then
        return Inverted:new{ bar }
    end
    if classic then -- the Kindle's bar: title left, icons right, a hairline under it
        return VerticalGroup:new{
            align = "left",
            bar,
            W.Painter:new{
                width = sw, height = Size.line.medium,
                paint = function(bb, x, y, w, h) bb:paintRect(x, y, w, h, W.INK) end,
            },
            VerticalSpan:new{ width = s(4) },
        }
    end
    local group = VerticalGroup:new{ align = "center", bar }
    local orn = self.plugin_dir .. "/icons/bookraven/ornament.small.svg"
    if lfs.attributes(orn, "mode") == "file" then
        local ow = math.floor(sw * 0.26)
        table.insert(group, ImageWidget:new{ file = orn, width = ow, height = math.floor(ow / 8), alpha = true })
        table.insert(group, VerticalSpan:new{ width = s(4) })
    end
    return group
end

--- Classic e-reader: no engraving, just the greeting and the day, in plain type.
function Home:plainHeader(sw, m, f)
    local texts = VerticalGroup:new{ align = "left" }
    local max_w = sw - 2 * m
    table.insert(texts, VerticalSpan:new{ width = s(6) })
    table.insert(texts, TextWidget:new{ text = greeting(), face = f.get("display", 24), max_width = max_w })
    local line
    if self.offline then
        line = _("Offline — showing your saved shelves")
    elseif (self.in_progress or 0) == 1 then
        line = _("One book in progress")
    elseif (self.in_progress or 0) > 1 then
        line = T(_("%1 books in progress"), self.in_progress)
    end
    local date = os.date("%A %d %B")
    table.insert(texts, TextWidget:new{
        text = line and (date .. " · " .. line) or date, face = f.get("strong", 14), fgcolor = W.SOFT, max_width = max_w,
    })
    return HorizontalGroup:new{ HorizontalSpan:new{ width = m }, texts }
end

function Home:header(sw, m, style, f)
    if style == "classic" then return self:plainHeader(sw, m, f) end
    local theme = Theme.current()
    local art = string.format("%s/%s/header.png", self.plugin_dir, theme and theme.art or "art/bookraven")
    local hh = math.min(math.floor(sw * 340 / 1072), math.floor(self.dimen.h * 0.23))
    local iw = math.min(sw, math.floor(hh * 1072 / 340))
    local hud = style == "hud"
    local dimen = Geom:new{ w = sw, h = hh }

    local texts = VerticalGroup:new{ align = "left" }
    local ink = hud and WHITE or W.INK
    local muted = hud and Blitbuffer.COLOR_GRAY_D or W.SOFT
    local max_w = math.floor(sw * 0.52)
    if hud then
        table.insert(texts, TextWidget:new{ text = "WELCOME BACK", face = f.get("display", 30), fgcolor = ink, max_width = max_w })
        table.insert(texts, VerticalSpan:new{ width = s(6) })
        table.insert(texts, TextWidget:new{
            text = os.date("%Y-%m-%d · %a · %H:%M"):upper(), face = f.get("mono", 14), bold = true, fgcolor = muted, max_width = max_w,
        })
        table.insert(texts, VerticalSpan:new{ width = s(4) })
        table.insert(texts, TextWidget:new{
            text = string.format("ACTIVE READS %02d // LINK %s", self.in_progress or 0, self.offline and "OFFLINE" or "ONLINE"),
            face = f.get("mono", 14), bold = true, fgcolor = muted, max_width = max_w,
        })
    else
        table.insert(texts, TextWidget:new{ text = greeting(), face = f.get("display", 33), fgcolor = ink, max_width = max_w })
        table.insert(texts, VerticalSpan:new{ width = s(4) })
        table.insert(texts, TextWidget:new{
            text = W.tracked(os.date("%A %d %B")), face = f.get("label", 12), fgcolor = muted, max_width = max_w,
        })
        table.insert(texts, VerticalSpan:new{ width = s(10) })
        local line
        if self.offline then
            line = _("Offline — showing your saved shelves")
        elseif (self.in_progress or 0) == 1 then
            line = _("One book in progress")
        elseif (self.in_progress or 0) > 1 then
            line = T(_("%1 books in progress"), self.in_progress)
        else
            line = _("A quiet shelf, waiting for you")
        end
        table.insert(texts, TextWidget:new{ text = line, face = f.get("strong", 16), fgcolor = W.SOFT, max_width = max_w })
    end

    local group = OverlapGroup:new{ dimen = dimen }
    if hud then
        table.insert(group, FrameContainer:new{
            width = sw, height = hh, padding = 0, margin = 0, bordersize = 0,
            background = Blitbuffer.COLOR_BLACK, VerticalSpan:new{ width = hh },
        })
    end
    if lfs.attributes(art, "mode") == "file" then
        table.insert(group, RightContainer:new{
            dimen = dimen:copy(),
            ImageWidget:new{ file = art, width = iw, height = hh },
        })
    end
    table.insert(group, LeftContainer:new{
        dimen = dimen:copy(),
        HorizontalGroup:new{ HorizontalSpan:new{ width = m }, texts },
    })
    return group
end

function Home:coverWidget(path, title, author, w, h, style)
    local cover
    if path then
        local iw, ih = Covers:size(path)
        if iw and ih then
            local fw, fh = Covers.fit(iw, ih, w, h)
            cover = ImageWidget:new{ file = path, width = fw, height = fh }
            if style ~= "hud" then
                cover = FrameContainer:new{
                    padding = 0, margin = 0, bordersize = Size.border.thin, color = W.RULE, cover,
                }
            end
        end
    end
    if not cover then
        cover = require("br_cards").standIn(title, author, w, h)
    end
    return W.Mount:new{ look = style, cover }
end

function Home:continueCard(width, style, f)
    local cur = self.current
    local hud = style == "hud"
    if not cur then
        return W.noteTile{
            style = style, width = width,
            title = hud and _("No active reads") or _("Nothing open yet"),
            text = _("Open a book from a shelf below and it will wait for you here."),
            callback = function() self:onClose() end,
        }
    end
    local pad = s(10)
    local cover_h = s(104)
    local cover_w = math.floor(cover_h * 2 / 3)
    local cover = self:coverWidget(Covers:forBook(cur.file), cur.title, cur.authors, cover_w, cover_h, style)
    local cs = cover:getSize()
    local text_w = width - 2 * pad - 2 * Size.border.thin - cs.w - s(16)

    local info = VerticalGroup:new{ align = "left" }
    table.insert(info, TextBoxWidget:new{
        text = hud and W.upper(cur.title) or cur.title,
        face = f.get("display", hud and 21 or 24),
        width = text_w,
        height = math.floor(cover_h * 0.5),
        height_adjust = true,
        height_overflow_show_ellipsis = true,
    })
    if cur.authors and cur.authors ~= "" then
        table.insert(info, VerticalSpan:new{ width = s(2) })
        table.insert(info, TextWidget:new{
            text = (hud and "// " or "") .. cur.authors,
            face = f.get(hud and "mono" or "strong", hud and 14 or 16),
            bold = hud or nil,
            fgcolor = W.SOFT,
            max_width = text_w,
        })
    end
    table.insert(info, VerticalSpan:new{ width = s(12) })
    table.insert(info, W.progress(text_w, cur.percent or 0, style))
    table.insert(info, VerticalSpan:new{ width = s(6) })
    local pct = math.floor((cur.percent or 0) * 100 + 0.5)
    local meta
    if hud then
        meta = string.format("PROGRESS %03d%%", pct)
        if cur.pages then meta = meta .. string.format(" // P.%d/%d", math.max(1, math.floor((cur.percent or 0) * cur.pages + 0.5)), cur.pages) end
    else
        meta = T(_("%1% read"), pct)
        if cur.pages then
            meta = meta .. " · " .. T(_("page %1 of %2"), math.max(1, math.floor((cur.percent or 0) * cur.pages + 0.5)), cur.pages)
        end
    end
    table.insert(info, TextWidget:new{
        text = meta, face = f.get(hud and "mono" or "strong", hud and 13 or 14), bold = hud or nil,
        fgcolor = W.SOFT, max_width = text_w,
    })

    local row = HorizontalGroup:new{ align = "center", cover, HorizontalSpan:new{ width = s(16) }, info }
    local h = math.max(cs.h, info:getSize().h) + 2 * pad + 2 * Size.border.thin
    local box
    if hud then
        box = W.HudPanel:new{
            width = width, height = h, padding = pad, row,
            tag = TextWidget:new{ text = "ACTIVE", face = f.get("mono", 11), bold = true, fgcolor = WHITE },
        }
    else
        box = W.card(row, width, h, pad)
    end
    return W.Tap:new{ callback = function() self:openBook(cur.file) end, box }
end

--- Everything the Shelves section can show, in order: the catalog's shelves (or a tile saying
--- why there are none yet), the folder shelves you added, and "Add a shelf".
function Home:shelfEntries()
    local list = {}
    local hud = W.style() == "hud"
    if not self.ui.opds then
        table.insert(list, { title = _("Catalog unavailable"), art_key = "library", kind = "noopds",
            content = _("Enable the OPDS catalog in Tools → More tools → Plugin management.") })
    elseif not self:account() then
        table.insert(list, { title = hud and _("Link your account") or _("Connect BookRaven"), art_key = "library",
            kind = "connect", content = _("Add your account to see your catalog's shelves here.") })
    elseif #(self.cache.shelves or {}) == 0 then
        table.insert(list, { title = hud and _("No shelf data") or _("Your catalog"), art_key = "library",
            kind = "offline", content = _("Its shelves appear once KOReader has been online. Tap to connect.") })
    else
        for _, shelf in ipairs(self.cache.shelves) do
            table.insert(list, { title = shelf.title, text = shelf.title, content = shelf.note, url = shelf.url, kind = "catalog" })
        end
    end
    local Shelves = require("br_gallery")
    for _, shelf in ipairs(Shelves.list()) do
        table.insert(list, {
            title = shelf.title, text = shelf.title, content = Shelves.note(shelf.path),
            local_path = shelf.path, kind = "folder",
        })
    end
    table.insert(list, {
        title = _("Add a shelf"), text = _("Add a shelf"), plus = true, kind = "add",
        content = _("Pick a folder on this device"),
    })
    return list
end

--- What a tap on a shelf tile does (on the home or on the Shelves page).
function Home:shelfAction(entry, from_menu)
    if entry.kind == "add" then
        self:addShelf(from_menu)
    elseif entry.kind == "folder" then
        self:openFolder(entry.local_path, entry.title)
    elseif entry.kind == "catalog" then
        self:openShelf(entry.url, entry.title)
    elseif entry.kind == "all" then
        UIManager:show(require("br_gallery").ShelfMenu:new{ home = self })
    elseif entry.kind == "connect" then
        require("br_account").showDialog(self.ui, function() self:refresh(true) end)
    elseif entry.kind == "offline" then
        require("ui/network/manager"):runWhenOnline(function() self:refresh(true) end)
    end
end

--- Long-press on a folder shelf: remove it (the folder and its books stay on the device).
function Home:shelfHold(entry, from_menu)
    if entry.kind ~= "folder" then return end
    UIManager:show(require("ui/widget/confirmbox"):new{
        text = T(_("Remove the shelf \"%1\"?\n\nThe folder and its books stay on the device."), entry.title),
        ok_text = _("Remove"),
        ok_callback = function()
            require("br_gallery").remove(entry.local_path)
            self:rebuild()
            if from_menu then from_menu:reload() end
        end,
    })
end

--- "Add a shelf": pick a folder; its name becomes the shelf's name.
function Home:addShelf(from_menu)
    local start = G_reader_settings:readSetting("home_dir") or G_reader_settings:readSetting("lastdir") or "/"
    local PathChooser = require("ui/widget/pathchooser")
    UIManager:show(PathChooser:new{
        select_directory = true,
        select_file = false,
        show_files = true,
        path = start,
        onConfirm = function(path)
            local Shelves = require("br_gallery")
            local added, shelf = Shelves.add(path)
            if not added then
                UIManager:show(InfoMessage:new{
                    text = T(_("\"%1\" is already on your shelves."), shelf.title), timeout = 3,
                })
                return
            end
            self:rebuild()
            if from_menu then from_menu:reload() end
        end,
    })
end

--- Opens a folder shelf as a gallery of covers.
function Home:openFolder(path, title)
    if lfs.attributes(path, "mode") ~= "directory" then
        UIManager:show(InfoMessage:new{
            text = T(_("The folder of \"%1\" is not on this device any more. Long-press the shelf to remove it."), title),
        })
        return
    end
    UIManager:show(require("br_gallery").Gallery:new{ root = path, title = title, home = self, ui = self.ui })
end

--- The tiles that fit in `height`: two per row; if there are too many, the last one opens
--- the Shelves page with all of them. "Add a shelf" (also on the heading) takes the free
--- half of the last row when there is one, and never a row of its own.
function Home:shelfRows(width, height, style)
    local cols = 2
    local gap = s(10)
    local gap_v = s(8)
    local tile_w = math.floor((width - (cols - 1) * gap) / cols)
    local tile_h = s(math.floor(74 * Theme.textGrowth()))
    local entries = self:shelfEntries()
    local add = table.remove(entries) -- "Add a shelf" is always last
    local rows_fit = math.max(1, math.floor((height + gap_v) / (tile_h + gap_v)))
    local slots = rows_fit * cols
    local shown = entries
    if #entries > slots then
        shown = {}
        for i = 1, slots - 1 do shown[i] = entries[i] end
        table.insert(shown, {
            title = _("All shelves"), kind = "all", art_key = "library",
            content = T(_("See all %1 shelves"), #entries),
        })
    elseif #entries % cols ~= 0 then
        table.insert(shown, add)
    end
    local used_art = {}
    local rows, row = {}, nil
    for i, entry in ipairs(shown) do
        if (i - 1) % cols == 0 then
            row = HorizontalGroup:new{ align = "top" }
            table.insert(rows, row)
        else
            table.insert(row, HorizontalSpan:new{ width = gap })
        end
        table.insert(row, W.shelfTile{
            title = entry.title,
            note = entry.content,
            width = tile_w,
            height = tile_h,
            plus = entry.plus,
            art = not entry.plus and W.shelfArt(self.plugin_dir, entry.art_key or entry.title, i, used_art) or nil,
            style = style,
            index = i,
            callback = function() self:shelfAction(entry) end,
            hold_callback = entry.kind == "folder" and function() self:shelfHold(entry) end or nil,
        })
    end
    return rows, tile_h, gap_v
end

function Home:recentStrip(width, height, style, f)
    local recent = self.cache.recent or {}
    local face = f.get(style == "hud" and "mono" or "strong", style == "hud" and 11 or 12)
    local probe = TextWidget:new{ text = "Ag", face = face }
    local text_h = probe:getSize().h
    probe:free()
    local box_h = math.min(s(120), height - text_h - s(6))
    local box_w = math.floor(box_h * 2 / 3)
    local gap = s(12)
    local slot = box_w + s(8) -- the cover's box, room for its shadow or brackets
    local n = math.min(#recent, math.floor((width + gap) / (slot + gap)))
    if n > 0 then -- spread the covers over the whole width
        gap = n > 1 and math.floor((width - n * slot) / (n - 1)) or 0
    end
    local user, pass
    local entry = self:account()
    if entry then user, pass = entry.username, entry.password end
    local row = HorizontalGroup:new{ align = "top" }
    self.pending_covers = {}
    for i = 1, n do
        local book = recent[i]
        local path = book.cover and Covers:cached(book.cover)
        if book.cover and not path then table.insert(self.pending_covers, book.cover) end
        local cover = self:coverWidget(path, book.title, book.author, box_w, box_h, style)
        local item = VerticalGroup:new{
            align = "center",
            BottomContainer:new{ dimen = Geom:new{ w = box_w + s(8), h = box_h + s(8) }, cover },
            VerticalSpan:new{ width = s(4) },
            TextWidget:new{
                text = style == "hud" and W.upper(book.title or "") or (book.title or ""),
                face = face, bold = style == "hud" or nil, fgcolor = W.SOFT, max_width = box_w + s(6),
            },
        }
        if i > 1 then table.insert(row, HorizontalSpan:new{ width = gap }) end
        table.insert(row, W.Tap:new{
            callback = function() self:openShelf(self.cache.recent_url, _("Recently added")) end,
            item,
        })
    end
    self._cover_creds = { user, pass }
    return row
end

function Home:build()
    local style = W.style()
    local f = W.fonts()
    local sw, sh = self.dimen.w, self.dimen.h
    local m = s(14)
    local inner = sw - 2 * m
    local page = VerticalGroup:new{ align = "left" }
    local used = 0
    local function add(w, indent)
        if indent then
            w = HorizontalGroup:new{ HorizontalSpan:new{ width = m }, w }
        end
        table.insert(page, w)
        used = used + w:getSize().h
    end
    local function space(h) add(VerticalSpan:new{ width = h }) end

    add(self:topBar(sw, m, style, f))
    add(self:header(sw, m, style, f))
    space(s(10))
    add(W.label(_("Continue reading"), inner, style), true)
    space(s(6))
    add(self:continueCard(inner, style, f), true)
    space(s(12))
    add(W.label(_("Shelves"), inner, style, { text = _("Add shelf"), callback = function() self:addShelf() end }), true)
    space(s(6))
    local rows = self:shelfRows(inner, sh - used - s(6), style)
    for _, row in ipairs(rows) do
        add(row, true)
        space(s(8))
    end
    self.pending_covers = {}
    local recent = self.cache.recent or {}
    if #recent > 0 and self.cache.recent_url then
        local label = W.label(_("New in your library"), inner, style)
        local remain = sh - used - label:getSize().h - s(20)
        if remain >= s(100) then -- only when the covers can be big enough to read
            space(s(4))
            add(label, true)
            space(s(6))
            add(self:recentStrip(inner, remain, style, f), true)
        end
    end
    self[1] = FrameContainer:new{
        width = sw, height = sh, padding = 0, margin = 0, bordersize = 0,
        background = WHITE,
        page,
    }
end

function Home:rebuild()
    if self._closed then return end
    self:loadReading()
    self:build()
    UIManager:setDirty(self, function() return "ui", self.dimen end)
end

-- ------------------------------------------------------------------ data from the server

--- Reads the catalog's top level and its "recently added" shelf. Returns true when done.
function Home:fetch()
    local entry = self:account()
    if not entry then return false end
    local ok_b, OPDSBrowser = pcall(require, "opdsbrowser")
    if not ok_b or not OPDSBrowser then return false end
    local reader = setmetatable({
        root_catalog_title = entry.title,
        root_catalog_username = entry.username,
        root_catalog_password = entry.password,
        paths = {},
        item_table = {},
    }, { __index = OPDSBrowser })
    local function items(url)
        local ok, catalog = pcall(OPDSBrowser.parseFeed, reader, url)
        if not ok or not catalog then return nil end
        local ok2, list = pcall(function()
            if catalog.is_opds2 then return OPDSBrowser.genItemTableFromCatalog2(reader, catalog, url) end
            return OPDSBrowser.genItemTableFromCatalog(reader, catalog, url)
        end)
        return ok2 and list or nil
    end
    local root = items(entry.url)
    if not root then return false end
    local shelves, recent_url = {}, nil
    for _, it in ipairs(root) do
        if it.url and not (it.acquisitions and it.acquisitions[1]) then
            local title = it.title or it.text or ""
            table.insert(shelves, { title = title, url = it.url, note = clean(it.content) })
            local t = title:lower()
            if not recent_url and (t:find("recent", 1, true) or t:find("new", 1, true)
                    or t:find("added", 1, true) or t:find("latest", 1, true)) then
                recent_url = it.url
            end
        end
    end
    local recent = {}
    if recent_url then
        for _, it in ipairs(items(recent_url) or {}) do
            if it.acquisitions and it.acquisitions[1] then
                table.insert(recent, { title = it.title or it.text, author = it.author, cover = it.thumbnail or it.image })
                if #recent >= 10 then break end
            end
        end
    end
    self.cache = { shelves = shelves, recent = recent, recent_url = recent_url, time = os.time(), root = entry.url }
    Settings.set("home_cache", self.cache)
    return true
end

function Home:fetchCovers()
    local queue = self.pending_covers or {}
    if #queue == 0 then return end
    local creds = self._cover_creds or {}
    local got = 0
    local function step()
        if self._closed then return end
        local url = table.remove(queue, 1)
        if url and Covers:fetch(url, creds[1], creds[2]) then got = got + 1 end
        if #queue > 0 then
            UIManager:scheduleIn(0.05, step)
        elseif got > 0 then
            self:rebuild()
        end
    end
    UIManager:scheduleIn(0.1, step)
end

function Home:refresh(force)
    if self._closed then return end
    local entry = self:account()
    if not entry then
        if force then self:rebuild() end
        return
    end
    local NetworkMgr = require("ui/network/manager")
    local ok, online = pcall(NetworkMgr.isConnected, NetworkMgr)
    local was_offline = self.offline
    self.offline = ok and online == false
    if self.offline then
        if not was_offline or force then self:rebuild() end
        return
    end
    local stale = force or not self.cache.time or self.cache.root ~= entry.url or os.time() - self.cache.time > 60
    if stale and self:fetch() then
        self:rebuild()
    elseif was_offline then
        self:rebuild()
    end
    self:fetchCovers()
end

-- ------------------------------------------------------------------ actions

function Home:openBook(file)
    UIManager:close(self)
    self._closed = true
    self.ui:openFile(file)
end

--- Opens the BookRaven catalog, then (optionally) one of its shelves, above the home.
function Home:openCatalog(url, title, then_fn)
    local opds = self.ui.opds
    local entry = self:account()
    if not opds or not entry then return end
    require("ui/network/manager"):runWhenConnected(function()
        opds:onShowOPDSCatalog()
        local browser = opds.opds_browser
        if not browser then return end
        for i, item in ipairs(browser.item_table or {}) do
            if item.url == entry.url then
                item.idx = i
                browser:onMenuSelect(item)
                break
            end
        end
        if url and url ~= entry.url then
            browser.catalog_title = title
            browser:updateCatalog(url)
        end
        if then_fn then then_fn(browser) end
    end)
end

function Home:openShelf(url, title)
    self:openCatalog(url, title)
end

--- The magnifier: one search for every book, on the device and in the catalog (br_search).
function Home:search()
    require("br_search").everything(self)
end

function Home:onBrHomeSwipe(arg, ges)
    local Quick = require("br_quick")
    if Quick.fromTop(ges) then
        Quick.show(self)
        return true
    end
end

--- Text size, bold or font changed in the quick settings.
function Home:onBookRavenTextChanged()
    self:rebuild()
end

function Home:showMenu()
    if self.ui and self.ui.menu then
        self.ui.menu:onShowMenu()
    end
end

--- The screen was rotated: lay the home out again for the new size.
function Home:onSetDimensions()
    self.dimen = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    self:build()
end

function Home:onClose()
    self._closed = true
    UIManager:close(self)
    return true
end

function Home:onCloseWidget()
    self._closed = true
    if self._refresh then UIManager:unschedule(self._refresh) end
end

return Home
