--[[--
Quick settings: a panel that comes down from the top of the screen, like the Kindle's.

  * Dark mode (KOReader's night mode), Bold text, and the frontlight on or off;
  * Brightness: a slider between a small and a large sun (tap either sun for one step), and
    Warmth on devices with a natural light;
  * Text size (smaller / bigger, tap the value for 100%) and Font: the text of the plugin's
    screens (home, shelves, cards, search). With a theme on, KOReader's menus and dialogs follow
    at the next start-up; the panel then offers a restart.

It opens with a swipe down from the top edge of the plugin's screens (the home, folder shelves,
All shelves, search results and the catalog's cards view; a swipe down lower on those screens
does what it did before), with the chevron on the home's top bar, from Settings → BookRaven, or
with a gesture you assign to "BookRaven quick settings" (Settings → Taps and gestures), also in a
book. Inside a book KOReader's own swipe down from the top (its menu) is left alone.

E-ink friendly: no animation, one refresh per change. It closes with a tap below it, a swipe up,
the close button or the handle at its bottom.
]]

local Blitbuffer = require("ffi/blitbuffer")
local CenterContainer = require("ui/widget/container/centercontainer")
local Device = require("device")
local Event = require("ui/event")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local IconButton = require("ui/widget/iconbutton")
local IconWidget = require("ui/widget/iconwidget")
local InputContainer = require("ui/widget/container/inputcontainer")
local LeftContainer = require("ui/widget/container/leftcontainer")
local OverlapGroup = require("ui/widget/overlapgroup")
local RightContainer = require("ui/widget/container/rightcontainer")
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextWidget = require("ui/widget/textwidget")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local logger = require("logger")
local _ = require("gettext")
local T = require("ffi/util").template
local Screen = Device.screen

local Settings = require("br_settings")
local Theme = require("br_theme")
local W = require("br_widgets")
local s = W.s

local Quick = { open = nil }

--- True for a swipe down that starts at the top edge of the screen.
function Quick.fromTop(ges)
    if not ges or ges.ges ~= "swipe" or ges.direction ~= "south" or not ges.pos then return false end
    return ges.pos.y <= math.max(s(40), math.floor(Screen:getHeight() / 10))
end

-- ------------------------------------------------------------------ slider

--- A horizontal slider: tap or drag along it. on_change(value) gets a whole number in [min, max].
local Slider = InputContainer:extend{ width = nil, height = nil, value = 0, min = 0, max = 10, on_change = nil }

function Slider:init()
    self.dimen = Geom:new{ x = 0, y = 0, w = self.width, h = self.height }
    local range = function() return self.dimen end
    self.ges_events = {
        BrSlideTap = { GestureRange:new{ ges = "tap", range = range } },
        BrSlideRelease = { GestureRange:new{ ges = "pan_release", range = range } },
        BrSlidePan = { GestureRange:new{ ges = "pan", range = range } },
        BrSlideSwipe = { GestureRange:new{ ges = "swipe", range = range } },
        BrSlideHold = { GestureRange:new{ ges = "hold", range = range } },
    }
end

function Slider:getSize()
    return Geom:new{ w = self.width, h = self.height }
end

function Slider:knobRadius()
    return math.floor(self.height * 0.32)
end

function Slider:paintTo(bb, x, y)
    self.dimen = Geom:new{ x = x, y = y, w = self.width, h = self.height }
    local r = self:knobRadius()
    local left, right = x + r, x + self.width - r
    local cy = y + math.floor(self.height / 2)
    local th = math.max(2, s(3))
    local span = math.max(1, self.max - self.min)
    local kx = left + math.floor((right - left) * (self.value - self.min) / span + 0.5)
    bb:paintRect(left, cy - math.floor(th / 2), right - left, th, W.TRACK)
    bb:paintRect(left, cy - math.floor(th / 2), kx - left, th, W.INK)
    bb:paintCircle(kx, cy, r, W.INK)
    bb:paintCircle(kx, cy, r - math.max(2, s(2.5)), W.PAPER)
end

function Slider:valueAt(pos)
    local r = self:knobRadius()
    local left, w = self.dimen.x + r, math.max(1, self.dimen.w - 2 * r)
    local t = math.max(0, math.min(1, (pos.x - left) / w))
    return self.min + math.floor(t * (self.max - self.min) + 0.5)
end

function Slider:set(pos)
    local v = self:valueAt(pos)
    if v ~= self.value then
        self.value = v
        if self.on_change then self.on_change(v) end
    end
    return true
