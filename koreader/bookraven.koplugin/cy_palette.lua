--[[--
CyberUI colours (the Cyberdeck theme's own screens): a colour scheme and a mode, light or dark.

Each scheme gives the colour of a few roles, for both modes:

  bg       the page
  fg       text, lines and selected blocks (cyan in Neon)
  accent   the call to action: active tab, Resume, tags (red in Neon)
  ink      text on an accent or fg block
  muted    secondary text (paths, dates, labels)
  panel    the fill of menu tiles and choices
  rule     dim separators and empty cells

On a colour screen (KOReader's colour rendering on, as on a Kindle Colorsoft) the colours are
used as they are. On a grey e-ink screen each role becomes a grey picked for contrast: in dark
mode the page is near black, text light grey and accents mid grey with black text; in light mode
the reverse. The schemes then differ only a little, in how bright each role is.

Settings: cyber_scheme (a key of SCHEMES) and cyber_mode ("dark" or "light").
]]

local Blitbuffer = require("ffi/blitbuffer")
local Screen = require("device").screen

local Settings = require("br_settings")

local Pal = {}

local function rgb(hex)
    return { r = math.floor(hex / 65536) % 256, g = math.floor(hex / 256) % 256, b = hex % 256 }
end

local function scheme(key, label, dark, light)
    local t = { key = key, label = label, dark = {}, light = {} }
    for role, hex in pairs(dark) do t.dark[role] = rgb(hex) end
    for role, hex in pairs(light) do t.light[role] = rgb(hex) end
    return t
end

Pal.SCHEMES = {
    scheme("mono", "MONO",
        { bg = 0x000000, fg = 0xFFFFFF, accent = 0xFFFFFF, ink = 0x000000, muted = 0xBDBDBD, panel = 0x1C1C1C, rule = 0x5A5A5A },
        { bg = 0xFFFFFF, fg = 0x000000, accent = 0x000000, ink = 0xFFFFFF, muted = 0x4A4A4A, panel = 0xECECEC, rule = 0xA8A8A8 }),
    scheme("graphite", "GRAPHITE",
        { bg = 0x101010, fg = 0xE6E6E6, accent = 0xB8B8B8, ink = 0x101010, muted = 0x9A9A9A, panel = 0x262626, rule = 0x4A4A4A },
        { bg = 0xF7F7F5, fg = 0x1E1E1E, accent = 0x6E6E6E, ink = 0xFFFFFF, muted = 0x5C5C5C, panel = 0xE6E6E3, rule = 0xB3B3B0 }),
    scheme("neon", "NEON",
        { bg = 0x1E1617, fg = 0x94E2EA, accent = 0xE05A4C, ink = 0x1E1617, muted = 0xC9A29E, panel = 0x3A2829, rule = 0x52393A },
        { bg = 0xFBF8F6, fg = 0x0B5A63, accent = 0xC63A2D, ink = 0xFFFFFF, muted = 0x7B5450, panel = 0xEFE4E2, rule = 0xC8B4B1 }),
    scheme("synthwave", "SYNTHWAVE",
        { bg = 0x140F1E, fg = 0xF2C6CC, accent = 0xEC4FA3, ink = 0x140F1E, muted = 0xD8777F, panel = 0x2E2140, rule = 0x4A3760 },
        { bg = 0xFCF7FA, fg = 0x4A1D4F, accent = 0xC22D7E, ink = 0xFFFFFF, muted = 0x8A4E66, panel = 0xF1E2EC, rule = 0xD2B6C8 }),
    scheme("bloodline", "BLOODLINE",
        { bg = 0x120A0A, fg = 0xEDD8D4, accent = 0xD1202F, ink = 0xFFFFFF, muted = 0xFF5A52, panel = 0x2C1414, rule = 0x4E2424 },
        { bg = 0xFCF8F7, fg = 0x3A0E10, accent = 0xB0121F, ink = 0xFFFFFF, muted = 0x8C3A38, panel = 0xF2E3E1, rule = 0xD5B5B2 }),
    scheme("terminal", "TERMINAL",
        { bg = 0x0C1410, fg = 0x84F0A8, accent = 0x84F0A8, ink = 0x0C1410, muted = 0x5FBF80, panel = 0x16271D, rule = 0x2C4A36 },
        { bg = 0xF6FBF7, fg = 0x0E4A26, accent = 0x1A7A40, ink = 0xFFFFFF, muted = 0x3E6E50, panel = 0xE2F0E6, rule = 0xB0CDB9 }),
    scheme("amber", "AMBER",
        { bg = 0x160F05, fg = 0xFFB347, accent = 0xFF6B35, ink = 0x160F05, muted = 0xC98A3A, panel = 0x2E2010, rule = 0x4D3519 },
        { bg = 0xFFFAF2, fg = 0x5A3200, accent = 0xC2410C, ink = 0xFFFFFF, muted = 0x8A5A20, panel = 0xF5E8D2, rule = 0xD9C29E }),
}

Pal.MODES = { "light", "dark" }

local by_key = {}
for _, sc in ipairs(Pal.SCHEMES) do by_key[sc.key] = sc end

function Pal.scheme()
    return by_key[Settings.get("cyber_scheme") or "neon"] or by_key.neon
end

--- "dark" or "light".
function Pal.mode()
    return Settings.get("cyber_mode") == "light" and "light" or "dark"
end

function Pal.isDark()
    return Pal.mode() == "dark"
end

function Pal.colour()
    local ok, on = pcall(Screen.isColorEnabled, Screen)
    return ok and on and true or false
end

local function luma(c)
    return math.floor(0.299 * c.r + 0.587 * c.g + 0.114 * c.b + 0.5)
end

local function clamp(v, lo, hi)
    return math.max(lo, math.min(hi, v))
end

-- The grey of each role on a grey screen, kept inside a band that reads well on e-ink.
local GREY = {
    dark = {
        bg = { 0x00, 0x1C }, fg = { 0xD8, 0xFF }, accent = { 0x78, 0xA0 }, muted = { 0x98, 0xBC },
        panel = { 0x26, 0x3C }, rule = { 0x44, 0x60 },
    },
    light = {
        bg = { 0xF4, 0xFF }, fg = { 0x00, 0x24 }, accent = { 0x60, 0x80 }, muted = { 0x44, 0x66 },
        panel = { 0xE2, 0xEC }, rule = { 0xA4, 0xC0 },
    },
}

local cache = {}

local function compute(role)
    local sc, mode = Pal.scheme(), Pal.mode()
    local c = sc[mode][role] or sc[mode].fg
    if Pal.colour() then
        return Blitbuffer.ColorRGB32(c.r, c.g, c.b, 0xFF), string.format("#%02X%02X%02X", c.r, c.g, c.b)
    end
    local g
    if role == "ink" then
        -- black or white, whichever reads on the accent's grey
        local accent = compute("accent")
        g = accent.a and (accent.a >= 0x80 and 0x00 or 0xFF) or 0x00
    else
        local band = GREY[mode][role] or GREY[mode].fg
        g = clamp(luma(c), band[1], band[2])
    end
    return Blitbuffer.Color8(g), string.format("#%02X%02X%02X", g, g, g)
end

--- The colour of a role (a Blitbuffer colour: RGB on a colour screen, grey otherwise).
function Pal.c(role)
    local key = Pal.scheme().key .. Pal.mode() .. tostring(Pal.colour()) .. role
    local hit = cache[key]
    if not hit then
        local c, hex = compute(role)
        hit = { c = c, hex = hex }
        cache[key] = hit
    end
    return hit.c
end

--- The same colour as "#RRGGBB", for tinting SVG icons.
function Pal.hex(role)
    Pal.c(role)
    return cache[Pal.scheme().key .. Pal.mode() .. tostring(Pal.colour()) .. role].hex
end

--- The swatches of a scheme in the current mode, for the scheme picker: bg, fg, accent, muted.
function Pal.swatches(sc)
    local t = sc[Pal.mode()]
    local out = {}
    for _, role in ipairs({ "bg", "fg", "accent", "muted" }) do
        local c = t[role]
        if Pal.colour() then
            table.insert(out, Blitbuffer.ColorRGB32(c.r, c.g, c.b, 0xFF))
        else
            table.insert(out, Blitbuffer.Color8(luma(c)))
        end
    end
    return out
end

--- A key that changes whenever the colours do (for caches of tinted icons and ASCII covers).
function Pal.key()
    return Pal.scheme().key .. "-" .. Pal.mode() .. (Pal.colour() and "-rgb" or "-grey")
end

-- ------------------------------------------------------------------ painting in any colour

local function isGrey(c)
    return Blitbuffer.isColor8(c)
end

function Pal.fill(bb, x, y, w, h, c)
    if w <= 0 or h <= 0 then return end
    if isGrey(c) then bb:paintRect(x, y, w, h, c) else bb:paintRectRGB32(x, y, w, h, c) end
end

function Pal.border(bb, x, y, w, h, t, c)
    if isGrey(c) then bb:paintBorder(x, y, w, h, t, c) else bb:paintBorderRGB32(x, y, w, h, t, c) end
end

--- A grey (0..255) as a colour of the current kind, for ASCII covers on a grey screen.
function Pal.grey(level)
    return Blitbuffer.Color8(clamp(math.floor(level + 0.5), 0, 255))
end

return Pal
