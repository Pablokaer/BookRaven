--[[--
ASCII covers for CyberUI (System → Covers → Style: ASCII).

A cover is cut into cells; each cell's brightness picks a character and its colour tints it (on
a colour screen; on e-ink a grey). In dark mode bright parts of the cover are drawn, in light
mode dark ones, so the picture reads on either page. Characters (cyber_ascii):

  classic   " .:-=+*#%@"            detailed  a 70-step ramp
  braille   2 x 4 dots per cell     blocks    shaded blocks
  binary    0 and 1                 hex       a hex dump
  glitch    classic, with shifted rows and noise
  title     the book's title, over and over

Density (cyber_ascii_size): fine, medium or coarse cells. Rendered covers are kept in memory
(the last 48), so turning pages back and forth stays quick; a change of colours draws them anew.
]]

local Blitbuffer = require("ffi/blitbuffer")
local Font = require("ui/font")
local Geom = require("ui/geometry")
local RenderImage = require("ui/renderimage")
local RenderText = require("ui/rendertext")
local Widget = require("ui/widget/widget")
local logger = require("logger")
local Screen = require("device").screen

local Pal = require("cy_palette")
local Settings = require("br_settings")

local A = {}

A.STYLES = {
    { key = "classic", text = "Classic" }, { key = "detailed", text = "Detailed" },
    { key = "braille", text = "Braille" }, { key = "blocks", text = "Blocks" },
    { key = "binary", text = "Binary" }, { key = "hex", text = "Hex dump" },
    { key = "glitch", text = "Glitch" }, { key = "title", text = "Book title" },
}
A.DENSITY = { fine = 4, medium = 6, coarse = 9 }

local RAMP = " .:-=+*#%@"
local DETAILED = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"
local HEX = "0123456789ABCDEF"

local cache, order = {}, {}
local MAX = 48

local function remember(key, bb)
    cache[key] = bb
    table.insert(order, key)
    while #order > MAX do
        local old = table.remove(order, 1)
        if cache[old] then cache[old]:free(); cache[old] = nil end
    end
end

function A.clear()
    for _, bb in pairs(cache) do bb:free() end
    cache, order = {}, {}
end

function A.style() return Settings.get("cyber_ascii") or "braille" end

--- The cover's colour at (x, y): r, g, b in 0..255.
local function rgbAt(src, x, y)
    local c = src:getPixel(x, y)
    if Blitbuffer.isColor8(c) then return c.a, c.a, c.a end
    local ok, rgb = pcall(c.getColorRGB32, c)
    if ok and rgb then return rgb.r, rgb.g, rgb.b end
    local ok8, g = pcall(function() return c:getColor8().a end)
    g = ok8 and g or 0
    return g, g, g
end

--- Average colour of a box of the source (a few samples).
local function sample(src, sx, sy, sw, sh)
    local r, g, b, n = 0, 0, 0, 0
    local W, H = src:getWidth(), src:getHeight()
    for i = 0, 1 do
        for j = 0, 1 do
            local px = math.min(W - 1, math.max(0, math.floor(sx + sw * (0.25 + 0.5 * i))))
            local py = math.min(H - 1, math.max(0, math.floor(sy + sh * (0.25 + 0.5 * j))))
            local cr, cg, cb = rgbAt(src, px, py)
            r, g, b, n = r + cr, g + cg, b + cb, n + 1
        end
    end
    return r / n, g / n, b / n
end

local function luma(r, g, b) return (0.299 * r + 0.587 * g + 0.114 * b) / 255 end

--- The ink of a cell: its colour, kept bright on a dark page and dark on a light one.
local function inkOf(r, g, b, t, dark, colour)
    if colour then
        local m = math.max(r, g, b, 1)
        if dark then
            local k = (110 + 145 * t) / m
            return Blitbuffer.ColorRGB32(math.min(255, r * k), math.min(255, g * k), math.min(255, b * k), 0xFF)
        end
        local k = math.min(1, (40 + 120 * (1 - t)) / m)
        return Blitbuffer.ColorRGB32(r * k, g * k, b * k, 0xFF)
    end
    if dark then return Pal.grey(0x58 + 0xA7 * t) end
    return Pal.grey(0xA0 * (1 - t))
