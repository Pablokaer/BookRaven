--[[--
The deck: CyberUI's quick settings, a panel that comes down from the top of the screen (the
Cyberdeck theme's take on br_quick, opened the same ways: a swipe down from the top edge, the
status bar, the sun tab in KOReader's menu, the gesture "BookRaven quick settings").

  * shortcuts (in CyberUI only): home, library, diagnostics, look, search, a full refresh of the
    screen (clears e-ink ghosting) and KOReader's menu;
  * the time, battery, connection, storage, memory and uptime;
  * LUMEN (the frontlight) and TINT (its warmth, where there is one): − and +;
  * Wi-Fi, night mode, rotate; restart and exit KOReader.

No animation, one refresh per change. A tap below it, a swipe up or the close button close it.
]]

local Device = require("device")
local Event = require("ui/event")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local InputContainer = require("ui/widget/container/inputcontainer")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local _ = require("gettext")
local Screen = Device.screen

local D = require("cy_data")
local Pal = require("cy_palette")
local U = require("cy_ui")
local Wifi = require("br_wifi")
local s = U.s

local M = { open = nil }

local Deck = InputContainer:extend{ name = "cyberui_deck", modal = true, owner = nil }

function Deck:init()
    local everywhere = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    self.dimen = everywhere
    self.ges_events = {
        CyDeckTap = { GestureRange:new{ ges = "tap", range = everywhere } },
        CyDeckSwipe = { GestureRange:new{ ges = "swipe", range = everywhere } },
    }
    if Device:hasKeys() then self.key_events = { Close = { { Device.input.group.Back } } } end
    self:build()
end

local function square(icon, kind, callback, size)
    size = size or s(48)
    return U.Tap:new{
        callback = callback,
        U.Box:new{ width = size, height = size, line = kind == "outline" and "fg" or nil,
            fill = kind ~= "outline" and kind or nil, cuts = { tr = s(10) }, align = "center",
            U.icon(icon, math.floor(size * 0.48), kind == "outline" and "fg" or "ink") },
    }
end

--- A stepper: − value +.
local function stepper(v, minus, plus)
    local size = s(46)
    return U.row({
        U.button{ text = "-", kind = "outline", width = size, height = size, size = 14, cuts = { tr = s(10) }, callback = minus },
        U.place(U.text{ text = tostring(v), kind = "mono", size = 15, color = "fg" }, s(64), size, "center"),
        U.button{ text = "+", kind = "outline", width = size, height = size, size = 14, cuts = { tr = s(10) }, callback = plus },
    }, s(4))
end

function Deck:shortcut(fn)
    return function()
        self:close()
        UIManager:nextTick(fn)
    end
end

