--[[--
Covers on the CyberUI screens: framed in the theme's colour with a cut corner, and drawn

  image   the cover itself
  ascii   as characters (cy_ascii)
  card    a text card: the title and author on a panel, no picture

after System → Covers → Style (cyber_cover), or always as the image (home, dossier: style =
"image"). A book without a cover gets the card. Tags ("NEW", "42%") sit on the top edge.
]]

local Geom = require("ui/geometry")
local ImageWidget = require("ui/widget/imagewidget")
local WidgetContainer = require("ui/widget/container/widgetcontainer")

local Covers = require("br_covers")
local Pal = require("cy_palette")
local Settings = require("br_settings")
local U = require("cy_ui")
local s = U.s

local C = {}

function C.style()
    return Settings.get("cyber_cover") or "ascii"
end

--- A text card for a book without a cover (or in the card style).
function C.card(title, author, w, h)
    local pad = math.max(s(4), math.floor(w * 0.08))
    local size = math.max(9, math.min(16, math.floor(w / s(7))))
    local parts = {
        U.textbox{ text = title or "", kind = "display", size = size, color = "fg", bg = "panel", upper = true,
            width = w - 2 * pad, height = math.floor(h * 0.55) },
    }
    if author and author ~= "" then
        table.insert(parts, U.vspace(s(4)))
        table.insert(parts, U.textbox{ text = "// " .. author, kind = "mono", size = math.max(8, size - 3), color = "muted",
            bg = "panel", width = w - 2 * pad, height = math.floor(h * 0.25) })
    end
    return U.Box:new{ width = w, height = h, fill = "panel", padding = pad, valign = "top", U.column(parts, 0) }
end

--- The picture of a book in a w x h box (the box is filled; the image keeps its proportions).
function C.picture(file, path, title, author, w, h, style)
    style = style or C.style()
    if path and style == "ascii" then
        return require("cy_ascii").AsciiCover:new{ width = w, height = h, path = path, title = title }
    end
    if path and style == "image" then
        local iw, ih = Covers:size(path)
        if iw and ih then
            local fw, fh = Covers.fit(iw, ih, w, h)
            return U.Box:new{ width = w, height = h, fill = "bg", align = "center", valign = "center",
                ImageWidget:new{ file = path, width = fw, height = fh } }
        end
    end
    return C.card(title, author, w, h)
end

--- Paints its picture, then the frame (with a cut top-right corner) and the tag over it.
local Framed = WidgetContainer:extend{ width = nil, height = nil, t = nil, cut = nil, tag = nil, line = "fg" }
C.Framed = Framed

function Framed:getSize() return Geom:new{ w = self.width, h = self.height } end

function Framed:paintTo(bb, x, y)
    self.dimen = Geom:new{ x = x, y = y, w = self.width, h = self.height }
    local t, cut = self.t, self.cut
    self[1]:paintTo(bb, x + t, y + t)
    -- the frame: four sides, the top-right corner cut at 45°
    local c = Pal.c(self.line)
    local w, h = self.width, self.height
    Pal.fill(bb, x, y, w - cut, t, c)
    Pal.fill(bb, x, y + h - t, w, t, c)
    Pal.fill(bb, x, y, t, h, c)
    Pal.fill(bb, x + w - t, y + cut, t, h - cut, c)
    -- the corner: page colour outside the cut, the line along it
    local bg = Pal.c("bg")
    for r = 0, cut - 1 do
        Pal.fill(bb, x + w - cut + r + 1, y + r, cut - r - 1, 1, bg)
        Pal.fill(bb, x + w - cut + r - t + 1, y + r, t, 1, c)
    end
    if self.tag then
        local ts = self.tag:getSize()
        self.tag:paintTo(bb, x + w - ts.w - math.floor(cut * 0.5), y + t)
    end
end

--- A framed cover. opts: style ("image" | "ascii" | "card"), tag (a widget), line (a role).
function C.framed(file, title, author, w, h, opts)
    opts = opts or {}
    local t = math.max(2, s(1.5))
    local cut = math.max(s(6), math.floor(w * 0.08))
    local path = opts.path
    if path == nil and file then
        path = opts.cached_only and require("cy_data").cachedCover(file) or require("cy_data").cover(file)
    end
    local pic = C.picture(file, path, title, author, w - 2 * t, h - 2 * t, opts.style)
    return Framed:new{ width = w, height = h, t = t, cut = cut, tag = opts.tag, line = opts.line or "fg", pic }, path
end

return C
