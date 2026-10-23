--[[--
Cards view for the OPDS browser.

When "Catalog view: cards" is on, any OPDS page that lists books is drawn as a grid of
cards (cover, title, author) instead of KOReader's text list, and a page of shelves (a
navigation feed inside a catalog) as illustrated tiles. Covers come from the catalog's OPDS
image links (BookRaven sends one for every book that has a cover), are fetched one per UI
tick so the page appears at once, and are cached by br_covers.

The OPDS browser itself is untouched: tapping a card calls the same onMenuSelect /
onMenuHold as a list row, so downloading, streaming and book info work as before.
]]

local Blitbuffer = require("ffi/blitbuffer")
local BottomContainer = require("ui/widget/container/bottomcontainer")
local ButtonDialog = require("ui/widget/buttondialog")
local CenterContainer = require("ui/widget/container/centercontainer")
local Device = require("device")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local ImageWidget = require("ui/widget/imagewidget")
local InputContainer = require("ui/widget/container/inputcontainer")
local LeftContainer = require("ui/widget/container/leftcontainer")
local LineWidget = require("ui/widget/linewidget")
local Menu = require("ui/widget/menu")
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextWidget = require("ui/widget/textwidget")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local logger = require("logger")
local _ = require("gettext")
local Screen = Device.screen

local Covers = require("br_covers")
local Settings = require("br_settings")
local Theme = require("br_theme")
local W = require("br_widgets")
local WidgetContainer = require("ui/widget/container/widgetcontainer")

local Cards = {}

local function isBook(entry)
    return entry.acquisitions and entry.acquisitions[1] ~= nil
end

local function coverUrl(entry)
    return entry.thumbnail or entry.image
end

