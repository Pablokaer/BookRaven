--[[--
CyberUI drawing pieces: the building blocks of the Cyberdeck theme's screens (cy_app).

  * text in any colour (U.text: KOReader's TextWidget only paints greys), text boxes;
  * boxes with cut corners, filled or outlined (U.Box, U.shape, U.frame), corner brackets;
  * buttons (outline, accent, fill, panel), segmented tabs, tags;
  * the status bar (CYBR//DECK, time, battery, CPU, memory) and the bottom navigation bar;
  * the page header (the back block, a path and a title), section labels, key/value rows;
  * progress as a heartbeat line, a row of blocks or a bar; barcodes;
  * the pager (first, previous, "SECTOR 01 / 03", next, last) and a choice popup.

Colours are roles of cy_palette (bg, fg, accent, ink, muted, panel, rule) or Blitbuffer colours.
Sizes are in KOReader's scaled units (U.s). Fonts are the theme's Chakra Petch and Share Tech
Mono, through br_theme's text settings (size, bold, font family).
]]

local Blitbuffer = require("ffi/blitbuffer")
local DataStorage = require("datastorage")
local Device = require("device")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local ImageWidget = require("ui/widget/imagewidget")
local InputContainer = require("ui/widget/container/inputcontainer")
local RenderText = require("ui/rendertext")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextWidget = require("ui/widget/textwidget")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local Widget = require("ui/widget/widget")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local Screen = Device.screen

local Pal = require("cy_palette")
local Theme = require("br_theme")
local W = require("br_widgets")

local U = {}

local function s(n) return Screen:scaleBySize(n) end
U.s = s
U.Tap = W.Tap

--- A role ("fg", "accent"…) or a colour, as a colour.
local function col(c)
    if type(c) == "string" then return Pal.c(c) end
    return c
end
U.col = col

-- ------------------------------------------------------------------ type

U.FONT = {
    display = "BookRavenCyber-Bold.ttf",
    semi = "BookRavenCyber-SemiBold.ttf",
    body = "BookRavenCyber-Medium.ttf",
    mono = "BookRavenMono-Regular.ttf",
}
local KIND = { display = "bold", semi = "strong", body = "regular", mono = "mono" }

function U.face(kind, size)
    return Theme.face(U.FONT[kind] or U.FONT.body, size, KIND[kind] or "regular")
end

function U.upper(text)
    local ok, up = pcall(require("ffi/utf8proc").uppercase_dumb, text or "")
    return ok and up or (text or "")
end

--- Letters spread with hair spaces, for display titles and labels.
function U.tracked(text)
    local out = {}
    for _, ch in ipairs(require("util").splitToChars(text or "")) do
        table.insert(out, ch)
    end
    return table.concat(out, "\u{200A}")
end

--- A TextWidget that paints in colour on a colour screen (KOReader's paints greys only).
local CyText = TextWidget:extend{}
U.CyText = CyText

function CyText:paintTo(bb, x, y)
    if Blitbuffer.isColor8(self.fgcolor) or not self.use_xtext then
        if not Blitbuffer.isColor8(self.fgcolor) then
            self.fgcolor = self.fgcolor:getColor8()
        end
        return TextWidget.paintTo(self, bb, x, y)
    end
    self:updateSize()
    if self._is_empty then return end
    if not self._xshaping then
        self._xshaping = self._xtext:shapeLine(self._shape_start, self._shape_end,
            self._shape_idx_to_substitute_with_ellipsis)
    end
    local text_width = bb:getWidth() - x
    if self.max_width and self.max_width < text_width then text_width = self.max_width end
    local pen_x = 0
    local baseline = self.forced_baseline or self._baseline_h
    for _, xglyph in ipairs(self._xshaping) do
        if pen_x >= text_width then break end
        local face = self.face.getFallbackFont(xglyph.font_num)
        local glyph = RenderText:getGlyphByIndex(face, xglyph.glyph, self.bold)
        bb:colorblitFromRGB32(glyph.bb,
            x + pen_x + glyph.l + xglyph.x_offset,
            y + baseline - glyph.t - xglyph.y_offset,
            0, 0, glyph.bb:getWidth(), glyph.bb:getHeight(), self.fgcolor)
        pen_x = pen_x + xglyph.x_advance
    end
end

--- One line of text. args: text, kind (display/semi/body/mono), size, color (role), upper,
--- tracked, max_width, bold.
function U.text(args)
    local text = args.text or ""
    if args.upper then text = U.upper(text) end
    if args.tracked then text = U.tracked(text) end
    return CyText:new{
        text = text,
        face = U.face(args.kind or "body", args.size or 14),
        fgcolor = col(args.color or "fg"),
        max_width = args.max_width,
        bold = args.bold,
    }
end

--- Wrapped text. args: as U.text, plus width, height (lines that fit, with an ellipsis), bg,
--- alignment.
function U.textbox(args)
    local text = args.text or ""
    if args.upper then text = U.upper(text) end
    if args.tracked then text = U.tracked(text) end
    return TextBoxWidget:new{
        text = text,
        face = U.face(args.kind or "body", args.size or 14),
        fgcolor = col(args.color or "fg"),
        bgcolor = col(args.bg or "bg"),
        width = args.width,
        height = args.height,
        height_adjust = args.height ~= nil,
        height_overflow_show_ellipsis = args.height ~= nil,
        alignment = args.alignment or "left",
        bold = args.bold,
        line_height = args.line_height,
    }
end

--- The height of a line of text in this face.
function U.lineHeight(kind, size)
    local probe = U.text{ text = "Ag", kind = kind, size = size }
    local h = probe:getSize().h
    probe:free()
    return h
end

-- ------------------------------------------------------------------ shapes

--- A filled shape with 45° cut corners: cuts = { tl =, tr =, br =, bl = } in pixels.
function U.shape(bb, x, y, w, h, c, cuts)
    if w <= 0 or h <= 0 then return end
    c = col(c)
    cuts = cuts or {}
    local tl, tr, br, bl = cuts.tl or 0, cuts.tr or 0, cuts.br or 0, cuts.bl or 0
    local top, bot = math.min(h, math.max(tl, tr)), math.min(h, math.max(bl, br))
    for r = 0, top - 1 do
        local l, rr = math.max(0, tl - r), math.max(0, tr - r)
        Pal.fill(bb, x + l, y + r, w - l - rr, 1, c)
    end
    if h - top - bot > 0 then Pal.fill(bb, x, y + top, w, h - top - bot, c) end
    for r = 0, bot - 1 do
        local l, rr = math.max(0, bl - r), math.max(0, br - r)
        Pal.fill(bb, x + l, y + h - 1 - r, w - l - rr, 1, c)
    end
end

--- An outlined shape: a line t thick, filled inside with fill (the page by default).
function U.frame(bb, x, y, w, h, t, line, fill, cuts)
    U.shape(bb, x, y, w, h, line, cuts)
    local inner = {}
    for k, v in pairs(cuts or {}) do inner[k] = math.max(0, v - math.floor(t * 0.586 + 0.5)) end
    U.shape(bb, x + t, y + t, w - 2 * t, h - 2 * t, fill or "bg", inner)
end

--- A straight line t thick from (x0, y0) to (x1, y1).
function U.line(bb, x0, y0, x1, y1, t, c)
    c = col(c)
    local dx, dy = x1 - x0, y1 - y0
    local n = math.max(math.abs(dx), math.abs(dy), 1)
    for i = 0, n do
        local px = math.floor(x0 + dx * i / n + 0.5)
        local py = math.floor(y0 + dy * i / n + 0.5)
        Pal.fill(bb, px, py, t, t, c)
    end
end

--- Corner brackets around a box: [ ] (len: the arms' length).
function U.brackets(bb, x, y, w, h, len, t, c)
    c = col(c or "fg")
    t = t or math.max(2, s(1.5))
    len = len or s(14)
    local x2, y2 = x + w, y + h
    Pal.fill(bb, x, y, len, t, c);          Pal.fill(bb, x, y, t, len, c)
    Pal.fill(bb, x2 - len, y, len, t, c);   Pal.fill(bb, x2 - t, y, t, len, c)
    Pal.fill(bb, x, y2 - t, len, t, c);     Pal.fill(bb, x, y2 - len, t, len, c)
    Pal.fill(bb, x2 - len, y2 - t, len, t, c); Pal.fill(bb, x2 - t, y2 - len, t, len, c)
end

--- A dashed horizontal line.
function U.dashed(bb, x, y, w, t, c, dash, gap)
    dash, gap = dash or s(8), gap or s(6)
    local px = x
    while px < x + w do
        Pal.fill(bb, px, y, math.min(dash, x + w - px), t, col(c))
        px = px + dash + gap
    end
end

--- A widget drawn by a function: paint(bb, x, y, w, h).
local Painter = Widget:extend{ width = 0, height = 0, paint = nil }
U.Painter = Painter

function Painter:getSize() return Geom:new{ w = self.width, h = self.height } end

function Painter:paintTo(bb, x, y)
    self.dimen = Geom:new{ x = x, y = y, w = self.width, h = self.height }
    if self.paint then
        local ok, err = pcall(self.paint, bb, x, y, self.width, self.height)
        if not ok then logger.warn("CyberUI paint:", err) end
    end
end

--- A box: a shape (filled, outlined, or both) with a child placed inside.
--- fill, line: roles or colours (nil: none); t: line thickness; cuts; padding (or pad_l/pad_r/
--- pad_t/pad_b); align "left" | "center" | "right"; valign "top" | "center" | "bottom";
--- shadow: a block of that colour behind, offset down and right.
local Box = WidgetContainer:extend{
    width = nil, height = nil, fill = nil, line = nil, t = nil, cuts = nil, padding = 0,
    align = "left", valign = "center", shadow = nil,
}
U.Box = Box

function Box:getSize()
    local cw, ch = 0, 0
    if self[1] then
        local cs = self[1]:getSize()
        cw, ch = cs.w, cs.h
    end
    local p = self.padding or 0
    local w = self.width or (cw + (self.pad_l or p) + (self.pad_r or p))
    local h = self.height or (ch + (self.pad_t or p) + (self.pad_b or p))
    return Geom:new{ w = w, h = h }
end

function Box:paintTo(bb, x, y)
    local size = self:getSize()
    local w, h = size.w, size.h
    self.dimen = Geom:new{ x = x, y = y, w = w, h = h }
    local ok, err = pcall(function()
        if self.shadow then
            local o = self.shadow_offset or s(6)
            U.shape(bb, x + o, y + o, w, h, self.shadow, self.cuts)
        end
        if self.line then
            U.frame(bb, x, y, w, h, self.t or math.max(2, s(1.5)), self.line, self.fill or "bg", self.cuts)
        elseif self.fill then
            U.shape(bb, x, y, w, h, self.fill, self.cuts)
        end
    end)
    if not ok then logger.warn("CyberUI box:", err) end
    local child = self[1]
    if not child then return end
    local cs = child:getSize()
    local p = self.padding or 0
    local pl, pr, pt, pb = self.pad_l or p, self.pad_r or p, self.pad_t or p, self.pad_b or p
    local cx, cy = x + pl, y + pt
    if self.align == "center" then
        cx = x + pl + math.floor((w - pl - pr - cs.w) / 2)
    elseif self.align == "right" then
        cx = x + w - pr - cs.w
    end
    if self.valign == "center" then
        cy = y + pt + math.floor((h - pt - pb - cs.h) / 2)
    elseif self.valign == "bottom" then
        cy = y + h - pb - cs.h
    end
    child:paintTo(bb, cx, cy)
end

--- Children side by side or stacked, with gaps.
function U.row(items, gap, align)
    local g = HorizontalGroup:new{ align = align or "center" }
    for i, it in ipairs(items) do
        if i > 1 and (gap or 0) > 0 then table.insert(g, HorizontalSpan:new{ width = gap }) end
        table.insert(g, it)
    end
    return g
end

function U.column(items, gap, align)
    local g = VerticalGroup:new{ align = align or "left" }
    for i, it in ipairs(items) do
        if i > 1 and (gap or 0) > 0 then table.insert(g, VerticalSpan:new{ width = gap }) end
        table.insert(g, it)
    end
    return g
end

function U.hspace(w) return HorizontalSpan:new{ width = w } end
function U.vspace(h) return VerticalSpan:new{ width = h } end

--- A widget placed in a box of exactly w x h (align, valign as for Box).
function U.place(widget, w, h, align, valign)
    return Box:new{ width = w, height = h, align = align or "left", valign = valign or "center", widget }
end

--- Widgets laid over each other in a w x h area: { widget, x =, y = } each.
local Layers = WidgetContainer:extend{ width = 0, height = 0 }
U.Layers = Layers

function Layers:getSize() return Geom:new{ w = self.width, h = self.height } end

function Layers:paintTo(bb, x, y)
    self.dimen = Geom:new{ x = x, y = y, w = self.width, h = self.height }
    for _, it in ipairs(self) do
        it[1]:paintTo(bb, x + (it.x or 0), y + (it.y or 0))
    end
end

function Layers:handleEvent(event)
    for i = #self, 1, -1 do
        if self[i][1]:handleEvent(event) then return true end
    end
end

function Layers:free()
    for _, it in ipairs(self) do
        if it[1].free then it[1]:free() end
    end
end

-- ------------------------------------------------------------------ icons

local icon_dir
local function iconCache()
    if not icon_dir then
        icon_dir = DataStorage:getDataDir() .. "/cache/bookraven-cyberui"
        if lfs.attributes(icon_dir, "mode") ~= "directory" then
            lfs.mkdir(DataStorage:getDataDir() .. "/cache")
            lfs.mkdir(icon_dir)
        end
    end
    return icon_dir
end
U.cacheDir = iconCache

--- The file of an icon (icons/cyberui/<name>.svg) drawn in a colour role.
function U.iconFile(name, role)
    local hex = Pal.hex(role or "fg")
    local dest = string.format("%s/%s-%s.svg", iconCache(), name, hex:sub(2))
    if lfs.attributes(dest, "mode") == "file" then return dest end
    local src = string.format("%s/icons/cyberui/%s.svg", Theme.plugin_dir or ".", name)
    local f = io.open(src, "rb")
    if not f then return nil end
    local svg = f:read("*a")
    f:close()
    svg = svg:gsub("currentColor", hex)
    local out = io.open(dest, "wb")
    if not out then return src end
    out:write(svg)
    out:close()
    return dest
end

function U.icon(name, size, role)
    local file = U.iconFile(name, role)
    if not file then return U.hspace(size) end
    return ImageWidget:new{ file = file, width = size, height = size, alpha = true }
end

-- ------------------------------------------------------------------ buttons and tags

-- The colours of each kind of button: shape fill, outline, text.
local KINDS = {
    outline = { fill = "bg", line = "fg", text = "fg" },
    accent = { fill = "accent", text = "ink" },
    fill = { fill = "fg", text = "ink" },
    panel = { fill = "panel", text = "fg" },
    danger = { fill = "bg", line = "accent", text = "accent" },
    ghost = { text = "fg" },
}
U.KINDS = KINDS

--- A button. args: text, sub (a second line), icon, kind, width, height, cuts, size, font
--- (display by default), align ("center" | "left"), callback, hold_callback, bg (the page under
--- it, for outlines).
function U.button(args)
    local k = KINDS[args.kind or "outline"] or KINDS.outline
    local size = args.size or 14
    local pad = args.pad or s(12)
    local parts = {}
    local icon_size = args.icon_size or math.floor(U.lineHeight("display", size) * 1.05)
    if args.icon then table.insert(parts, U.icon(args.icon, icon_size, k.text)) end
    local text_w = args.width and (args.width - 2 * pad - (args.icon and (icon_size + s(10)) or 0)) or nil
    if args.text then
        local label = U.text{
            text = args.text, kind = args.font or "display", size = size, color = k.text,
            upper = args.upper ~= false, tracked = args.tracked ~= false, max_width = text_w,
        }
        if args.sub then
            label = U.column({
                label,
                U.text{ text = args.sub, kind = "mono", size = args.sub_size or math.max(9, size - 3),
                    color = args.sub_color or k.text, upper = true, max_width = text_w },
            }, s(2))
        end
        table.insert(parts, label)
    end
    local content = U.row(parts, s(10))
    local box = Box:new{
        width = args.width, height = args.height or (content:getSize().h + 2 * s(9)),
        fill = k.line and (args.bg or k.fill) or k.fill, line = k.line, t = args.t, cuts = args.cuts,
        pad_l = pad, pad_r = pad, align = args.align or "center", valign = "center",
        content,
    }
    if not args.callback and not args.hold_callback then return box end
    return W.Tap:new{ callback = args.callback, hold_callback = args.hold_callback, box }
end

--- A small tag: "NEW", "42%".
function U.tag(text, kind, size, cuts)
    local k = KINDS[kind or "accent"] or KINDS.accent
    local label = U.text{ text = text, kind = "mono", size = size or 10, color = k.text, upper = true }
    return Box:new{ fill = k.fill, line = k.line, t = math.max(1, s(1)), cuts = cuts,
        pad_l = s(5), pad_r = s(6), pad_t = s(1), pad_b = s(1), label }
end

--- Segmented tabs in an outline: items { { text =, key = } }, selected key, on_select(key).
function U.segmented(args)
    local n = #args.items
    local t = math.max(2, s(1.5))
    local h = args.height or s(40)
    local inner_w = args.width - 2 * t
    local cell = math.floor(inner_w / n)
    local row = HorizontalGroup:new{ align = "center" }
    for i, it in ipairs(args.items) do
        local on = it.key == args.selected
        local w = (i == n) and (inner_w - cell * (n - 1)) or cell
        local label = U.text{
            text = it.text, kind = "display", size = args.size or 13, color = on and "ink" or "fg",
            upper = true, tracked = true, max_width = w - s(8),
        }
        table.insert(row, W.Tap:new{
            callback = function() if args.on_select then args.on_select(it.key) end end,
            Box:new{ width = w, height = h - 2 * t, fill = on and "fg" or nil, align = "center", label },
        })
    end
    return Box:new{ width = args.width, height = h, line = "fg", t = t, padding = t, align = "left", row }
end

-- ------------------------------------------------------------------ bars of the screens

--- The status bar: CYBR//DECK, ticks, then time, battery and (optionally) CPU and memory.
function U.statusBar(width, info, callback)
    local size = 11
    local left = U.text{ text = "CYBR//DECK", kind = "mono", size = size, color = "fg" }
    local parts = { os.date("%H:%M") }
    if info.battery then table.insert(parts, string.format("BAT %d%%", info.battery)) end
    if info.cpu then table.insert(parts, string.format("CPU %d%%", info.cpu)) end
    if info.mem then table.insert(parts, string.format("MEM %d%%", info.mem)) end
    local right = U.text{ text = table.concat(parts, "  "), kind = "mono", size = size, color = "fg" }
    local h = math.max(left:getSize().h, right:getSize().h) + s(10)
    local lw, rw = left:getSize().w, right:getSize().w
    local bar = Painter:new{
        width = width, height = h,
        paint = function(bb, x, y, w)
            -- ticks between the name and the readings
            local from, to = x + lw + s(10), x + w - rw - s(12)
            local step = s(7)
            local th = math.floor(h * 0.32)
            local tx = from
            while tx + 1 < to do
                Pal.fill(bb, tx, y + math.floor((h - th) / 2), math.max(1, s(1)), th, Pal.c("muted"))
                tx = tx + step
            end
        end,
    }
    local layers = Layers:new{
        width = width, height = h,
        { bar, x = 0, y = 0 },
        { left, x = 0, y = math.floor((h - left:getSize().h) / 2) },
        { right, x = width - rw, y = math.floor((h - right:getSize().h) / 2) },
    }
    if not callback then return layers end
    return W.Tap:new{ callback = callback, layers }
end

U.NAV = {
    { key = "home", text = "Home", icon = "home" },
    { key = "library", text = "Library", icon = "library" },
    { key = "caches", text = "Caches", icon = "caches" },
    { key = "log", text = "Log", icon = "log" },
    { key = "system", text = "System", icon = "system" },
}

--- The bottom navigation bar: a rule, then five cells; the active one is an accent block.
function U.navBar(width, active, on_select)
    local t = math.max(2, s(1.5))
    local h = s(46)
    local n = #U.NAV
    local cell = math.floor(width / n)
    local row = HorizontalGroup:new{ align = "center" }
    local size = width < s(520) and 11 or 13
    for i, it in ipairs(U.NAV) do
        local on = it.key == active
        local w = (i == n) and (width - cell * (n - 1)) or cell
        local role = on and "ink" or "fg"
        local icon_size = s(18)
        local label = U.text{ text = it.text, kind = "display", size = size, color = role, upper = true,
            tracked = true, max_width = w - icon_size - s(14) }
        local content = U.row({ U.icon(it.icon, icon_size, role), label }, s(6))
        if content:getSize().w > w - s(4) then content = U.icon(it.icon, s(22), role) end
        table.insert(row, W.Tap:new{
            callback = function() on_select(it.key) end,
            Box:new{ width = w, height = h - t - s(4), fill = on and "accent" or nil, align = "center", content },
        })
    end
    -- on the page colour, so nothing of a screen that runs long shows through it
    return Box:new{ width = width, height = h, fill = "bg", valign = "top", U.column({
        Painter:new{ width = width, height = t, paint = function(bb, x, y, w, hh) Pal.fill(bb, x, y, w, hh, Pal.c("fg")) end },
        U.vspace(s(4)),
        row,
    }) }
end

--- The page header: the back block (accent, cut corner), a path and a title; buttons on the right.
--- args: width, path, title, on_back, right = { widgets }.
function U.header(args)
    local size = s(44)
    local back = W.Tap:new{
        callback = args.on_back,
        Box:new{ width = size, height = size, fill = "accent", cuts = { tl = s(12) }, align = "center",
            U.icon("back", s(22), "ink") },
    }
    local right = args.right and U.row(args.right, s(10)) or nil
    local right_w = right and (right:getSize().w + s(12)) or 0
    local text_w = args.width - size - s(12) - right_w
    local texts = {}
    if args.path then
        table.insert(texts, U.text{ text = args.path, kind = "mono", size = 11, color = "muted", upper = true, max_width = text_w })
    end
    table.insert(texts, U.text{ text = args.title, kind = "display", size = args.title_size or 24, color = "fg",
        upper = true, tracked = true, max_width = text_w })
    local left = U.row({ back, U.column(texts, 0) }, s(12))
    local h = math.max(size, left:getSize().h)
    local layers = Layers:new{ width = args.width, height = h, { left, x = 0, y = 0 } }
    if right then
        table.insert(layers, { right, x = args.width - right:getSize().w, y = math.floor((h - right:getSize().h) / 2) })
    end
    return layers
end

--- A section label: tracked capitals, and an optional reading on the right.
function U.label(text, width, right_text, color)
    local l = U.text{ text = text, kind = "display", size = 13, color = color or "fg", upper = true, tracked = true,
        max_width = width - s(10) }
    if not right_text then return l end
    local r = U.text{ text = right_text, kind = "mono", size = 12, color = "fg", upper = true }
    local h = math.max(l:getSize().h, r:getSize().h)
    return Layers:new{
        width = width, height = h,
        { l, x = 0, y = h - l:getSize().h },
        { r, x = width - r:getSize().w, y = h - r:getSize().h },
    }
end

--- Rows of a key and a value: { { key, value, role } }.
function U.kv(rows, key_w, width, size, gap)
    local items = {}
    for _, r in ipairs(rows) do
        table.insert(items, U.row({
            U.place(U.text{ text = r[1], kind = "mono", size = size or 12, color = "muted", upper = true, max_width = key_w - s(6) }, key_w, nil),
            U.text{ text = r[2] or "--", kind = "mono", size = size or 12, color = r[3] or "fg", max_width = width - key_w },
        }, 0))
    end
    return U.column(items, gap or s(4))
end

function U.rule(width, role, t)
    return Painter:new{
        width = width, height = t or math.max(1, s(1)),
        paint = function(bb, x, y, w, h) Pal.fill(bb, x, y, w, h, Pal.c(role or "rule")) end,
    }
end

-- ------------------------------------------------------------------ progress

--- A heartbeat line: the read part in the accent, a cursor, the rest faint. pct 0..1.
function U.heartbeat(width, height, pct)
    pct = math.max(0, math.min(1, pct or 0))
    return Painter:new{
        width = width, height = height,
        paint = function(bb, x, y, w, h)
            local mid = y + math.floor(h / 2)
            local beat = math.max(s(40), math.floor(w / 7))
            local cursor = x + math.floor(w * pct)
            local thick, thin = math.max(2, s(1.6)), math.max(1, s(0.8))
            local amp = math.floor(h * 0.42)
            -- one beat, as (dx, dy) points along a period: flat, a bump, a spike down and up, a bump
            local shape = {
                { 0, 0 }, { 0.30, 0 }, { 0.36, -0.18 }, { 0.42, 0 }, { 0.50, 0 }, { 0.54, 0.22 },
                { 0.58, -1 }, { 0.63, 0.55 }, { 0.67, 0 }, { 0.76, -0.25 }, { 0.84, 0 }, { 1, 0 },
            }
            local px, py
            local start = x
            while start < x + w do
                for i, p in ipairs(shape) do
                    local nx = math.min(x + w - 1, start + math.floor(p[1] * beat))
                    local ny = mid + math.floor(p[2] * amp)
                    if i > 1 and px then
                        local read = nx <= cursor
                        if px < cursor and nx > cursor then
                            -- split the segment at the cursor
                            local cy = py + math.floor((ny - py) * (cursor - px) / math.max(1, nx - px))
                            U.line(bb, px, py, cursor, cy, thick, "accent")
                            U.line(bb, cursor, cy, nx, ny, thin, "muted")
                        else
                            U.line(bb, px, py, nx, ny, read and thick or thin, read and "accent" or "muted")
                        end
                    end
                    px, py = nx, ny
                end
                start = start + beat
            end
            local cw = math.max(2, s(2))
            Pal.fill(bb, cursor - math.floor(cw / 2), y, cw, h, Pal.c("fg"))
            local sq = s(8)
            Pal.fill(bb, cursor - math.floor(sq / 2), mid - math.floor(sq / 2), sq, sq, Pal.c("fg"))
        end,
    }
end

--- A row of n blocks, the first pct of them filled.
function U.blocks(width, height, pct, n)
    pct = math.max(0, math.min(1, pct or 0))
    return Painter:new{
        width = width, height = height,
        paint = function(bb, x, y, w, h)
            n = n or math.max(8, math.floor(w / s(17)))
            local gap = math.max(2, s(2))
            local cell = math.floor((w - (n - 1) * gap) / n)
            local filled = math.floor(pct * n + 0.5)
            for i = 0, n - 1 do
                local cx = x + i * (cell + gap)
                local cw = (i == n - 1) and (x + w - cx) or cell
                if i < filled then
                    Pal.fill(bb, cx, y, cw, h, Pal.c("fg"))
                else
                    Pal.border(bb, cx, y, cw, h, math.max(1, s(0.8)), Pal.c("fg"))
                end
            end
        end,
    }
end

--- A thin outlined bar with its filled part.
function U.bar(width, height, pct)
    pct = math.max(0, math.min(1, pct or 0))
    return Painter:new{
        width = width, height = height,
        paint = function(bb, x, y, w, h)
            local t = math.max(1, s(1))
            Pal.border(bb, x, y, w, h, t, Pal.c("fg"))
            if pct > 0 then Pal.fill(bb, x, y, math.max(t, math.floor(w * pct)), h, Pal.c("fg")) end
        end,
    }
end

--- The book progress in the style chosen in System → Look (cyber_progress).
function U.progress(width, pct)
    local style = require("br_settings").get("cyber_progress") or "heartbeat"
    if style == "blocks" then return U.blocks(width, s(12), pct) end
    if style == "bar" then return U.bar(width, s(8), pct) end
    return U.heartbeat(width, s(40), pct)
end

--- A barcode: bars of different widths, the same for the same seed.
function U.barcode(width, height, seed, role)
    return Painter:new{
        width = width, height = height,
        paint = function(bb, x, y, w, h)
            local hsh = 7
            for i = 1, #(seed or "") do hsh = (hsh * 31 + seed:byte(i)) % 65521 end
            local px = x
            local unit = math.max(1, s(1.4))
            local c = Pal.c(role or "fg")
            while px < x + w do
                hsh = (hsh * 1103 + 12345) % 65521
                local bw = unit * (1 + hsh % 3)
                local gap = unit * (1 + math.floor(hsh / 7) % 2)
                Pal.fill(bb, px, y, math.min(bw, x + w - px), h, c)
                px = px + bw + gap
            end
        end,
    }
end

-- ------------------------------------------------------------------ pager

--- First, previous, "LABEL 01 / 03", next, last. on_page(n).
function U.pager(args)
    local size = s(42)
    local function sq(icon, kind, page, enabled)
        return W.Tap:new{
            callback = function() if enabled then args.on_page(page) end end,
            Box:new{ width = size, height = size, line = kind == "outline" and "fg" or nil,
                fill = kind == "fill" and "fg" or nil, align = "center",
                U.icon(icon, s(20), kind == "fill" and "ink" or "fg") },
        }
    end
    local p, n = args.page, math.max(1, args.pages)
    local label = U.text{ text = string.format("%s %02d / %02d", args.label or "SECTOR", p, n), kind = "mono",
        size = 13, color = "fg", upper = true }
    local left = U.row({ sq("first", "outline", 1, p > 1), sq("back", "outline", p - 1, p > 1) }, s(10))
    local right = U.row({ sq("forward", "fill", p + 1, p < n), sq("last", "outline", n, p < n) }, s(10))
    return Layers:new{
        width = args.width, height = size,
        { left, x = 0, y = 0 },
        { label, x = math.floor((args.width - label:getSize().w) / 2), y = math.floor((size - label:getSize().h) / 2) },
        { right, x = args.width - right:getSize().w, y = 0 },
    }
end

-- ------------------------------------------------------------------ popup

--- A choice popup over the screen: a framed panel with a shadow, choices in two columns (the
--- chosen one in the accent, with a check), and CLOSE. args: title, choices { { text, key } },
--- selected, on_select(key), cols.
local Popup = InputContainer:extend{ modal = true, name = "cyberui_popup" }
U.Popup = Popup

function Popup:init()
    local sw, sh = Screen:getWidth(), Screen:getHeight()
    self.dimen = Geom:new{ x = 0, y = 0, w = sw, h = sh }
    self.ges_events = {
        CyTapOut = { GestureRange:new{ ges = "tap", range = self.dimen } },
    }
    local w = math.min(sw - s(40), s(480))
    local pad = s(18)
    local inner = w - 2 * pad
    local cols = self.cols or 2
    local gap = s(10)
    local cw = math.floor((inner - (cols - 1) * gap) / cols)
    local items = {}
    table.insert(items, U.text{ text = self.title, kind = "display", size = 18, color = "fg", upper = true, tracked = true,
        max_width = inner })
    table.insert(items, U.vspace(s(12)))
    local row
    for i, ch in ipairs(self.choices) do
        if (i - 1) % cols == 0 then
            if row then table.insert(items, row); table.insert(items, U.vspace(gap)) end
            row = HorizontalGroup:new{ align = "top" }
        else
            table.insert(row, U.hspace(gap))
        end
        local on = ch.on or ch.key == self.selected
        table.insert(row, U.button{
            text = ch.text, sub = ch.sub, icon = on and "check" or nil, kind = on and "accent" or "panel",
            width = cw, height = s(44), cuts = { tr = s(8) }, size = 13, align = "left",
            callback = function()
                self:close()
                if self.on_select then self.on_select(ch.key) end
            end,
        })
    end
    if row then table.insert(items, row) end
    table.insert(items, U.vspace(s(12)))
    local close_h = s(44)
    table.insert(items, W.Tap:new{
        callback = function() self:close() end,
        Box:new{
            width = inner, height = close_h, align = "center",
            U.text{ text = "Close", kind = "display", size = 14, color = "fg", upper = true, tracked = true },
        },
    })
    -- the brackets of CLOSE
    local close_box = items[#items][1]
    local orig = close_box.paintTo
    close_box.paintTo = function(b, bb, x, y)
        orig(b, bb, x, y)
        local t = math.max(2, s(1.5))
        local arm = s(10)
        local c = Pal.c("fg")
        Pal.fill(bb, x, y, t, close_h, c); Pal.fill(bb, x, y, arm, t, c); Pal.fill(bb, x, y + close_h - t, arm, t, c)
        local x2 = x + inner - t
        Pal.fill(bb, x2, y, t, close_h, c); Pal.fill(bb, x2 - arm + t, y, arm, t, c); Pal.fill(bb, x2 - arm + t, y + close_h - t, arm, t, c)
    end
    local content = U.column(items, 0)
    self.panel = Box:new{
        width = w, padding = pad, line = "fg", t = math.max(2, s(2)), fill = "bg",
        cuts = { tl = s(14), br = s(14) }, shadow = "fg", shadow_offset = s(8), valign = "top",
        content,
    }
    local ps = self.panel:getSize()
    self.panel_rect = Geom:new{
        x = math.floor((sw - ps.w) / 2), y = math.floor((sh - ps.h) / 2),
        w = ps.w + s(8), h = ps.h + s(8),
    }
    self[1] = Layers:new{ width = sw, height = sh, { self.panel, x = self.panel_rect.x, y = self.panel_rect.y } }
end

function Popup:onCyTapOut(_, ges)
    if ges.pos and not ges.pos:intersectWith(self.panel_rect) then self:close() end
    return true
end

function Popup:close()
    if self._closed then return end
    self._closed = true
    UIManager:close(self, "ui", self.panel_rect)
end

function Popup:onClose()
    self:close()
    return true
end

function U.popup(args)
    local p = Popup:new(args)
    UIManager:show(p, "ui", p.panel_rect)
    return p
end

return U
