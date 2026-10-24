--[[--
Interface restyling that goes with a theme, applied once at start-up (see br_theme.apply):

  * icons: KOReader's icons (menu tabs, arrows, close, home, notices…) are swapped for the
    theme's own set in icons/<theme>/, by name;
  * check boxes and radio buttons drawn as icons instead of text glyphs;
  * the top menu's tab bar: a short underline with a diamond (BookRaven), an inverted block
    (Cyberdeck) or a plain bar (Classic e-reader) under the open tab, instead of KOReader's
    folder-tab lines;
  * softer separators in menus, dialogs and the file browser; dashed ones for Cyberdeck;
  * rounder dialogs (BookRaven) or square ones (Cyberdeck);
  * the file browser's book rows: a shadow (or HUD brackets) on the cover and a reading progress bar.
]]

local Blitbuffer = require("ffi/blitbuffer")
local Geom = require("ui/geometry")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local LineWidget = require("ui/widget/linewidget")
local Size = require("ui/size")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local Screen = require("device").screen

local Style = { theme = nil, dir = nil, icons = {} }

local function s(n) return Screen:scaleBySize(n) end
local INK = Blitbuffer.COLOR_BLACK
local RULE = Blitbuffer.Color8(0xC8)
local SHADOW = Blitbuffer.Color8(0xA8)
local TRACK = Blitbuffer.Color8(0xDD)

local function loadIcons(dir)
    local map = {}
    if lfs.attributes(dir, "mode") ~= "directory" then return map end
    for f in lfs.dir(dir) do
        local name = f:match("^(.+)%.svg$") or f:match("^(.+)%.png$")
        if name then map[name] = dir .. "/" .. f end
    end
    return map
end

local function patchIcons()
    local IconWidget = require("ui/widget/iconwidget")
    if IconWidget._br_icons then return end
    IconWidget._br_icons = true
    local orig_init = IconWidget.init
    IconWidget.init = function(self, ...)
        if not self.image and not self.file and self.icon and Style.icons[self.icon] then
            self.file = Style.icons[self.icon]
        end
        return orig_init(self, ...)
    end
end

local function patchMarks(theme)
    local marks = theme.marks
    if not marks then return end
    local IconWidget = require("ui/widget/iconwidget")
    local CheckMark = require("ui/widget/checkmark")
    local RadioMark = require("ui/widget/radiomark")
    local function build(self, on, off)
        local size = math.floor((self.face and self.face.size or s(16)) * 0.95)
        local gap = math.floor(size * 0.5)
        local w
        if self.checkable == false then
            w = HorizontalSpan:new{ width = size + gap }
        else
            local file = Style.icons[self.checked and on or off]
            w = HorizontalGroup:new{
                align = "center",
                IconWidget:new{ file = file, width = size, height = size, dim = self.enabled == false or nil },
                HorizontalSpan:new{ width = gap },
            }
        end
        self[1] = w
        local ws = w:getSize()
        self.dimen = Geom:new{ x = 0, y = 0, w = ws.w, h = math.max(ws.h or 0, size) }
        self.baseline = math.floor(size * 0.86)
    end
    CheckMark.init = function(self) build(self, marks.check_on, marks.check_off) end
    RadioMark.init = function(self) build(self, marks.radio_on, marks.radio_off) end
end