local CLOTH = Blitbuffer.Color8(0x33) -- "cloth-bound" cover for books without one (BookRaven's midnight)
local CLOTH_RULE = Blitbuffer.Color8(0xAA)
local SHELF = Blitbuffer.Color8(0xEE) -- sub-catalog cards
local BORDER = Blitbuffer.Color8(0x88)

-- Card fonts and style for the theme in effect (KOReader's own faces for the original look).
local function cardStyle()
    local theme = Theme.current()
    return theme and theme.card or {
        title = "smallinfofontbold",
        author = "x_smallinfofont",
        cover_title = "smallinfofontbold",
        cover_author = "x_smallinfofont",
    }
end

local function faces(size)
    local c = cardStyle()
    return {
        style = c.style,
        author_prefix = c.author_prefix or "",
        title = Font:getFace(c.title, size),
        author = Font:getFace(c.author, math.max(12, size - 4)),
        cover_title = Font:getFace(c.cover_title, math.max(12, size - 2)),
        cover_author = Font:getFace(c.cover_author, math.max(11, size - 4)),
    }
end

local function upper(s)
    local ok, u = pcall(require("ffi/utf8proc").uppercase_dumb, s)
    return ok and u or s
end

--- HUD frame (Cyberdeck theme): corner brackets around the picture instead of a full border.
local HudFrame = WidgetContainer:extend{ pad = nil }

function HudFrame:getSize()
    local s = self[1]:getSize()
    return Geom:new{ w = s.w + 2 * self.pad, h = s.h + 2 * self.pad }
end

function HudFrame:paintTo(bb, x, y)
    local size = self:getSize()
    self.dimen = Geom:new{ x = x, y = y, w = size.w, h = size.h }
    self[1]:paintTo(bb, x + self.pad, y + self.pad)
    local len = math.floor(math.min(size.w, size.h) * 0.16)
    local t = Size.border.thick
    local x2, y2 = x + size.w, y + size.h
    local black = Blitbuffer.COLOR_BLACK
    bb:paintRect(x, y, len, t, black);            bb:paintRect(x, y, t, len, black)
    bb:paintRect(x2 - len, y, len, t, black);     bb:paintRect(x2 - t, y, t, len, black)
    bb:paintRect(x, y2 - t, len, t, black);       bb:paintRect(x, y2 - len, t, len, black)
    bb:paintRect(x2 - len, y2 - t, len, t, black); bb:paintRect(x2 - t, y2 - len, t, len, black)
end

--- HUD stand-in cover (Cyberdeck theme): black, scanlines, a cut corner, a status line.
local HudCover = WidgetContainer:extend{ width = nil, height = nil, label = nil }

function HudCover:getSize()
    return Geom:new{ w = self.width, h = self.height }
end

function HudCover:paintTo(bb, x, y)
    self.dimen = Geom:new{ x = x, y = y, w = self.width, h = self.height }
    local w, h = self.width, self.height
    bb:paintRect(x, y, w, h, Blitbuffer.COLOR_BLACK)
    local step = Screen:scaleBySize(4)
    for yy = y + step, y + h - 1, step do
        bb:paintRect(x, yy, w, 1, Blitbuffer.Color8(0x30))
    end
    local cut = math.floor(math.min(w, h) * 0.18)
    for r = 0, cut - 1 do -- top-right corner cut
        bb:paintRect(x + w - (cut - r), y + r, cut - r, 1, Blitbuffer.COLOR_WHITE)
    end
    local inner = self[1]:getSize()
    self[1]:paintTo(bb, x + math.floor((w - inner.w) / 2), y + math.floor((h - inner.h) / 2))
    if self.label then
        local ls = self.label:getSize()
        local m = Screen:scaleBySize(6)
        bb:paintRect(x + m, y + h - m - ls.h - Screen:scaleBySize(3), w - 2 * m, Size.line.thin, Blitbuffer.COLOR_GRAY_7)
        self.label:paintTo(bb, x + m, y + h - m - ls.h)
    end
end

local function hudCover(entry, w, h, f)
    local book = isBook(entry)
    local inner_w = w - 2 * Screen:scaleBySize(10)
    local parts = VerticalGroup:new{ align = "center" }
    table.insert(parts, TextBoxWidget:new{
        text = upper(entry.title or entry.text or ""),
        face = f.cover_title,
        width = inner_w,
        alignment = "center",
        fgcolor = Blitbuffer.COLOR_WHITE,
        bgcolor = Blitbuffer.COLOR_BLACK,
        height = math.floor(h * 0.5),
        height_adjust = true,
        height_overflow_show_ellipsis = true,
    })
    if book and entry.author then
        table.insert(parts, VerticalSpan:new{ width = Screen:scaleBySize(6) })
        table.insert(parts, TextWidget:new{
            text = entry.author,
            face = f.cover_author,
            fgcolor = Blitbuffer.COLOR_GRAY_B,
            bgcolor = Blitbuffer.COLOR_BLACK,
            max_width = inner_w,
        })
    end
    return HudCover:new{
        width = w,
        height = h,
        parts,
        label = TextWidget:new{
            text = book and "NO IMAGE DATA" or "DIR //",
            face = Font:getFace("BookRavenMono-Regular.ttf", math.max(9, f.cover_author.orig_size - 3)),
            fgcolor = Blitbuffer.COLOR_GRAY_9,
            bgcolor = Blitbuffer.COLOR_BLACK,
            max_width = w - Screen:scaleBySize(12),
        },
    }
end

--- A stand-in cover: dark cloth with a gilt rule (books) or a pale label (sub-catalogs).
local function fakeCover(entry, w, h, f)
    if f.style == "hud" then return hudCover(entry, w, h, f) end
    local book = isBook(entry)
    local bg = book and CLOTH or SHELF
    local fg = book and Blitbuffer.COLOR_WHITE or Blitbuffer.COLOR_BLACK
    local inner_w = w - 2 * Screen:scaleBySize(10)
    local parts = VerticalGroup:new{ align = "center" }
    table.insert(parts, TextBoxWidget:new{
        text = entry.title or entry.text or "",
        face = f.cover_title,
        width = inner_w,
        alignment = "center",
        fgcolor = fg,
        bgcolor = bg,
        height = math.floor(h * 0.55),
        height_adjust = true,
        height_overflow_show_ellipsis = true,
    })
    if book then
        table.insert(parts, VerticalSpan:new{ width = Screen:scaleBySize(8) })
        table.insert(parts, LineWidget:new{
            background = CLOTH_RULE,
            dimen = Geom:new{ w = math.floor(inner_w * 0.4), h = Size.line.thick },
        })
        if entry.author then
            table.insert(parts, VerticalSpan:new{ width = Screen:scaleBySize(8) })
            table.insert(parts, TextWidget:new{
                text = entry.author,
                face = f.cover_author,
                fgcolor = fg,
                max_width = inner_w,
            })
        end
    end
    return FrameContainer:new{
        width = w,
        height = h,
        padding = 0,
        margin = 0,
        bordersize = Size.border.thin,
        color = BORDER,
        background = bg,
        CenterContainer:new{
            dimen = Geom:new{ w = w - 2 * Size.border.thin, h = h - 2 * Size.border.thin },
            FrameContainer:new{ -- inner rule, like a bound edition
                padding = Screen:scaleBySize(6),
                margin = 0,
                bordersize = book and Size.border.thin or 0,
                color = CLOTH_RULE,
                background = bg,
                parts,
            },
        },
    }
end

local CardItem = InputContainer:extend{
    entry = nil,
    menu = nil,
    width = nil,
    height = nil,
    box_w = nil, -- cover box
    box_h = nil,
    font_size = nil,
}

function CardItem:init()
    self.dimen = Geom:new{ x = 0, y = 0, w = self.width, h = self.height }
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = self.dimen } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = self.dimen } },
    }
    self.f = faces(self.font_size)
    self:build(Covers:cached(coverUrl(self.entry)))