function Deck:build()
    local sw = Screen:getWidth()
    local m = s(16)
    local w = sw - 2 * m
    local app = self.owner and self.owner.cyberui and self.owner or nil
    local items = { U.vspace(s(14)) }

    -- title and close
    local title = U.column({
        U.text{ text = "KOREADER // DECK", kind = "mono", size = 11, color = "muted" },
        U.text{ text = "DECK", kind = "display", size = 26, color = "fg", tracked = true },
    }, 0)
    local close = square("close", "outline", function() self:close() end, s(52))
    table.insert(items, U.Layers:new{
        width = w, height = math.max(title:getSize().h, close:getSize().h),
        { title, x = 0, y = 0 },
        { close, x = w - close:getSize().w, y = 0 },
    })
    table.insert(items, U.vspace(s(12)))

    -- shortcuts
    local shortcuts = {}
    local reader = not app and self.owner and self.owner.document and self.owner
    if reader then
        -- in a book: close it and go to CyberUI (main.lua opens it after the file browser)
        table.insert(shortcuts, { "deck", "accent", self:shortcut(function()
            require("br_settings").open_library_next = true
            reader:onHome()
        end) })
    end
    if app then
        shortcuts = {
            { "deck", "accent", self:shortcut(function() app:tab("home") end) },
            { "save", "outline", self:shortcut(function() app:tab("library") end) },
            { "system", "outline", self:shortcut(function() app:go("diag") end) },
            { "brush", "outline", self:shortcut(function() app:tab("system") end) },
            { "search", "outline", self:shortcut(function() app:search() end) },
        }
    end
    table.insert(shortcuts, { "frame", (app or reader) and "outline" or "accent", self:shortcut(function()
        UIManager:setDirty("all", "full")
    end) })
    table.insert(shortcuts, { "menu", "outline", self:shortcut(function()
        local ui = (app and app.ui) or (self.owner and self.owner.ui) or self.owner
        if ui and ui.menu then ui.menu:onShowMenu() end
    end) })
    local n = #shortcuts
    local gap = s(10)
    local bw = math.floor((w - (n - 1) * gap) / n)
    local row = {}
    for _, sc in ipairs(shortcuts) do
        table.insert(row, U.Tap:new{ callback = sc[3],
            U.Box:new{ width = bw, height = s(50), line = sc[2] == "outline" and "fg" or nil,
                fill = sc[2] ~= "outline" and sc[2] or nil, cuts = { tr = s(10) }, align = "center",
                U.icon(sc[1], s(24), sc[2] == "outline" and "fg" or "ink") } })
    end
    table.insert(items, U.row(row, gap))
    table.insert(items, U.vspace(s(12)))

    -- readings
    local b = D.battery()
    local st = Wifi.available() and Wifi.state() or nil
    local link = (self.owner and self.owner.offline) and "OFFLINE" or ((not st or st.connected) and "UPLINK" or "NO LINK")
    local disk = D.storage()
    local mem = D.mem()
    local up = D.uptime()
    table.insert(items, U.text{ text = string.format("%s // BAT %s // %s", os.date("%H:%M"), b and (b.pct .. "%") or "--", link),
        kind = "mono", size = 15, color = "fg", max_width = w })
    table.insert(items, U.text{ text = string.format("DSK %s // MEM %s // UP %s",
        disk and string.format("%d%%", math.floor(100 * disk.used / math.max(1, disk.total) + 0.5)) or "--",
        mem and (mem.pct .. "%") or "--",
        up and string.format("%dH%02d", math.floor(up / 3600), math.floor(up % 3600 / 60)) or "--"),
        kind = "mono", size = 13, color = "muted", max_width = w })
    table.insert(items, U.vspace(s(14)))

    -- light and warmth
    local p = D.powerd()
    if Device:hasFrontlight() and p then
        local ok, v = pcall(p.frontlightIntensity, p)
        v = ok and v or 0
        local step = math.max(1, math.floor(((p.fl_max or 10) - (p.fl_min or 0)) / 12 + 0.5))
        table.insert(items, self:control("lumen", "Lumen", stepper(v,
            function() self:setLight(v - step) end, function() self:setLight(v + step) end), w))
        if Device:hasNaturalLight() then
            local ok_w, warmth = pcall(p.frontlightWarmth, p)
            warmth = ok_w and warmth or 0
            table.insert(items, U.vspace(s(8)))
            table.insert(items, self:control("tint", "Tint", stepper(warmth,
                function() self:setWarmth(warmth - 10) end, function() self:setWarmth(warmth + 10) end), w))
        end
        table.insert(items, U.vspace(s(14)))
    end

    -- toggles
    local third = math.floor((w - 2 * s(12)) / 3)
    local bh = s(50)
    local function act(text, icon, on, callback)
        return U.button{ text = text, icon = icon, kind = on and "accent" or "outline", width = third, height = bh, size = 14,
            align = "left", cuts = { tr = s(12) }, callback = callback }
    end
    local wifi_on = st and st.on
    local night = G_reader_settings:isTrue("night_mode")
    local first = {}
    if st then
        table.insert(first, act(wifi_on and "Wi-Fi on" or "Wi-Fi off", wifi_on and "wifi" or "wifi.off", wifi_on, function()
            Wifi.toggle(false)
            UIManager:nextTick(function() self:refresh() end)
        end))
    end
    table.insert(first, act("Night mode", "night", night, function()
        UIManager:broadcastEvent(Event:new("ToggleNightMode"))
        self:refresh()
    end))
    table.insert(first, act("Rotate", "rotate", false, function()
        self:close()
        UIManager:nextTick(function() UIManager:broadcastEvent(Event:new("IterateRotation")) end)
    end))
    table.insert(items, U.row(first, s(12)))
    table.insert(items, U.vspace(s(12)))
    table.insert(items, U.row({
        act("Restart", "restart", false, function() UIManager:broadcastEvent(Event:new("Restart")) end),
        act("Exit", "exit", false, function() UIManager:broadcastEvent(Event:new("Exit")) end),
    }, s(12)))
    table.insert(items, U.vspace(s(18)))

    local page = U.column(items, 0)
    local line = math.max(3, s(3))
    local h = page:getSize().h
    self.panel_dimen = Geom:new{ x = 0, y = 0, w = sw, h = h + line }
    self[1] = U.Box:new{ width = sw, height = h + line, fill = "bg", pad_l = m, valign = "top",
        U.column({
            page,
            U.Painter:new{ width = w, height = line, paint = function(bb, x, y, pw, ph)
                Pal.fill(bb, x - m, y, sw, ph, Pal.c("accent")) end },
        }, 0) }