end

local faces = {}
local function monoFace(size)
    if not faces[size] then faces[size] = Font:getFace("BookRavenMono-Regular.ttf", size) end
    return faces[size]
end

local function glyphChar(style, t, i, j, title_chars, rnd)
    if style == "binary" then
        if t < 0.12 then return nil end
        return t > 0.5 and "1" or "0"
    elseif style == "hex" then
        if t < 0.1 then return nil end
        return HEX:sub(math.floor(t * 15) + 1, math.floor(t * 15) + 1)
    elseif style == "detailed" then
        local k = math.floor(t * (#DETAILED - 1)) + 1
        local ch = DETAILED:sub(k, k)
        return ch ~= " " and ch or nil
    elseif style == "title" then
        if t < 0.22 or #title_chars == 0 then return nil end
        local k = (j * 7 + i) % #title_chars + 1
        return title_chars[k]
    elseif style == "glitch" then
        if rnd() < 0.04 then return ({ "#", "%", "/", "\\", "_", "=" })[math.floor(rnd() * 6) + 1] end
    end
    local k = math.floor(t * (#RAMP - 1)) + 1
    local ch = RAMP:sub(k, k)
    return ch ~= " " and ch or nil
end

--- Draws the cover at path as characters into a new w x h blitbuffer.
local function render(path, w, h, style, density, title)
    local src = RenderImage:renderImageFile(path, false)
    if not src then return nil end
    local colour = Pal.colour()
    local dark = Pal.isDark()
    local bb = Blitbuffer.new(w, h, colour and Blitbuffer.TYPE_BBRGB32 or Blitbuffer.TYPE_BB8)
    local bg = Pal.c("bg")
    if Blitbuffer.isColor8(bg) then bb:fill(bg) else bb:paintRectRGB32(0, 0, w, h, bg) end
    -- fill the box with the cover, cropping what overflows
    local W, H = src:getWidth(), src:getHeight()
    local scale = math.max(w / W, h / H)
    local ox, oy = (W - w / scale) / 2, (H - h / scale) / 2
    local function at(x, y) return ox + x / scale, oy + y / scale end
    -- the cover's own range of brightness, stretched to 0..1, so flat covers still show their shapes
    local lo, hi = 1, 0
    for gy = 0, 23 do
        for gx = 0, 15 do
            local l = luma(rgbAt(src, math.floor(gx * (W - 1) / 15), math.floor(gy * (H - 1) / 23)))
            if l < lo then lo = l end
            if l > hi then hi = l end
        end
    end
    local span = hi - lo
    local function luma(r, g, b)
        local l = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        if span < 0.12 then return l end
        return math.max(0, math.min(1, (l - lo) / span))
    end

    local cell = Screen:scaleBySize(A.DENSITY[density] or A.DENSITY.medium)
    local seed = 0
    for k = 1, #path do seed = (seed * 31 + path:byte(k)) % 2147483647 end
    local function rnd()
        seed = (seed * 1103515245 + 12345) % 2147483648
        return seed / 2147483648
    end

    if style == "braille" or style == "blocks" then
        local cw, ch = cell, math.floor(cell * (style == "braille" and 2 or 1) + 0.5)
        local cols, rows = math.floor(w / cw), math.floor(h / ch)
        local mx, my = math.floor((w - cols * cw) / 2), math.floor((h - rows * ch) / 2)
        for j = 0, rows - 1 do
            for i = 0, cols - 1 do
                local x, y = mx + i * cw, my + j * ch
                if style == "blocks" then
                    local sx, sy = at(x, y)
                    local r, g, b = sample(src, sx, sy, cw / scale, ch / scale)
                    local t = luma(r, g, b)
                    if not dark then t = 1 - t end
                    local level = math.floor(t * 4 + 0.5) / 4
                    if level > 0 then
                        local pad = math.floor((1 - level) * cw * 0.35)
                        local c = inkOf(r, g, b, level, dark, colour)
                        if colour then
                            bb:paintRectRGB32(x + pad, y + pad, cw - 2 * pad - 1, ch - 2 * pad - 1, c)
                        else
                            bb:paintRect(x + pad, y + pad, cw - 2 * pad - 1, ch - 2 * pad - 1, c)
                        end
                    end
                else
                    -- 2 x 4 dots, each lit when its part of the cover is bright (dark, in light mode)
                    local dw, dh = cw / 2, ch / 4
                    local dot = math.max(1, math.floor(cw / 3.2))
                    for di = 0, 1 do
                        for dj = 0, 3 do
                            local sx, sy = at(x + di * dw, y + dj * dh)
                            local r, g, b = sample(src, sx, sy, dw / scale, dh / scale)
                            local t = luma(r, g, b)
                            if not dark then t = 1 - t end
                            if t > 0.22 then
                                local c = inkOf(r, g, b, t, dark, colour)
                                local px = x + math.floor(di * dw + (dw - dot) / 2)
                                local py = y + math.floor(dj * dh + (dh - dot) / 2)
                                if colour then bb:paintRectRGB32(px, py, dot, dot, c) else bb:paintRect(px, py, dot, dot, c) end
                            end
                        end
                    end
                end
            end
        end
    else
        local face = monoFace(math.max(5, math.floor((A.DENSITY[density] or 6) * 1.7 + 0.5)))
        local probe = RenderText:getGlyph(face, string.byte("M"), false)
        local cw = math.max(2, probe.ax)
        local ch = math.max(3, math.floor(face.size * 1.08 + 0.5))
        local base = math.floor(ch * 0.8)
        local cols, rows = math.floor(w / cw), math.floor(h / ch)
        local mx, my = math.floor((w - cols * cw) / 2), math.floor((h - rows * ch) / 2)
        local title_chars = {}
        for c in (title or ""):upper():gmatch("[%w]") do table.insert(title_chars, c) end
        for j = 0, rows - 1 do
            local shift = 0
            if style == "glitch" and rnd() < 0.14 then shift = math.floor((rnd() - 0.5) * 6) * cw end
            for i = 0, cols - 1 do
                local x, y = mx + i * cw, my + j * ch
                local sx, sy = at(x, y)
                local r, g, b = sample(src, sx, sy, cw / scale, ch / scale)
                local t = luma(r, g, b)
                if not dark then t = 1 - t end
                local char = glyphChar(style, t, i, j, title_chars, rnd)
                if char then
                    local glyph = RenderText:getGlyph(face, string.byte(char), false)
                    local c = inkOf(r, g, b, t, dark, colour)
                    local gx, gy = x + shift + glyph.l, y + base - glyph.t
                    if gx >= 0 and gx + glyph.bb:getWidth() <= w then
                        if colour then
                            bb:colorblitFromRGB32(glyph.bb, gx, gy, 0, 0, glyph.bb:getWidth(), glyph.bb:getHeight(), c)
                        else
                            bb:colorblitFrom(glyph.bb, gx, gy, 0, 0, glyph.bb:getWidth(), glyph.bb:getHeight(), c)
                        end
                    end
                end
            end
        end
    end
    src:free()
    return bb
end

--- The ASCII cover of path at w x h (a blitbuffer kept in the cache; do not free it).
function A.get(path, w, h, title)
    local style = A.style()
    local density = Settings.get("cyber_ascii_size") or "medium"
    local key = table.concat({ path, w, h, style, density, Pal.key(), style == "title" and (title or "") or "" }, "|")
    if cache[key] then return cache[key] end
    local ok, bb = pcall(render, path, w, h, style, density, title)
    if not ok then
        logger.warn("CyberUI: ASCII cover failed", path, bb)
        return nil
    end
    if bb then remember(key, bb) end
    return bb
end

--- A widget showing a cover as characters (rendered when first painted).
local AsciiCover = Widget:extend{ width = nil, height = nil, path = nil, title = nil }
A.AsciiCover = AsciiCover

function AsciiCover:getSize() return Geom:new{ w = self.width, h = self.height } end

function AsciiCover:paintTo(bb, x, y)
    self.dimen = Geom:new{ x = x, y = y, w = self.width, h = self.height }
    local img = A.get(self.path, self.width, self.height, self.title)
    if img then bb:blitFrom(img, x, y, 0, 0, self.width, self.height) end
end

return A