end

function CardItem:build(cover_path)
    self.cover_path = cover_path
    local cover
    local iw, ih
    if cover_path then
        iw, ih = Covers:size(cover_path)
    end
    if iw and ih then
        -- Fit inside the box, keeping the cover's proportions, so the frame hugs the picture.
        if self.f.style == "hud" then
            local pad = Screen:scaleBySize(5)
            local fw, fh = Covers.fit(iw, ih, self.box_w - 2 * pad, self.box_h - 2 * pad)
            cover = HudFrame:new{
                pad = pad,
                ImageWidget:new{ file = cover_path, width = fw, height = fh },
            }
        else
            local shadow = Screen:scaleBySize(3)
            local fw, fh = Covers.fit(iw, ih, self.box_w - 2 * Size.border.thin - shadow,
                self.box_h - 2 * Size.border.thin - shadow)
            cover = W.Mount:new{
                look = "engraved",
                FrameContainer:new{
                    padding = 0,
                    margin = 0,
                    bordersize = Size.border.thin,
                    color = BORDER,
                    ImageWidget:new{
                        file = cover_path,
                        width = fw,
                        height = fh,
                    },
                },
            }
        end
    else
        local cw = math.min(self.box_w, math.floor(self.box_h / 1.5))
        cover = fakeCover(self.entry, cw, math.min(self.box_h, math.floor(cw * 1.5)), self.f)
    end

    local text_w = self.width - 2 * Size.padding.small
    local group = VerticalGroup:new{ align = "center" }
    table.insert(group, BottomContainer:new{
        dimen = Geom:new{ w = self.width, h = self.box_h },
        CenterContainer:new{
            dimen = Geom:new{ w = self.width, h = cover:getSize().h },
            cover,
        },
    })
    table.insert(group, VerticalSpan:new{ width = Size.padding.default })
    table.insert(group, TextBoxWidget:new{
        text = self.entry.title or self.entry.text or "",
        face = self.f.title,
        width = text_w,
        alignment = "center",
        height = self.title_h,
        height_adjust = true,
        height_overflow_show_ellipsis = true,
    })
    if self.entry.author and isBook(self.entry) then
        table.insert(group, CenterContainer:new{
            dimen = Geom:new{ w = self.width, h = self.author_h },
            TextWidget:new{
                text = self.f.author_prefix .. self.entry.author,
                face = self.f.author,
                fgcolor = Blitbuffer.COLOR_DARK_GRAY,
                max_width = text_w,
            },
        })
    end
    self[1] = FrameContainer:new{
        width = self.width,
        height = self.height,
        padding = 0,
        margin = 0,
        bordersize = 0,
        group,
    }
end

--- Swaps the stand-in for the real cover once it has been downloaded.
function CardItem:setCover(path)
    if self.cover_path == path then return end
    self:build(path)
    UIManager:setDirty(self.menu.show_parent, function()
        return "ui", self.dimen, true
    end)