end

function Deck:control(icon, label, control, w)
    local left = U.row({ U.icon(icon, s(26), "fg"),
        U.text{ text = label, kind = "display", size = 16, color = "fg", upper = true, tracked = true } }, s(12))
    local h = control:getSize().h
    return U.Layers:new{
        width = w, height = h,
        { left, x = 0, y = math.floor((h - left:getSize().h) / 2) },
        { control, x = w - control:getSize().w, y = 0 },
    }
end

function Deck:setLight(v)
    local p = D.powerd()
    if not p then return end
    local ok, err = pcall(function()
        v = math.max(p.fl_min or 0, math.min(p.fl_max or 10, v))
        if v <= (p.fl_min or 0) then p:turnOffFrontlight() else p:setIntensity(v) end
        p:updateResumeFrontlightState()
    end)
    if not ok then logger.warn("CyberUI deck: frontlight", err) end
    self:refresh()
end

function Deck:setWarmth(v)
    local p = D.powerd()
    if not p then return end
    pcall(p.setWarmth, p, math.max(0, math.min(100, v)))
    self:refresh()
end

function Deck:refresh()
    if self._closed then return end
    local old = self.panel_dimen and self.panel_dimen:copy()
    self:build()
    UIManager:setDirty("all", "ui", old and old:combine(self.panel_dimen) or self.panel_dimen)
end

function Deck:onNetworkConnected()
    Wifi.asked_on = nil
    UIManager:nextTick(function() self:refresh() end)
end

function Deck:onNetworkDisconnected()
    UIManager:nextTick(function() self:refresh() end)
end

function Deck:onCyDeckTap(_, ges)
    if ges.pos and ges.pos.y > self.panel_dimen.h then self:close() end
    return true
end

function Deck:onCyDeckSwipe(_, ges)
    if ges.direction == "north" then self:close() end
    return true
end

function Deck:onClose()
    self:close()
    return true
end

function Deck:close()
    if self._closed then return end
    self._closed = true
    M.open = nil
    UIManager:close(self, "flashui", self.panel_dimen)
end

function Deck:onCloseWidget()
    self._closed = true
    M.open = nil
end

function M.show(owner)
    if M.open and not M.open._closed then return end
    local deck = Deck:new{ owner = owner }
    M.open = deck
    UIManager:show(deck, "ui", deck.panel_dimen)
end

return M