--- The top menu's tab bar: our own marker under the open tab.
local function paintTabs(bar, bb, x, y, theme)
    local total_h = bar[1]:getSize().h
    local w = bar.width
    local line = math.max(1, s(0.6))
    local idx = bar.menu and bar.menu.cur_tab
    local ib = idx and bar.icon_widgets and bar.icon_widgets[idx]
    if theme.tabs == "invert" then
        bb:paintRect(x, y + total_h - line, w, line, INK)
        if ib and ib.dimen and ib.dimen.w then
            local bx, bw, bh = ib.dimen.x, ib.dimen.w, total_h - line
            bb:invertRect(bx, y, bw, bh)
            local cut = s(7)
            for r = 0, cut - 1 do -- cut the block's top-right corner
                bb:paintRect(bx + bw - (cut - r), y + r, cut - r, 1, Blitbuffer.COLOR_WHITE)
            end
        end
        return
    end
    bb:paintRect(x, y + total_h - line, w, line, RULE)
    if theme.tabs == "plain" then -- a plain black bar under the open tab, the width of the tab
        if ib and ib.dimen and ib.dimen.w then
            local th = s(3)
            bb:paintRect(ib.dimen.x + s(4), y + total_h - th, ib.dimen.w - s(8), th, INK)
        end
        return
    end
    if ib and ib.dimen and ib.dimen.w then
        local bw = math.floor(ib.dimen.w * 0.42)
        local th = s(2.2)
        local bx = ib.dimen.x + math.floor((ib.dimen.w - bw) / 2)
        local by = y + total_h - th
        bb:paintRect(bx, by, bw, th, INK)
        local d = s(3.5)
        local cx = bx + math.floor(bw / 2)
        for i = 0, d do -- a small diamond resting on the bar
            bb:paintRect(cx - (d - i), by - i - 1, 2 * (d - i) + 1, 1, INK)
        end
    end
end

local function patchTouchMenu(theme)
    local TouchMenu = require("ui/widget/touchmenu")
    if TouchMenu._br_style then return end
    TouchMenu._br_style = true
    if theme.lines == "soft" then
        TouchMenu.split_color = RULE
    end
    local orig_init = TouchMenu.init
    TouchMenu.init = function(self, ...)
        orig_init(self, ...)
        if theme.lines == "dashed" and self.split_line and self.split_line[2] then
            self.split_line[2].style = "dashed"
            self.split_line[2].background = INK
        end
        local Bar = self.bar and getmetatable(self.bar)
        if Bar and not rawget(Bar, "_br_tabs") then
            Bar._br_tabs = true
            local orig_paint = Bar.paintTo
            Bar.paintTo = function(bar, bb, x, y)
                if bar.bar_sep then bar.bar_sep.style = "none" end
                for _, sep in ipairs(bar.icon_seps or {}) do sep.style = "none" end
                orig_paint(bar, bb, x, y)
                local ok, err = pcall(paintTabs, bar, bb, x, y, theme)
                if not ok then logger.warn("BookRaven tabs:", err) end
            end
        end
    end
end

--- Separators inside dialogs' button tables.
local function patchButtonTable(theme)
    local ButtonTable = require("ui/widget/buttontable")
    if ButtonTable._br_style then return end
    ButtonTable._br_style = true
    local orig_init = ButtonTable.init
    ButtonTable.init = function(self, ...)
        orig_init(self, ...)
        local function walk(w, depth)
            if type(w) ~= "table" or depth > 6 then return end
            if getmetatable(w) == LineWidget then
                if w.background == Blitbuffer.COLOR_GRAY then
                    if theme.lines == "dashed" then
                        w.background = INK
                        if w.dimen and w.dimen.w and w.dimen.w > w.dimen.h then w.style = "dashed" end
                    else
                        w.background = RULE
                    end
                end
                return
            end
            for _, c in ipairs(w) do walk(c, depth + 1) end
        end
        pcall(walk, self, 0)
    end
end

--- Finds the framed cover image inside a file browser row (after it has been painted).
local function findCover(w, depth)
    if type(w) ~= "table" or depth > 8 then return end
    if w.bordersize and w[1] and w[1].image and w.dimen and w.dimen.w then
        return w
    end
    for _, c in ipairs(w) do
        local found = findCover(c, depth + 1)
        if found then return found end
    end
end