end

function CardItem:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function CardItem:onHoldSelect()
    self.menu:onMenuHold(self.entry)
    return true
end

function CardItem:onFocus()
    self[1].bordersize = Size.border.thick
    return true
end

function CardItem:onUnfocus()
    self[1].bordersize = 0
    return true
end

--- A stand-in cover for a book without one (also used by the library home).
function Cards.standIn(title, author, w, h)
    local size = math.max(9, math.min(15, math.floor(w / Screen:scaleBySize(5.5))))
    return fakeCover({ title = title, author = author, acquisitions = { {} } }, w, h, faces(size))
end

--- How this OPDS page should be drawn: "books" (cards), "shelves" (tiles) or false (the list).
function Cards.wanted(menu)
    if Settings.get("opds_view") ~= "cards" then return false end
    if not menu.paths or #menu.paths == 0 then return false end -- the list of catalogs stays a list
    local items = menu.item_table or {}
    if #items == 0 then return false end
    local shelves = 0
    for _, entry in ipairs(items) do
        if isBook(entry) then return "books" end
        if entry.url or entry.searchable then shelves = shelves + 1 end
    end
    return shelves == #items and "shelves" or false
end

local function recalculate(menu)
    local grid = Settings.grid()
    menu.nb_cols, menu.nb_rows = grid.cols, grid.rows
    menu.perpage = grid.cols * grid.rows
    menu.page_num = math.max(1, math.ceil(#menu.item_table / menu.perpage))
    if menu.page > menu.page_num then menu.page = menu.page_num end
    if menu.page < 1 then menu.page = 1 end

    local others = 0
    if menu.title_bar and not menu.no_title then
        others = others + menu.title_bar:getHeight()
    end
    if menu.page_info then
        others = others + menu.page_info:getSize().h + Size.padding.button
    end
    menu.card_margin = Screen:scaleBySize(grid.cols > 3 and 8 or 12)
    menu.card_w = math.floor((menu.inner_dimen.w - (grid.cols + 1) * menu.card_margin) / grid.cols)
    menu.card_h = math.floor((menu.inner_dimen.h - others - (grid.rows + 1) * menu.card_margin) / grid.rows)
    menu.item_dimen = Geom:new{ x = 0, y = 0, w = menu.card_w, h = menu.card_h }

    -- Text under each cover: two lines of title and one of author.
    local size = ({ [2] = 19, [3] = 17 })[grid.rows] or 15
    if grid.cols > 3 then size = size - 2 end
    menu.card_font_size = size
    local f = faces(size)
    local line_title = math.ceil(f.title.size * 1.3)
    local line_author = math.ceil(f.author.size * 1.45)
    menu.card_title_h = 2 * line_title + 1
    menu.card_author_h = line_author
    menu.card_box_w = menu.card_w - 2 * Size.padding.small
    menu.card_box_h = menu.card_h - menu.card_title_h - menu.card_author_h - Size.padding.default
end

local function scheduleCovers(menu, cards)
    menu._br_generation = (menu._br_generation or 0) + 1
    local generation = menu._br_generation
    local queue = {}
    for _, card in ipairs(cards) do
        if not card.cover_path and coverUrl(card.entry) then
            table.insert(queue, card)
        end
    end
    -- Then the next page's covers, so turning the page shows them at once.
    local ahead = {}
    local first = menu.page * menu.perpage + 1
    for index = first, math.min(first + menu.perpage - 1, #menu.item_table) do
        local url = coverUrl(menu.item_table[index])
        if url and not Covers:cached(url) then table.insert(ahead, url) end
    end
    if #queue == 0 and #ahead == 0 then return end
    local NetworkMgr = require("ui/network/manager")
    local ok, online = pcall(NetworkMgr.isConnected, NetworkMgr)
    if ok and online == false then return end

    local user, pass = menu.root_catalog_username, menu.root_catalog_password
    local function step()
        if menu._br_generation ~= generation or menu._br_closed then return end
        local card = table.remove(queue, 1)
        if card then
            local path = Covers:fetch(coverUrl(card.entry), user, pass)
            if menu._br_generation ~= generation or menu._br_closed then return end
            if path then card:setCover(path) end
        else
            local url = table.remove(ahead, 1)
            if not url then return end
            Covers:fetch(url, user, pass)
        end
        if #queue > 0 or #ahead > 0 then
            UIManager:scheduleIn(0.05, step)
        end
    end
    -- Let the page paint first.
    UIManager:scheduleIn(0.3, step)
end

--- A page of shelves (navigation entries) as two columns of illustrated tiles.
function Cards.updateShelves(menu, select_number)
    local old_dimen = menu.dimen and menu.dimen:copy()
    menu.layout = {}
    menu.item_group:clear()
    local landscape = Screen:getWidth() > Screen:getHeight()
    local cols = landscape and 3 or 2
    local margin = Screen:scaleBySize(10)
    local others = 0
    if menu.title_bar and not menu.no_title then others = others + menu.title_bar:getHeight() end
    if menu.page_info then others = others + menu.page_info:getSize().h + Size.padding.button end
    local tile_w = math.floor((menu.inner_dimen.w - (cols + 1) * margin) / cols)
    local tile_h = Screen:scaleBySize(72)
    local rows = math.max(1, math.floor((menu.inner_dimen.h - others - margin) / (tile_h + margin)))
    menu.perpage = rows * cols
    menu.page_num = math.max(1, math.ceil(#menu.item_table / menu.perpage))
    if menu.page > menu.page_num then menu.page = menu.page_num end
    if menu.page < 1 then menu.page = 1 end
    menu.item_dimen = Geom:new{ x = 0, y = 0, w = tile_w, h = tile_h }
    menu.page_info:resetLayout()
    menu.return_button:resetLayout()
    menu.content_group:resetLayout()

    local style = W.style()
    local offset = (menu.page - 1) * menu.perpage
    local row, row_layout
    for i = 1, menu.perpage do
        local index = offset + i
        local entry = menu.item_table[index]
        if not entry then break end
        entry.idx = index
        if (i - 1) % cols == 0 then
            if row_layout then table.insert(menu.layout, row_layout) end
            row_layout = {}
            table.insert(menu.item_group, VerticalSpan:new{ width = margin })
            row = HorizontalGroup:new{ align = "top" }
            table.insert(menu.item_group, LeftContainer:new{
                dimen = Geom:new{ w = menu.inner_dimen.w, h = tile_h },
                row,
            })
            table.insert(row, HorizontalSpan:new{ width = margin })
        end
        local title = entry.title or entry.text or ""
        local note = entry.content
        if type(note) == "string" then
            note = note:gsub("<[^>]+>", " "):gsub("%s+", " ")
        end
        local tile = W.shelfTile{
            title = title,
            note = note,
            width = tile_w,
            height = tile_h,
            art = W.shelfArt(Theme.plugin_dir, title, index),
            style = style,
            index = index,
            callback = function() menu:onMenuSelect(entry) end,
            hold_callback = function() menu:onMenuHold(entry) end,
        }
        table.insert(row, tile)
        table.insert(row, HorizontalSpan:new{ width = margin })
        table.insert(row_layout, tile)
    end
    if row_layout then table.insert(menu.layout, row_layout) end

    menu:updatePageInfo(select_number)
    if Menu.mergeTitleBarIntoLayout then
        Menu.mergeTitleBarIntoLayout(menu)
    end
    UIManager:setDirty(menu.show_parent, function()
        local refresh_dimen = old_dimen and old_dimen:combine(menu.dimen) or menu.dimen
        return "ui", refresh_dimen, true
    end)
end

--- Replacement for Menu:updateItems when the page is drawn as cards (after CoverMenu:updateItems).
function Cards.updateItems(menu, select_number)
    local old_dimen = menu.dimen and menu.dimen:copy()
    menu.layout = {}
    menu.item_group:clear()
    recalculate(menu)
    menu.page_info:resetLayout()
    menu.return_button:resetLayout()
    menu.content_group:resetLayout()

    local cards = {}
    local row, row_layout
    local offset = (menu.page - 1) * menu.perpage
    for i = 1, menu.perpage do
        local index = offset + i
        local entry = menu.item_table[index]
        if not entry then break end
        entry.idx = index
        if (i - 1) % menu.nb_cols == 0 then
            if row_layout then table.insert(menu.layout, row_layout) end
            row_layout = {}
            table.insert(menu.item_group, VerticalSpan:new{ width = menu.card_margin })
            row = HorizontalGroup:new{}
            table.insert(menu.item_group, LeftContainer:new{
                dimen = Geom:new{ w = menu.inner_dimen.w, h = menu.card_h },
                row,
            })
            table.insert(row, HorizontalSpan:new{ width = menu.card_margin })
        end
        local card = CardItem:new{
            entry = entry,
            menu = menu,
            show_parent = menu.show_parent,
            width = menu.card_w,
            height = menu.card_h,
            box_w = menu.card_box_w,
            box_h = menu.card_box_h,
            title_h = menu.card_title_h,
            author_h = menu.card_author_h,
            font_size = menu.card_font_size,
        }
        table.insert(row, card)
        table.insert(row, HorizontalSpan:new{ width = menu.card_margin })
        table.insert(row_layout, card)
        table.insert(cards, card)
    end
    if row_layout then table.insert(menu.layout, row_layout) end

    menu:updatePageInfo(select_number)
    if Menu.mergeTitleBarIntoLayout then
        Menu.mergeTitleBarIntoLayout(menu)
    end

    menu.show_parent.dithered = true
    UIManager:setDirty(menu.show_parent, function()
        local refresh_dimen = old_dimen and old_dimen:combine(menu.dimen) or menu.dimen
        return "ui", refresh_dimen, true
    end)
    scheduleCovers(menu, cards)
end

--- Calls fn(self) while adding our view switch to the ButtonDialog it opens.
local function withViewButton(browser, fn, ...)
    local had_own_new = rawget(ButtonDialog, "new")
    local orig_new = ButtonDialog.new
    local dialog
    ButtonDialog.new = function(cls, o)
        ButtonDialog.new = had_own_new -- one dialog only
        if type(o) == "table" and type(o.buttons) == "table" then
            local cards = Settings.get("opds_view") == "cards"
            table.insert(o.buttons, {})
            table.insert(o.buttons, {{
                text = cards and ("\u{2630} " .. _("Show as list")) or ("\u{25A6} " .. _("Show as cards")),
                align = "left",
                callback = function()
                    if dialog then UIManager:close(dialog) end
                    Settings.set("opds_view", cards and "list" or "cards")
                    browser:updateItems()
                end,
            }})
        end
        dialog = orig_new(cls, o)
        return dialog
    end
    local ok, err = pcall(fn, browser, ...)
    if rawget(ButtonDialog, "new") ~= had_own_new then
        ButtonDialog.new = had_own_new
    end
    if not ok then error(err) end
end

--- Patches the OPDS browser class once.
function Cards.install(OPDSBrowser)
    if not OPDSBrowser or OPDSBrowser._bookraven_cards then return end
    OPDSBrowser._bookraven_cards = true

    local orig_updateItems = OPDSBrowser.updateItems
    OPDSBrowser.updateItems = function(self, select_number, no_recalculate_dimen)
        local mode = Cards.wanted(self)
        if mode then
            self._br_cards = true
            local ok, err = pcall(mode == "shelves" and Cards.updateShelves or Cards.updateItems, self, select_number)
            if ok then return end
            logger.err("BookRaven: cards view failed, falling back to the list", err)
            Settings.set("opds_view", "list")
        end
        if self._br_cards then
            -- Back to a list: make Menu recompute its row geometry.
            self._br_cards = nil
            self.perpage = nil
            no_recalculate_dimen = false
        end
        self._br_generation = (self._br_generation or 0) + 1 -- cancel pending cover downloads
        return orig_updateItems(self, select_number, no_recalculate_dimen)
    end

    local orig_onCloseWidget = OPDSBrowser.onCloseWidget
    OPDSBrowser.onCloseWidget = function(self, ...)
        self._br_closed = true
        if orig_onCloseWidget then
            return orig_onCloseWidget(self, ...)
        end
    end

    for _, name in ipairs({ "showOPDSMenu", "showCatalogMenu" }) do
        local orig = OPDSBrowser[name]
        if orig then
            OPDSBrowser[name] = function(self, ...)
                return withViewButton(self, orig, ...)
            end
        end
    end
end

return Cards
