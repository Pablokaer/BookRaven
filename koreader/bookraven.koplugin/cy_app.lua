--[[--
CyberUI: the Cyberdeck theme's library, a small app of its own over KOReader's file browser.

It is the library home of br_home (same server sync, offline detection, the raven's "back to
the home"), drawn as screens:

  home      the operator console: date and streak, the active file, recent files, the menu
  library   the books on the device by folder, with filters, sorting, grid or list (cy_library)
  caches    KOReader's collections, the catalog's shelves and your folder shelves (cy_caches)
  log       reading telemetry from KOReader's statistics (cy_log)
  system    CyberUI's settings: look, covers, fonts, home, speed, about (cy_system)
  diag      diagnostics of the device (cy_diag)
  dossier   one book: its facts, progress, synopsis, and what you can do with it (cy_dossier)

Every screen but the home has the status bar on top and the navigation bar at the bottom; the
home ends with a prompt (tap: KOReader's file browser). The back block of a page goes back one
screen. A swipe down from the top edge (or a tap on the status bar) opens the deck (cy_deck:
light, Wi-Fi, night mode…); a swipe left or right turns the page of a paged screen. The clock in
the status bar is refreshed once a minute, on its own small area of the screen.

Each screen is a module with build(app, width, height, route) returning its widget; route.args
keeps its state (page, folder, filter…) while you visit other screens and come back.
]]

local Device = require("device")
local Event = require("ui/event")
local Geom = require("ui/geometry")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local Screen = Device.screen

local Home = require("br_home")
local D = require("cy_data")
local Pal = require("cy_palette")
local U = require("cy_ui")
local s = U.s

local App = Home:extend{
    name = "bookraven_home",
    cyberui = true,
}

App.SCREENS = {
    home = "cy_home", library = "cy_library", caches = "cy_caches", log = "cy_log",
    system = "cy_system", diag = "cy_diag", dossier = "cy_dossier",
}

-- The tab lit in the navigation bar for each screen.
local TAB = { home = "home", library = "library", caches = "caches", log = "log", system = "system", diag = "home" }

function App:init()
    self.route = self.route or { screen = "home", args = {} }
    self.stack = {}
    Home.init(self)
    self._tick = function() self:tickStatus() end
    UIManager:scheduleIn(61 - tonumber(os.date("%S")), self._tick)
end

--- Lays out the screen in self.route: status bar, the screen, the navigation bar.
function App:build()
    local sw, sh = self.dimen.w, self.dimen.h
    local m = s(16)
    local inner = sw - 2 * m
    local route = self.route
    self.pager = nil

    local top = s(8)
    local status = U.statusBar(inner, D.readings(), function() self:openDeck() end)
    local status_h = status:getSize().h
    self.status_rect = Geom:new{ x = m, y = top, w = inner, h = status_h }
    self.status_box = U.Box:new{ width = inner, height = status_h, status }

    local nav
    if route.screen ~= "home" then
        local tab = (route.args and route.args.tab) or TAB[route.screen] or "library"
        nav = U.navBar(sw, tab, function(key) self:tab(key) end)
    end
    local nav_h = nav and nav:getSize().h or 0
    local body_top = top + status_h + s(10)
    local body_h = sh - body_top - nav_h - s(10)

    local body
    local mod_name = App.SCREENS[route.screen] or "cy_home"
    local ok, err = pcall(function()
        body = require(mod_name).build(self, inner, body_h, route)
    end)
    if not ok or not body then
        logger.err("CyberUI: the screen", route.screen, "failed", err)
        body = U.column({
            U.text{ text = "SEGFAULT // " .. U.upper(route.screen), kind = "display", size = 20, color = "accent" },
            U.vspace(s(8)),
            U.textbox{ text = tostring(err), kind = "mono", size = 11, color = "muted", width = inner },
            U.vspace(s(16)),
            U.button{ text = "Home", kind = "outline", width = s(160), callback = function() self:tab("home") end },
        })
    end
    local layers = U.Layers:new{
        width = sw, height = sh,
        { self.status_box, x = m, y = top },
        { body, x = m, y = body_top },
    }
    if nav then table.insert(layers, { nav, x = 0, y = sh - nav_h }) end
    self[1] = U.Box:new{ width = sw, height = sh, fill = "bg", layers }
end

--- Once a minute: the clock (and the other readings) on the status bar, refreshed alone.
function App:tickStatus()
    if self._closed then return end
    if UIManager:getTopmostVisibleWidget() == self and self.status_box and self.status_rect then
        self.status_box[1] = U.statusBar(self.status_rect.w, D.readings(), function() self:openDeck() end)
        UIManager:setDirty(self, function() return "ui", self.status_rect end)
    end
    UIManager:scheduleIn(61 - tonumber(os.date("%S")), self._tick)
end

-- ------------------------------------------------------------------ getting around

--- Shows a screen, remembering this one for the back block.
function App:go(screen, args)
    table.insert(self.stack, self.route)
    self.route = { screen = screen, args = args or {} }
    self:rebuild(true)
end

--- One screen back (the home stays where it is).
function App:back()
    local prev = table.remove(self.stack)
    if not prev then
        if self.route.screen == "home" then return end
        prev = { screen = "home", args = {} }
    end
    self.route = prev
    self:rebuild(true)
end

--- A tab of the navigation bar: its screen, with the home under it.
function App:tab(name)
    if name == "home" then
        self.stack = {}
        self.route = { screen = "home", args = {} }
    elseif self.route.screen == name and #self.stack <= 1 then
        return
    else
        self.stack = { { screen = "home", args = {} } }
        self.route = { screen = name, args = {} }
    end
    self:rebuild(true)
end

--- The raven of other screens (br_nav.goHome): back to the home screen.
function App:resetToHome()
    self.stack = {}
    self.route = { screen = "home", args = {} }
end

--- A book's dossier.
function App:dossier(file, from)
    self:go("dossier", { file = file, from = from or U.upper(self.route.screen),
        tab = (self.route.args and self.route.args.tab) or TAB[self.route.screen] })
end

function App:openDeck()
    require("cy_deck").show(self)
end

--- Back: one screen back, and from the home to the file browser.
function App:onClose()
    if self.route.screen ~= "home" and not self._closing then
        self:back()
        return true
    end
    return Home.onClose(self)
end

--- Leaves CyberUI for KOReader's file browser.
function App:exitToFiles()
    self._closing = true
    return Home.onClose(self)
end

function App:onBrHomeSwipe(arg, ges)
    local Quick = require("br_quick")
    if Quick.fromTop(ges) then
        self:openDeck()
        return true
    end
    if self.pager and (ges.direction == "west" or ges.direction == "east") then
        local p = self.pager
        local n = p.page + (ges.direction == "west" and 1 or -1)
        if n >= 1 and n <= p.pages then p.go(n) end
        return true
    end
end

--- What changed after the server or the network (br_home), and the device's book index the
--- first time (counted on the home and in diagnostics), without holding up the first paint.
function App:refresh(force)
    Home.refresh(self, force)
    local Search = require("br_search")
    if not Search.index and not self._indexing then
        self._indexing = true
        UIManager:scheduleIn(1, function()
            if self._closed then return end
            pcall(Search.deviceIndex)
            if self.route.screen == "home" then self:rebuild() end
        end)
    end
end

--- Settings changed (System): every screen drawn again in the new colours and type.
function App:restyle()
    require("cy_ascii").clear()
    self:rebuild(true)
end

function App:onBookRavenTextChanged()
    self:rebuild()
end

--- KOReader's night mode, rotation and the like change the whole screen: draw it again.
function App:onSetDimensions()
    Home.onSetDimensions(self)
end

function App:onCloseWidget()
    if self._tick then UIManager:unschedule(self._tick) end
    return Home.onCloseWidget(self)
end

--- KOReader's events from the deck.
function App.send(name, arg)
    UIManager:broadcastEvent(Event:new(name, arg))
end

-- Palette in effect for screens that need it while building.
App.Pal = Pal

return App