local function rowExtras(item, bb, x, y, theme)
    local cover = findCover(item[1], 0)
    if cover then
        local cx, cy, cw, ch = cover.dimen.x, cover.dimen.y, cover.dimen.w, cover.dimen.h
        if theme.style == "hud" then
            local p = s(1.5)
            local t = math.max(1, s(1.2))
            local len = math.floor(math.min(cw, ch) * 0.18)
            local x1, y1, x2, y2 = cx - p, cy - p, cx + cw + p, cy + ch + p
            bb:paintRect(x1, y1, len, t, INK); bb:paintRect(x1, y1, t, len, INK)
            bb:paintRect(x2 - len, y2 - t, len, t, INK); bb:paintRect(x2 - t, y2 - len, t, len, INK)
        elseif theme.style == "classic" then
            bb:paintBorder(cx, cy, cw, ch, 1, RULE) -- just a hairline, like the covers on the home
        else
            local p = s(2.5)
            bb:paintRect(cx + cw, cy + p, p, ch, SHADOW)
            bb:paintRect(cx + p, cy + ch, cw, p, SHADOW)
        end
    end
    local menu = item.menu
    if not (menu and menu.getBookInfo and item.filepath) or item.is_directory then return end
    local info = menu.getBookInfo(item.filepath)
    local pct = info and info.percent_finished
    if not pct or pct <= 0 or info.status == "complete" then return end
    local left = cover and (cover.dimen.x + cover.dimen.w + s(12)) or (x + s(10))
    local bw = math.floor((x + item.width - left) * 0.32)
    local by = y + item.height - s(5)
    if theme.style == "hud" then
        local n = 16
        local gap = math.max(2, s(1.2))
        local cell = math.floor((bw - (n - 1) * gap) / n)
        local filled = math.floor(pct * n + 0.5)
        for i = 0, n - 1 do
            local px = left + i * (cell + gap)
            if i < filled then bb:paintRect(px, by, cell, s(2.5), INK)
            else bb:paintBorder(px, by, cell, s(2.5), 1, Blitbuffer.COLOR_GRAY_7) end
        end
    else
        local th = s(2.2)
        bb:paintRoundedRect(left, by, bw, th, TRACK, math.floor(th / 2))
        bb:paintRoundedRect(left, by, math.max(th, math.floor(bw * pct)), th, INK, math.floor(th / 2))
    end
end

--- Restyles the rows the file browser just built (cover browser list or mosaic modes).
local function restyleRows(fc, theme)
    for _, w in ipairs(fc.item_group or {}) do
        if getmetatable(w) == LineWidget then
            if theme.lines == "dashed" then
                w.background = INK
                w.style = "dashed"
            else
                w.background = RULE
            end
        elseif type(w) == "table" and w.entry and w.paintTo and not rawget(w, "_br_row") then
            w._br_row = true
            local orig = w.paintTo
            w.paintTo = function(it, bb, x, y)
                orig(it, bb, x, y)
                local ok, err = pcall(rowExtras, it, bb, x, y, theme)
                if not ok then logger.dbg("BookRaven row:", err) end
            end
        end
    end
end

--- Called by the plugin for each file browser it lives in.
function Style.decorateFileChooser(fc)
    local theme = Style.theme
    if not theme or not fc or rawget(fc, "_br_style") then return end
    fc._br_style = true
    local FileChooser = require("ui/widget/filechooser")
    fc._updateItemsBuildUI = function(this, ...)
        local fn = FileChooser._updateItemsBuildUI
        if not fn then return end
        local ret = fn(this, ...)
        local ok, err = pcall(restyleRows, this, theme)
        if not ok then logger.warn("BookRaven rows:", err) end
        return ret
    end
end

function Style.apply(plugin_dir, theme)
    Style.theme = theme
    Style.dir = plugin_dir
    Style.icons = loadIcons(plugin_dir .. "/" .. theme.icons)
    patchIcons()
    patchMarks(theme)
    patchTouchMenu(theme)
    patchButtonTable(theme)
    if theme.dialog_radius then
        Size.radius.window = s(theme.dialog_radius)
    end
end

return Style