end

function Slider:onBrSlideTap(arg, ges) return self:set(ges.pos) end
function Slider:onBrSlideRelease(arg, ges) return self:set(ges.pos) end
function Slider:onBrSlidePan() return true end -- the value is taken when the finger lifts
function Slider:onBrSlideHold() return true end
function Slider:onBrSlideSwipe(arg, ges)
    if ges.direction == "east" or ges.direction == "west" then
        return self:set(ges.end_pos or ges.pos)
    end
end

-- ------------------------------------------------------------------ the panel

local Panel = InputContainer:extend{
    name = "bookraven_quick_settings",
    modal = true,
    owner = nil, -- the screen it was opened from
}
Quick.Panel = Panel

function Panel:init()
    self.dimen = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    local everywhere = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    self.ges_events = {
        BrQuickTap = { GestureRange:new{ ges = "tap", range = everywhere } },
        BrQuickSwipe = { GestureRange:new{ ges = "swipe", range = everywhere } },
    }
    if Device:hasKeys() then
        self.key_events = { Close = { { Device.input.group.Back } } }
    end
    self:build()
end

local function powerd()
    local ok, p = pcall(Device.getPowerDevice, Device)
    return ok and p or nil
end

--- A chip: a framed label (or icon and label), inverted when on.
function Panel:chip(text, on, callback, width, icon)
    local f = W.fonts()
    local classic = W.style() == "classic"
    local label = TextWidget:new{ text = text, face = f.get("strong", 15), max_width = width and (width - s(16)) or nil }
    local content = label
    if icon then
        local size = s(26)
        content = VerticalGroup:new{
            align = "center",
            IconWidget:new{ file = W.icon(icon), width = size, height = size, alpha = true },
            VerticalSpan:new{ width = s(4) },
            label,
        }
    end
    local inner_w = width and (width - 2 * Size.border.thin) or (content:getSize().w + s(20))
    local inner_h = content:getSize().h + (icon and s(16) or s(12))
    local frame = FrameContainer:new{
        padding = 0, margin = 0,
        bordersize = Size.border.thin,
        color = W.INK,
        radius = not classic and s(6) or nil,
        background = W.PAPER,
        CenterContainer:new{ dimen = Geom:new{ w = inner_w, h = inner_h }, content },
    }
    return W.Tap:new{ callback = callback, W.Invert:new{ on = on and true or false, frame } }
end

--- A row label on the left and an optional value on the right.
function Panel:heading(text, value, width)
    local f = W.fonts()
    local h = TextWidget:new{ text = text, face = f.get("label", 15) }
    local dimen = Geom:new{ w = width, h = h:getSize().h }
    local group = OverlapGroup:new{ dimen = dimen, LeftContainer:new{ dimen = dimen:copy(), h } }
    if value then
        table.insert(group, RightContainer:new{
            dimen = dimen:copy(),
            TextWidget:new{ text = value, face = f.get("strong", 14), fgcolor = W.SOFT },
        })
    end
    return group
end

--- Chips side by side, wrapped onto more rows when they do not fit.
local function wrap(chips, width, gap)
    local rows = VerticalGroup:new{ align = "left" }
    local row, used = nil, 0
    for _, chip in ipairs(chips) do
        local w = chip:getSize().w
        if not row or used + gap + w > width then
            if row then table.insert(rows, VerticalSpan:new{ width = gap }) end
            row = HorizontalGroup:new{ align = "center" }
            table.insert(rows, row)
            used = 0
        else
            table.insert(row, HorizontalSpan:new{ width = gap })
            used = used + gap
        end
        table.insert(row, chip)
        used = used + w
    end
    return rows
end

