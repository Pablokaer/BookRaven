--[[--
Small drawing pieces shared by the library home and the catalog: tappable areas, progress bars,
covers with a shadow (or HUD brackets), section labels, shelf tiles and their engraved art.

Three looks: "engraved" (BookRaven theme, and KOReader's original look), "hud" (Cyberdeck) and
"classic" (Classic e-reader: hairlines, square corners, no shadows or ornaments).
Text goes through Theme.face, so the reader's text settings (size, bold, font) apply everywhere.
]]

local Blitbuffer = require("ffi/blitbuffer")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local IconWidget = require("ui/widget/iconwidget")
local ImageWidget = require("ui/widget/imagewidget")
local InputContainer = require("ui/widget/container/inputcontainer")
local LeftContainer = require("ui/widget/container/leftcontainer")
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local Widget = require("ui/widget/widget")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
local Screen = require("device").screen

local Theme = require("br_theme")

local W = {}

local function s(n) return Screen:scaleBySize(n) end
W.s = s

W.INK = Blitbuffer.COLOR_BLACK
W.PAPER = Blitbuffer.COLOR_WHITE
W.MUTED = Blitbuffer.COLOR_DARK_GRAY
W.SOFT = Blitbuffer.Color8(0x30) -- secondary text on the home and tiles: dark enough to read on e-ink
W.RULE = Blitbuffer.Color8(0xC8)
W.SHADOW = Blitbuffer.Color8(0xA8)
W.TRACK = Blitbuffer.Color8(0xDD)

--- The look in effect: "engraved", "hud" or "classic".
function W.style()
    local theme = Theme.current()
    return theme and theme.style or "engraved"
end

-- What each font role is, for the font family and bold settings.
local KIND = { display = "bold", label = "bold", strong = "strong", text = "regular", italic = "italic", mono = "mono" }

--- Fonts for the home and the catalog tiles, by role, for the look in effect.
function W.fonts()
    local theme = Theme.current()
    local f = theme and theme.home or {
        display = "tfont", text = "cfont", strong = "smallinfofontbold", label = "smallinfofontbold",
        mono = "ffont", italic = "cfont",
    }
    return {
        get = function(role, size) return Theme.face(f[role] or f.text, size, KIND[role] or "regular") end,
    }
end

--- One of the plugin's own icons (sun, moon, quick settings…): the theme's version if it has
--- one, else the shared one in icons/common.
function W.icon(name)
    local theme = Theme.current()
    local dir = Theme.plugin_dir or "."
    if theme then
        local own = string.format("%s/%s/%s.svg", dir, theme.icons, name)
        if lfs.attributes(own, "mode") == "file" then return own end
    end
    return string.format("%s/icons/common/%s.svg", dir, name)
end

--- A tappable icon of ours: size is the icon's, pad the room around it (part of the tap zone).
function W.iconTap(name, size, pad, callback, hold_callback)
    pad = pad or 0
    return W.Tap:new{
        callback = callback,
        hold_callback = hold_callback,
        FrameContainer:new{
            padding = pad, margin = 0, bordersize = 0,
            IconWidget:new{ file = W.icon(name), width = size, height = size, alpha = true },
        },
    }
end

--- Paints its child, then inverts it (a selected chip, a switched-on toggle).
local Invert = WidgetContainer:extend{ on = true }
W.Invert = Invert

function Invert:paintTo(bb, x, y)
    local size = self[1]:getSize()
    self.dimen = Geom:new{ x = x, y = y, w = size.w, h = size.h }
    self[1]:paintTo(bb, x, y)
    if self.on then bb:invertRect(x, y, size.w, size.h) end
end

--- Uppercase with hair spaces between letters: small tracked capitals for labels.
function W.tracked(text)
    local ok, up = pcall(require("ffi/utf8proc").uppercase_dumb, text)
    up = ok and up or text
    local out = {}
    for _, ch in ipairs(require("util").splitToChars(up)) do
        table.insert(out, ch == " " and "\u{2002}" or ch)
    end
    return table.concat(out, "\u{200A}")
end

function W.upper(text)
    local ok, up = pcall(require("ffi/utf8proc").uppercase_dumb, text or "")
    return ok and up or text
end

--- Anything tappable. callback(), hold_callback() optional.
local Tap = InputContainer:extend{ callback = nil, hold_callback = nil }
W.Tap = Tap

function Tap:init()
    local size = self[1]:getSize()
    self.dimen = Geom:new{ x = 0, y = 0, w = size.w, h = size.h }
    self.ges_events = {
        BrTap = { GestureRange:new{ ges = "tap", range = function() return self.dimen end } },
        BrHold = { GestureRange:new{ ges = "hold", range = function() return self.dimen end } },
    }
end

function Tap:onBrTap()
    if self.callback then self.callback() end
    return true
end

function Tap:onBrHold()
    if self.hold_callback then
        self.hold_callback()
        return true
    end
end

--- A widget drawn by a function: paint(bb, x, y, w, h).
local Painter = Widget:extend{ width = 0, height = 0, paint = nil }
W.Painter = Painter

function Painter:getSize()
    return Geom:new{ w = self.width, h = self.height }
end

function Painter:paintTo(bb, x, y)
    self.dimen = Geom:new{ x = x, y = y, w = self.width, h = self.height }
    if self.paint then self.paint(bb, x, y, self.width, self.height) end
end

--- Reading progress: a rounded track (engraved) or a row of blocks (hud).
function W.progress(width, pct, style)
    pct = math.max(0, math.min(1, pct or 0))
    if style == "hud" then
        local h = s(6)
        return Painter:new{
            width = width, height = h,
            paint = function(bb, x, y, w)
                local n = 20
                local gap = math.max(2, s(1.5))
                local cell = math.floor((w - (n - 1) * gap) / n)
                local filled = math.floor(pct * n + 0.5)
                for i = 0, n - 1 do
                    local cx = x + i * (cell + gap)
                    if i < filled then
                        bb:paintRect(cx, y, cell, h, W.INK)
                    else
                        bb:paintBorder(cx, y, cell, h, 1, Blitbuffer.COLOR_GRAY_7)
                    end
                end
            end,
        }
    end
    if style == "classic" then -- a plain bar on a light track
        local th = s(3)
        return Painter:new{
            width = width, height = th + s(4),
            paint = function(bb, x, y, w)
                bb:paintRect(x, y + s(2), w, th, W.TRACK)
                if pct > 0 then bb:paintRect(x, y + s(2), math.max(th, math.floor(w * pct)), th, W.INK) end
            end,
        }
    end
    local h = s(3.5)
    return Painter:new{
        width = width, height = h + s(4),
        paint = function(bb, x, y, w)
            local ty = y + s(2)
            bb:paintRoundedRect(x, ty, w, h, W.TRACK, math.floor(h / 2))
            local fw = math.max(h, math.floor(w * pct))
            if pct > 0 then
                bb:paintRoundedRect(x, ty, fw, h, W.INK, math.floor(h / 2))
                -- a small diamond marks where you are
                local d = s(3.5)
                local cx, cy = x + fw, ty + math.floor(h / 2)
                for i = 0, d do
                    bb:paintRect(cx - (d - i), cy - i, 2 * (d - i) + 1, 1, W.INK)
                    bb:paintRect(cx - (d - i), cy + i, 2 * (d - i) + 1, 1, W.INK)
                end
            end
        end,
    }
end

--- Wraps a cover: soft shadow (engraved), corner brackets (hud) or nothing (classic).
local Mount = WidgetContainer:extend{ look = "engraved", pad = 0 }
W.Mount = Mount

function Mount:init()
    self.pad = (self.look == "hud" and s(4)) or (self.look == "classic" and 0) or s(3)
end

function Mount:getSize()
    local size = self[1]:getSize()
    if self.look == "classic" then
        return size
    end
    if self.look == "hud" then
        return Geom:new{ w = size.w + 2 * self.pad, h = size.h + 2 * self.pad }
    end
    return Geom:new{ w = size.w + self.pad, h = size.h + self.pad }
end

function Mount:paintTo(bb, x, y)
    local size = self:getSize()
    self.dimen = Geom:new{ x = x, y = y, w = size.w, h = size.h }
    local inner = self[1]:getSize()
    if self.look == "classic" then
        self[1]:paintTo(bb, x, y)
    elseif self.look == "hud" then
        self[1]:paintTo(bb, x + self.pad, y + self.pad)
        W.brackets(bb, x, y, size.w, size.h)
    else
        local p = self.pad
        bb:paintRect(x + inner.w, y + p, p, inner.h, W.SHADOW)
        bb:paintRect(x + p, y + inner.h, inner.w, p, W.SHADOW)
        self[1]:paintTo(bb, x, y)
    end
end

--- HUD corner brackets around a box.
function W.brackets(bb, x, y, w, h, thick)
    local len = math.floor(math.min(w, h) * 0.16)
    local t = thick or Size.border.thick
    local x2, y2 = x + w, y + h
    bb:paintRect(x, y, len, t, W.INK);            bb:paintRect(x, y, t, len, W.INK)
    bb:paintRect(x2 - len, y, len, t, W.INK);     bb:paintRect(x2 - t, y, t, len, W.INK)
    bb:paintRect(x, y2 - t, len, t, W.INK);       bb:paintRect(x, y2 - len, t, len, W.INK)
    bb:paintRect(x2 - len, y2 - t, len, t, W.INK); bb:paintRect(x2 - t, y2 - len, t, len, W.INK)
end

--- A HUD panel: thick outline with the top-right corner cut at 45°, and a small index tab.
local HudPanel = WidgetContainer:extend{ width = nil, height = nil, padding = nil, tag = nil }
W.HudPanel = HudPanel

function HudPanel:getSize()
    return Geom:new{ w = self.width, h = self.height }
end

function HudPanel:paintTo(bb, x, y)
    self.dimen = Geom:new{ x = x, y = y, w = self.width, h = self.height }
    local w, h = self.width, self.height
    local t = Size.border.thick
    local cut = s(12)
    bb:paintRect(x, y, w - cut, t, W.INK)          -- top
    bb:paintRect(x, y + h - t, w, t, W.INK)        -- bottom
    bb:paintRect(x, y, t, h, W.INK)                -- left
    bb:paintRect(x + w - t, y + cut, t, h - cut, W.INK) -- right
    for i = 0, cut do                              -- the cut, 45°
        bb:paintRect(x + w - cut + i - t, y + i, t + 1, 1, W.INK)
    end
    -- three ticks on the bottom edge
    for i = 0, 2 do
        bb:paintRect(x + s(8) + i * s(6), y + h - t - s(4), s(3), s(4), W.INK)
    end
    local p = self.padding or s(8)
    self[1]:paintTo(bb, x + p, y + p)
    if self.tag then
        local ts = self.tag:getSize()
        bb:paintRect(x + w - cut - ts.w - s(10), y, ts.w + s(8), ts.h + s(2), W.INK)
        self.tag:paintTo(bb, x + w - cut - ts.w - s(6), y + s(1))
    end
end

--- A rounded card with a hairline border (engraved), exactly width x height (height: content's
--- when nil). The content sits on the left, centred vertically.
function W.card(widget, width, height, padding)
    padding = padding or s(10)
    local b = Size.border.thin
    local inner_w = width - 2 * padding - 2 * b
    local inner_h = height and (height - 2 * padding - 2 * b) or widget:getSize().h
    return FrameContainer:new{
        padding = padding,
        margin = 0,
        bordersize = b,
        color = W.RULE,
        radius = W.style() ~= "classic" and s(9) or nil,
        background = W.PAPER,
        LeftContainer:new{ dimen = Geom:new{ w = inner_w, h = inner_h }, widget },
    }
end

--- A small pill button for section headings: "+ Add shelf".
function W.pillButton(text, style, callback)
    local f = W.fonts()
    local hud = style == "hud"
    local tw = TextWidget:new{
        text = hud and W.upper(text) or text,
        face = f.get(hud and "mono" or (style == "classic" and "label" or "strong"), hud and 13 or 14),
        bold = hud or nil,
        fgcolor = hud and W.PAPER or W.INK,
    }
    local th = tw:getSize().h
    local plus = Painter:new{
        width = th, height = th,
        paint = function(bb, x, y, w, h)
            local t = math.max(2, s(1.6))
            local arm = math.floor(w * 0.32)
            local cx, cy = x + math.floor(w / 2), y + math.floor(h / 2)
            local c = hud and W.PAPER or W.INK
            bb:paintRect(cx - arm, cy - math.floor(t / 2), 2 * arm, t, c)
            bb:paintRect(cx - math.floor(t / 2), cy - arm, t, 2 * arm, c)
        end,
    }
    local frame = FrameContainer:new{
        padding = s(5),
        padding_left = s(8),
        padding_right = s(10),
        margin = 0,
        bordersize = hud and 0 or Size.border.thin,
        color = W.INK,
        radius = (hud or style == "classic") and 0 or math.floor((th + s(10)) / 2),
        background = hud and W.INK or W.PAPER,
        HorizontalGroup:new{ align = "center", plus, HorizontalSpan:new{ width = s(4) }, tw },
    }
    return Tap:new{ callback = callback, frame }
end

--- Section heading: tracked capitals and a rule that ends in a diamond (engraved),
--- "> NAME_" with ticks (hud), or plain bold text (classic). With action = { text, callback },
--- the heading ends in a button.
function W.label(text, width, style, action)
    local f = W.fonts()
    local tw
    if style == "classic" then
        tw = TextWidget:new{ text = text, face = f.get("label", 16) }
    elseif style == "hud" then
        tw = TextWidget:new{
            text = "> " .. W.upper(text):gsub(" ", "_"),
            face = f.get("mono", 14),
            bold = true,
        }
    else
        tw = TextWidget:new{
            text = W.tracked(text),
            face = f.get("label", 12),
            fgcolor = W.SOFT,
        }
    end
    local tsz = tw:getSize()
    local gap = s(10)
    local button = action and W.pillButton(action.text, style, action.callback)
    local button_w = button and (button:getSize().w + gap) or 0
    local rule_w = math.max(0, width - tsz.w - gap - button_w)
    local rule = Painter:new{
        width = rule_w, height = tsz.h,
        paint = function(bb, x, y, w, h)
            local cy = y + math.floor(h / 2)
            if style == "classic" then
                return -- no rule: the button sits on the right
            elseif button then
                bb:paintRect(x, cy, w, 1, style == "hud" and W.INK or W.RULE)
            elseif style == "hud" then
                bb:paintRect(x, cy, w - s(26), 1, W.INK)
                for i = 0, 2 do
                    bb:paintRect(x + w - s(20) + i * s(7), cy - s(3), s(3), s(7), W.INK)
                end
            else
                local d = s(3)
                bb:paintRect(x, cy, w - 3 * d, 1, W.RULE)
                local cx = x + w - d - 1
                for i = 0, d do
                    bb:paintRect(cx - (d - i), cy - i, 2 * (d - i) + 1, 1, W.MUTED)
                    bb:paintRect(cx - (d - i), cy + i, 2 * (d - i) + 1, 1, W.MUTED)
                end
            end
        end,
    }
    local group = HorizontalGroup:new{ align = "center", tw, HorizontalSpan:new{ width = gap }, rule }
    if button then
        table.insert(group, HorizontalSpan:new{ width = gap })
        table.insert(group, button)
    end
    return group
end

--- Which engraving goes with a shelf: by name, else a stable pick from the rest.
local ART_BY_WORD = {
    { "public", "public" }, { "shared", "public" }, { "everyone", "public" },
    { "recent", "recent" }, { "new", "recent" }, { "added", "recent" }, { "latest", "recent" },
    { "gothic", "shadow" }, { "horror", "shadow" }, { "dark", "shadow" }, { "mystery", "shadow" },
    { "collection", "collection" }, { "series", "collection" }, { "shelf", "collection" },
    { "favo", "flight" }, { "wish", "window" }, { "read", "recent" },
    { "librar", "library" }, { "all", "library" }, { "books", "library" },
}
local ART_REST = { "flight", "window", "collection", "shadow", "public", "library", "recent" }

--- `used` (optional) is a table of engravings already on the page: the shelf then gets one
--- that is not, while there are some left.
function W.shelfArt(plugin_dir, title, index, used)
    local t = (title or ""):lower()
    local key
    for _, pair in ipairs(ART_BY_WORD) do
        if t:find(pair[1], 1, true) then key = pair[2]; break end
    end
    local h = 0
    for i = 1, #t do h = (h * 31 + t:byte(i)) % 997 end
    if not key then
        key = ART_REST[(h + (index or 0)) % #ART_REST + 1]
    end
    if used then
        if used[key] then
            for i = 0, #ART_REST - 1 do
                local candidate = ART_REST[(h + i) % #ART_REST + 1]
                if not used[candidate] then key = candidate; break end
            end
        end
        used[key] = true
    end
    local theme = Theme.current()
    local dir = theme and theme.art or "art/bookraven"
    return string.format("%s/%s/shelf-%s.png", plugin_dir, dir, key)
end

--- The art of the "add a shelf" tile: a ring (engraved) or brackets (hud) around a plus.
function W.plusArt(size, style)
    return Painter:new{
        width = size, height = size,
        paint = function(bb, x, y, w, h)
            local cx, cy = x + math.floor(w / 2), y + math.floor(h / 2)
            local t = math.max(2, s(1.8))
            local arm = math.floor(w * 0.2)
            if style == "hud" then
                W.brackets(bb, x + math.floor(w * 0.1), y + math.floor(h * 0.1), math.floor(w * 0.8), math.floor(h * 0.8))
            elseif style == "classic" then
                bb:paintBorder(x + math.floor(w * 0.12), y + math.floor(h * 0.12), math.floor(w * 0.76), math.floor(h * 0.76), 1, W.MUTED)
            else
                bb:paintCircle(cx, cy, math.floor(w * 0.45), W.INK, math.max(2, s(1.2)))
                bb:paintCircle(cx, cy, math.floor(w * 0.39), W.RULE, math.max(1, s(0.6)))
            end
            bb:paintRect(cx - arm, cy - math.floor(t / 2), 2 * arm, t, W.INK)
            bb:paintRect(cx - math.floor(t / 2), cy - arm, t, 2 * arm, W.INK)
        end,
    }
end

--- The art of a shelf in the classic look, instead of an engraving: three covers, fanned like a
--- stack on a shelf, the front one with two title lines.
function W.stackArt(size)
    return Painter:new{
        width = size, height = size,
        paint = function(bb, x, y, w, h)
            local bw, bh = math.floor(w * 0.5), math.floor(h * 0.68)
            local step = math.floor(w * 0.11)
            local top = y + math.floor((h - bh - 2 * step) / 2)
            local left = x + math.floor((w - bw - 2 * step) / 2)
            for i = 2, 0, -1 do
                local bx, by = left + i * step, top + (2 - i) * step
                bb:paintRect(bx, by, bw, bh, W.PAPER)
                bb:paintBorder(bx, by, bw, bh, math.max(1, s(1)), i == 0 and W.INK or W.MUTED)
            end
            local bx, by = left, top + 2 * step
            local m = math.floor(bw * 0.18)
            bb:paintRect(bx + m, by + math.floor(bh * 0.25), bw - 2 * m, math.max(1, s(1.5)), W.INK)
            bb:paintRect(bx + m, by + math.floor(bh * 0.36), math.floor((bw - 2 * m) * 0.65), math.max(1, s(1)), W.MUTED)
        end,
    }
end

--- A shelf tile: engraving + name + note.
--- args: title, note, width, height, art (file) or plus = true, callback, hold_callback, style, index
function W.shelfTile(args)
    local f = W.fonts()
    local style = args.style
    local hud = style == "hud"
    local pad = s(8)
    local inner_h = args.height - 2 * pad - 2 * Size.border.thin
    local art_size = inner_h
    local text_w = args.width - 2 * pad - art_size - s(12) - 2 * Size.border.thin
    local title = hud and W.upper(args.title) or args.title
    local texts = VerticalGroup:new{ align = "left" }
    table.insert(texts, TextBoxWidget:new{
        text = title,
        face = f.get("display", hud and 17 or 19),
        width = text_w,
        height = math.floor(inner_h * 0.6),
        height_adjust = true,
        height_overflow_show_ellipsis = true,
    })
    if args.note and args.note ~= "" then
        table.insert(texts, VerticalSpan:new{ width = s(2) })
        table.insert(texts, TextBoxWidget:new{
            text = hud and ("// " .. args.note) or args.note,
            face = f.get(hud and "mono" or "strong", hud and 12 or 13),
            bold = hud or nil,
            fgcolor = W.SOFT,
            width = text_w,
            height = math.floor(inner_h * 0.4),
            height_adjust = true,
            height_overflow_show_ellipsis = true,
        })
    end
    local art
    if args.plus or not args.art then
        art = W.plusArt(art_size, style)
    elseif style == "classic" then
        art = W.stackArt(art_size)
    else
        art = ImageWidget:new{ file = args.art, width = art_size, height = art_size, alpha = false }
    end
    local row = HorizontalGroup:new{
        align = "center",
        art,
        HorizontalSpan:new{ width = s(12) },
        texts,
    }
    local box
    if hud then
        local tag = args.index and TextWidget:new{
            text = args.plus and "+" or string.format("%02d", args.index),
            face = f.get("mono", 10),
            bold = true,
            fgcolor = W.PAPER,
        }
        box = HudPanel:new{ width = args.width, height = args.height, padding = pad, tag = tag, row }
    else
        box = W.card(row, args.width, args.height, pad)
    end
    return Tap:new{ callback = args.callback, hold_callback = args.hold_callback, box }
end

--- A message tile, for empty states (no account yet, offline, nothing read).
function W.noteTile(args)
    local f = W.fonts()
    local style = args.style
    local pad = s(12)
    local inner_w = args.width - 2 * pad - 2 * Size.border.thin
    local group = VerticalGroup:new{ align = "left" }
    table.insert(group, TextWidget:new{
        text = style == "hud" and W.upper(args.title) or args.title,
        face = f.get("display", style == "hud" and 18 or 21),
        max_width = inner_w,
    })
    table.insert(group, VerticalSpan:new{ width = s(4) })
    table.insert(group, TextBoxWidget:new{
        text = args.text,
        face = f.get(style == "hud" and "mono" or "strong", style == "hud" and 12 or 14),
        bold = style == "hud" or nil,
        fgcolor = W.SOFT,
        width = inner_w,
    })
    local box
    if style == "hud" then
        local h = group:getSize().h + 2 * pad
        box = HudPanel:new{ width = args.width, height = math.max(args.height or 0, h), padding = pad, group }
    else
        box = W.card(group, args.width, args.height, pad)
    end
    return Tap:new{ callback = args.callback, box }
end

return W