function Panel:build()
    local f = W.fonts()
    local sw = Screen:getWidth()
    local m = s(16)
    local inner = sw - 2 * m
    local gap = s(10)
    local page = VerticalGroup:new{ align = "left" }
    local function add(w) table.insert(page, w) end
    local function space(h) add(VerticalSpan:new{ width = h }) end

    -- Title and close button.
    local close = IconButton:new{
        icon = "close", width = s(24), height = s(24), padding = s(6),
        callback = function() self:close() end, show_parent = self, allow_flash = false,
    }
    local title = TextWidget:new{ text = _("Quick settings"), face = f.get("display", 20) }
    local bar_h = math.max(title:getSize().h, close:getSize().h)
    local bar = Geom:new{ w = inner, h = bar_h }
    space(s(8))
    add(OverlapGroup:new{
        dimen = bar,
        LeftContainer:new{ dimen = bar:copy(), title },
        RightContainer:new{ dimen = bar:copy(), close },
    })
    space(s(10))

    -- Toggles.
    local p = powerd()
    local toggles = {}
    table.insert(toggles, { _("Dark mode"), "br.moon", G_reader_settings:isTrue("night_mode"), function()
        UIManager:broadcastEvent(Event:new("ToggleNightMode"))
        self:refresh()
    end })
    local text = Settings.text()
    table.insert(toggles, { _("Bold text"), "br.bold", text.bold, function()
        Settings.set("text_bold", not text.bold)
        self:textChanged()
    end })
    if Device:hasFrontlight() and p then
        table.insert(toggles, { _("Light"), "br.sun", p:isFrontlightOn(), function()
            pcall(p.toggleFrontlight, p)
            pcall(p.updateResumeFrontlightState, p)
            UIManager:nextTick(function() self:refresh() end)
        end })
    end
    local tw = math.floor((inner - (#toggles - 1) * gap) / #toggles)
    local row = HorizontalGroup:new{ align = "top" }
    for i, t in ipairs(toggles) do
        if i > 1 then table.insert(row, HorizontalSpan:new{ width = gap }) end
        table.insert(row, self:chip(t[1], t[3], t[4], tw, t[2]))
    end
    add(row)

    -- Brightness and warmth.
    if Device:hasFrontlight() and p then
        local fl_min, fl_max = p.fl_min or 0, p.fl_max or 10
        local value = p:frontlightIntensity() or 0
        space(s(14))
        add(self:heading(_("Brightness"), p:isFrontlightOn() and tostring(value) or _("off"), inner))
        space(s(4))
        local icon = s(22)
        local big = s(30)
        local slider = Slider:new{
            width = inner - icon - big - 2 * s(10) - 2 * s(6), height = s(36),
            value = value, min = fl_min, max = fl_max,
            on_change = function(v) self:setIntensity(v) end,
        }
        local step = math.max(1, math.floor((fl_max - fl_min) / 10 + 0.5))
        add(HorizontalGroup:new{
            align = "center",
            W.iconTap("br.sun.small", icon, s(6), function() self:setIntensity(math.max(fl_min, (p:frontlightIntensity() or 0) - step)) end),
            HorizontalSpan:new{ width = s(4) },
            slider,
            HorizontalSpan:new{ width = s(4) },
            W.iconTap("br.sun", big, s(6), function() self:setIntensity(math.min(fl_max, (p:frontlightIntensity() or 0) + step)) end),
        })
        if Device:hasNaturalLight() then
            local warmth = p:frontlightWarmth() or 0
            space(s(10))
            add(self:heading(_("Warmth"), tostring(warmth), inner))
            space(s(4))
            local wslider = Slider:new{
                width = inner - icon - big - 2 * s(10) - 2 * s(6), height = s(36),
                value = warmth, min = 0, max = 100,
                on_change = function(v) self:setWarmth(v) end,
            }
            add(HorizontalGroup:new{
                align = "center",
                W.iconTap("br.cool", icon, s(6), function() self:setWarmth(math.max(0, (p:frontlightWarmth() or 0) - 10)) end),
                HorizontalSpan:new{ width = s(4) },
                wslider,
                HorizontalSpan:new{ width = s(4) },
                W.iconTap("br.warm", big, s(6), function() self:setWarmth(math.min(100, (p:frontlightWarmth() or 0) + 10)) end),
            })
        end
    end

    -- Text size.
    space(s(14))
    add(self:heading(_("Text size"), nil, inner))
    space(s(6))
    local scales = Settings.TEXT_SCALES
    local at = 1
    for i, v in ipairs(scales) do
        if v <= text.scale then at = i end
    end
    add(HorizontalGroup:new{
        align = "center",
        self:chip("A\u{2212}", false, function()
            Settings.set("text_scale", scales[math.max(1, at - 1)])
            self:textChanged()
        end, s(64)),
        HorizontalSpan:new{ width = gap },
        self:chip(string.format("%d%%", text.scale), false, function()
            Settings.set("text_scale", 100)
            self:textChanged()
        end, s(84)),
        HorizontalSpan:new{ width = gap },
        self:chip("A+", false, function()
            Settings.set("text_scale", scales[math.min(#scales, at + 1)])
            self:textChanged()
        end, s(64)),
    })

    -- Font family.
    space(s(14))
    add(self:heading(_("Font"), nil, inner))
    space(s(6))
    local chips = {}
    for _, fam in ipairs(Theme.FAMILIES) do
        table.insert(chips, self:chip(fam.label, text.font == fam.key, function()
            Settings.set("text_font", fam.key)
            self:textChanged()
        end))
    end
    add(wrap(chips, inner, s(8)))

    -- Menus and dialogs take the new text at the next start-up.
    if Theme.textPending() then
        space(s(12))
        local note = TextBoxWidget:new{
            text = _("KOReader's menus and dialogs use the new text after a restart."),
            face = f.get("strong", 13), fgcolor = W.SOFT, width = inner - s(110),
        }
        add(HorizontalGroup:new{
            align = "center",
            note,
            HorizontalSpan:new{ width = s(10) },
            self:chip(_("Restart"), false, function()
                self:close()
                UIManager:askForRestart()
            end, s(100)),
        })
    end

    -- The handle: tap it (or swipe up) to close.
    space(s(12))
    local handle = W.Painter:new{
        width = s(56), height = s(14),
        paint = function(bb, x, y, w, h)
            bb:paintRoundedRect(x, y + math.floor((h - s(5)) / 2), w, s(5), W.MUTED, math.floor(s(5) / 2))
        end,
    }
    add(CenterContainer:new{
        dimen = Geom:new{ w = inner, h = s(22) },
        W.Tap:new{ callback = function() self:close() end, handle },
    })
    space(s(4))

    local content_h = page:getSize().h
    self.panel = FrameContainer:new{
        width = sw,
        padding = 0, padding_left = m, padding_right = m,
        margin = 0,
        bordersize = 0,
        background = W.PAPER,
        page,
    }
    local panel_h = content_h
    local line = Size.line.thick
    self.panel_dimen = Geom:new{ x = 0, y = 0, w = sw, h = panel_h + line }
    self[1] = VerticalGroup:new{
        align = "left",
        self.panel,
        W.Painter:new{
            width = sw, height = line,
            paint = function(bb, x, y, w, h) bb:paintRect(x, y, w, h, W.INK) end,
        },
    }
end

--- Builds the panel again and refreshes once, over the old and the new area.
function Panel:refresh()
    if self._closed then return end
    local old = self.panel_dimen and self.panel_dimen:copy()
    self:build()
    local region = old and old:combine(self.panel_dimen) or self.panel_dimen
    UIManager:setDirty("all", "ui", region)
end

function Panel:textChanged()
    -- The plugin's screens draw themselves again with the new text (br_home, br_gallery, br_cards).
    UIManager:broadcastEvent(Event:new("BookRavenTextChanged"))
    self:refresh()
end

function Panel:setIntensity(v)
    local p = powerd()
    if not p then return end
    -- As KOReader's own frontlight controls do (DeviceListener:onSetFlIntensity).
    local ok, err = pcall(function()
        if v <= (p.fl_min or 0) then
            p:turnOffFrontlight()
        else
            p:setIntensity(v)
        end
        p:updateResumeFrontlightState()
    end)
    if not ok then logger.warn("BookRaven: could not set the frontlight", err) end
    logger.info("BookRaven quick settings: brightness", v)
    self:refresh()
end

function Panel:setWarmth(v)
    local p = powerd()
    if not p then return end
    local ok, err = pcall(p.setWarmth, p, math.max(0, math.min(100, v)))
    if not ok then logger.warn("BookRaven: could not set the warmth", err) end
    logger.info("BookRaven quick settings: warmth", v)
    self:refresh()
end

function Panel:onBrQuickTap(arg, ges)
    if ges.pos and ges.pos.y > self.panel_dimen.h then
        self:close()
    end
    return true -- taps on the panel itself never reach the screen below
end

function Panel:onBrQuickSwipe(arg, ges)
    if ges.direction == "north" then self:close() end
    return true
end

function Panel:onClose()
    self:close()
    return true
end

function Panel:close()
    if self._closed then return end
    self._closed = true
    Quick.open = nil
    UIManager:close(self, "ui", self.panel_dimen)
end

function Panel:onCloseWidget()
    self._closed = true
    Quick.open = nil
end

--- Opens the panel (once: a second call while it is open does nothing).
function Quick.show(owner)
    if Quick.open and not Quick.open._closed then return end
    local panel = Panel:new{ owner = owner }
    Quick.open = panel
    UIManager:show(panel, "ui", panel.panel_dimen)
end

return Quick
