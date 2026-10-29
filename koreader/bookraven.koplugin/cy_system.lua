--[[--
CyberUI system: its settings, in tabs.

  LOOK    the colour scheme (Mono, Graphite, Neon, Synthwave, Bloodline, Terminal, Amber), the
          mode (light or dark) and how book progress is drawn (heartbeat, blocks, bar)
  COVERS  covers as ASCII, as the image, or as text cards; the ASCII characters and density;
          books per row in the library; a preview of the current book's cover
  FONTS   text size, bold and the font family (the plugin's Text settings)
  HOME    the daily reading goal, recent files on the home, CPU and memory in the status bar,
          starting KOReader with CyberUI, the BookRaven account
  SPEED   full refreshes when turning pages, the caches, and counting the device's books again
  ABOUT   versions and credits, and the theme (KOReader restarts to change it)

Changes apply at once (KOReader's menus follow text changes after a restart).
]]

local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local _ = require("gettext")
local T = require("ffi/util").template

local Ascii = require("cy_ascii")
local Cover = require("cy_cover")
local D = require("cy_data")
local Pal = require("cy_palette")
local Settings = require("br_settings")
local Theme = require("br_theme")
local U = require("cy_ui")
local s = U.s

local M = {}

local TABS = {
    { key = "look", text = "Look" }, { key = "covers", text = "Covers" }, { key = "fonts", text = "Fonts" },
    { key = "home", text = "Home" }, { key = "speed", text = "Speed" }, { key = "about", text = "About" },
}

local PROGRESS = { { key = "heartbeat", text = "Heartbeat" }, { key = "blocks", text = "Blocks" }, { key = "bar", text = "Bar" } }
local DENSITY = { { key = "fine", text = "Fine" }, { key = "medium", text = "Medium" }, { key = "coarse", text = "Coarse" } }

local function labelOf(list, key)
    for _, it in ipairs(list) do if it.key == key then return it.text end end
    return key
end

local function value(text, callback)
    return U.button{ text = text, kind = "outline", size = 13, height = s(42), cuts = { tr = s(10), bl = s(10) },
        pad = s(16), callback = callback }
end

local function toggle(on, callback)
    return U.button{ text = on and "On" or "Off", kind = on and "accent" or "outline", size = 13, height = s(42),
        width = s(90), cuts = { tr = s(10), bl = s(10) }, callback = callback }
end

--- A setting: its name and a line about it on the left, its control on the right.
local function row(title, desc, control, w)
    local cw = control:getSize().w
    local tw = w - cw - s(16)
    local texts = U.column({
        U.text{ text = title, kind = "semi", size = 16, color = "fg", tracked = true, max_width = tw },
        desc and U.textbox{ text = desc, kind = "body", size = 13, color = "muted", width = tw } or U.vspace(0),
    }, s(2))
    local h = math.max(texts:getSize().h, control:getSize().h) + s(16)
    return U.column({
        U.Layers:new{
            width = w, height = h,
            { texts, x = 0, y = math.floor((h - texts:getSize().h) / 2) },
            { control, x = w - cw, y = math.floor((h - control:getSize().h) / 2) },
        },
        U.rule(w, "rule"),
    }, 0)
end

local function heading(text, w)
    return U.column({ U.vspace(s(8)), U.label(text, w), U.vspace(s(10)) }, 0)
end

local function set(app, key, v)
    Settings.set(key, v)
    app:restyle()
end

-- ------------------------------------------------------------------ tabs

local function look(app, w)
    local items = { heading("Colour scheme", w) }
    local gap = s(14)
    local col_w = math.floor((w - gap) / 2)
    local sw = s(22)
    local current = Pal.scheme().key
    local grid_row
    for i, sc in ipairs(Pal.SCHEMES) do
        local swatches = {}
        for _, c in ipairs(Pal.swatches(sc)) do
            table.insert(swatches, U.Painter:new{ width = sw, height = sw, paint = function(bb, x, y, pw, ph)
                Pal.fill(bb, x, y, pw, ph, Pal.c("fg"))
                Pal.fill(bb, x + 1, y + 1, pw - 2, ph - 2, c)
            end })
        end
        local sw_row = U.row(swatches, s(4))
        local on = sc.key == current
        local button = U.button{ text = sc.label, kind = on and "accent" or "outline", size = 14, align = "left",
            width = col_w - sw_row:getSize().w - s(12), height = s(44), cuts = { tr = s(10) },
            callback = function() set(app, "cyber_scheme", sc.key) end }
        local cell = U.row({ button, sw_row }, s(12))
        if (i - 1) % 2 == 0 then
            grid_row = U.row({ cell }, 0, "center")
            table.insert(items, grid_row)
            table.insert(items, U.vspace(s(10)))
        else
            table.insert(grid_row, U.hspace(gap))
            table.insert(grid_row, cell)
        end
    end
    if not Pal.colour() then
        table.insert(items, U.textbox{ text = _("This screen shows greys: a scheme changes the contrast here, and its colours on a colour screen."),
            kind = "body", size = 13, color = "muted", width = w })
    end
    table.insert(items, heading("Mode", w))
    table.insert(items, U.segmented{ width = w, items = { { key = "light", text = "Light" }, { key = "dark", text = "Dark" } },
        selected = Pal.mode(), on_select = function(k) set(app, "cyber_mode", k) end })
    table.insert(items, U.vspace(s(14)))
    local prog = Settings.get("cyber_progress") or "heartbeat"
    table.insert(items, row("Book progress", _("On the home and in a book's dossier."),
        value(labelOf(PROGRESS, prog), function()
            U.popup{ title = "Book progress", choices = PROGRESS, selected = prog,
                on_select = function(k) set(app, "cyber_progress", k) end }
        end), w))
    return items
end

local function covers(app, w)
    local style = Cover.style()
    local art = Cover.art()
    local chars = Ascii.style()
    local items = {
        row("Theme art", _("Off shows every cover as it is, without ASCII or the cut frame, so books are easy to tell apart."),
            toggle(art, function() set(app, "cyber_cover_art", not art) end), w),
    }
    if art then
        table.insert(items, heading("Style", w))
        table.insert(items, U.segmented{ width = w, items = { { key = "ascii", text = "ASCII" }, { key = "image", text = "Image" }, { key = "card", text = "Card" } },
            selected = style, on_select = function(k) set(app, "cyber_cover", k) end })
        table.insert(items, U.vspace(s(10)))
        table.insert(items, row("Characters", _("What ASCII covers are drawn with."), value(labelOf(Ascii.STYLES, chars), function()
            U.popup{ title = "Characters", choices = Ascii.STYLES, selected = chars,
                on_select = function(k) set(app, "cyber_ascii", k) end }
        end), w))
        local density = Settings.get("cyber_ascii_size") or "medium"
        table.insert(items, row("Density", _("Smaller cells show more detail."), value(labelOf(DENSITY, density), function()
            U.popup{ title = "Density", choices = DENSITY, selected = density,
                on_select = function(k) set(app, "cyber_ascii_size", k) end }
        end), w))
    end
    table.insert(items, heading("Books per row", w))
    table.insert(items, U.segmented{ width = w, items = { { key = "3", text = "3" }, { key = "4", text = "4" }, { key = "5", text = "5" } },
        selected = tostring(Settings.get("cyber_grid_cols") or 4), on_select = function(k) set(app, "cyber_grid_cols", tonumber(k)) end })
    -- a preview with the current book
    local file = app.current and app.current.file
    if file then
        table.insert(items, heading("Preview", w))
        local pw = s(110)
        local cover = Cover.framed(file, app.current.title, app.current.authors, pw, math.floor(pw * 1.5), {})
        local note = U.column({
            U.text{ text = app.current.title, kind = "semi", size = 15, color = "fg", max_width = w - pw - s(16) },
            U.text{ text = U.upper(art and labelOf({ { key = "ascii", text = "ASCII // " .. labelOf(Ascii.STYLES, chars) },
                { key = "image", text = "Image" }, { key = "card", text = "Card" } }, style) or "Original"), kind = "mono", size = 12, color = "muted" },
        }, s(4))
        table.insert(items, U.row({ cover, note }, s(16), "top"))
    end
    return items
end

local function textChanged(app)
    UIManager:broadcastEvent(require("ui/event"):new("BookRavenTextChanged"))
    app:restyle()
end

local function fonts(app, w)
    local text = Settings.text()
    local scales = Settings.TEXT_SCALES
    local at = 1
    for i, v in ipairs(scales) do if v <= text.scale then at = i end end
    local function step(d)
        Settings.set("text_scale", scales[math.max(1, math.min(#scales, at + d))])
        textChanged(app)
    end
    local sizes = U.row({
        U.button{ text = "A\u{2212}", kind = "outline", size = 14, width = s(56), height = s(42), cuts = { tr = s(8) }, callback = function() step(-1) end },
        U.button{ text = string.format("%d%%", text.scale), kind = "fill", size = 14, width = s(84), height = s(42),
            callback = function() Settings.set("text_scale", 100); textChanged(app) end },
        U.button{ text = "A+", kind = "outline", size = 14, width = s(56), height = s(42), cuts = { tr = s(8) }, callback = function() step(1) end },
    }, s(8))
    local items = {
        heading("Text", w),
        row("Text size", _("The text of CyberUI's screens."), sizes, w),
        row("Bold text", nil, toggle(text.bold, function()
            Settings.set("text_bold", not text.bold)
            textChanged(app)
        end), w),
        heading("Font", w),
    }
    local chips, line, used = {}, nil, 0
    for _, fam in ipairs(Theme.FAMILIES) do
        local on = text.font == fam.key
        local chip = U.button{ text = fam.label, kind = on and "accent" or "outline", size = 13, height = s(42),
            cuts = { tr = s(8) }, pad = s(14), upper = true, callback = function()
                Settings.set("text_font", fam.key)
                textChanged(app)
            end }
        local cw = chip:getSize().w
        if not line or used + s(10) + cw > w then
            line = U.row({}, 0)
            table.insert(chips, line)
            used = 0
        else
            table.insert(line, U.hspace(s(10)))
            used = used + s(10)
        end
        table.insert(line, chip)
        used = used + cw
    end
    table.insert(items, U.column(chips, s(10)))
    if Theme.textPending() then
        table.insert(items, U.vspace(s(14)))
        table.insert(items, row("Restart", _("KOReader's menus and dialogs use the new text after a restart."),
            U.button{ text = "Restart", kind = "accent", size = 13, height = s(42), cuts = { tr = s(10), bl = s(10) },
                callback = function() UIManager:askForRestart() end }, w))
    end
    return items
end

local function home(app, w)
    local goal = Settings.get("cyber_goal") or 30
    local function goalStep(d)
        Settings.set("cyber_goal", math.max(5, math.min(240, goal + d)))
        app:rebuild()
    end
    local goals = U.row({
        U.button{ text = "\u{2212}", kind = "outline", size = 14, width = s(48), height = s(42), cuts = { tr = s(8) }, callback = function() goalStep(-5) end },
        U.button{ text = string.format("%d MIN", goal), kind = "fill", size = 13, width = s(96), height = s(42), upper = false, tracked = false },
        U.button{ text = "+", kind = "outline", size = 14, width = s(48), height = s(42), cuts = { tr = s(8) }, callback = function() goalStep(5) end },
    }, s(8))
    local start = G_reader_settings:readSetting("start_with") == Settings.START_WITH
    local account = require("br_account").credentials(app.ui)
    return {
        heading("Home", w),
        row("Daily goal", _("Minutes a day, for the streak line and the log."), goals, w),
        row("Recent files", _("The reading history next to the menu on the home."), toggle(Settings.get("cyber_home_recent") ~= false, function()
            Settings.set("cyber_home_recent", Settings.get("cyber_home_recent") == false)
            app:rebuild()
        end), w),
        row("Status telemetry", _("CPU and memory in the status bar."), toggle(Settings.get("cyber_telemetry") ~= false, function()
            Settings.set("cyber_telemetry", Settings.get("cyber_telemetry") == false)
            app:rebuild()
        end), w),
        row("Start with CyberUI", _("Open it when KOReader starts and when a book closes."), toggle(start, function()
            G_reader_settings:saveSetting("start_with", start and "filemanager" or Settings.START_WITH)
            app:rebuild()
        end), w),
        row("Account", account or _("No BookRaven account yet."), value(account and "Change" or "Link", function()
            require("br_account").showDialog(app.ui, function() app:refresh(true) end)
        end), w),
    }
end

local function speed(app, w)
    return {
        heading("Refresh", w),
        row("Flash on page turn", _("A full refresh when you turn a page of the library: no ghosting, a little slower."),
            toggle(Settings.get("cyber_flash") ~= false, function()
                Settings.set("cyber_flash", Settings.get("cyber_flash") == false)
                app:rebuild()
            end), w),
        heading("Caches", w),
        row("ASCII covers", _("Drawn covers kept in memory."), value("Clear", function()
            Ascii.clear()
            UIManager:show(InfoMessage:new{ text = _("ASCII covers cleared."), timeout = 2 })
        end), w),
        row("Covers", _("Covers saved on the device (catalog and books)."), value("Clear", function()
            local n = require("br_covers"):clear()
            Ascii.clear()
            UIManager:show(InfoMessage:new{ text = T(_("Removed %1 cached covers."), n), timeout = 2 })
            app:rebuild()
        end), w),
        row("Book index", _("Count the books on the device again (new folders, books copied over USB)."), value("Rescan", function()
            local Search = require("br_search")
            Search.index = nil
            pcall(Search.deviceIndex, true)
            app:rebuild()
        end), w),
    }
end

local function about(app, w)
    local themes = {
        { key = "original", text = "KOReader" }, { key = "bookraven", text = "BookRaven" },
        { key = "cyberdeck", text = "Cyberdeck" }, { key = "classic", text = "Classic" },
    }
    return {
        U.vspace(s(10)),
        U.text{ text = "CYBERUI 1.0.0", kind = "display", size = 28, color = "fg", tracked = true },
        U.text{ text = "BOOKRAVEN FOR KOREADER // CYBERDECK THEME", kind = "mono", size = 12, color = "muted", max_width = w },
        U.vspace(s(14)),
        U.kv({
            { "KOReader", D.koreader() },
            { "Device", U.upper(D.model()) },
            { "Scheme", Pal.scheme().label .. " // " .. U.upper(Pal.mode()) },
            { "Type", "CHAKRA PETCH, SHARE TECH MONO (SIL OFL)" },
            { "Icons", "DRAWN FOR BOOKRAVEN" },
        }, s(110), w, 12),
        U.vspace(s(16)),
        row("Theme", _("KOReader restarts to change it."), value("Cyberdeck", function()
            U.popup{ title = "Theme", choices = themes, selected = Settings.get("theme"), on_select = function(k)
                if k ~= Settings.get("theme") then
                    Settings.set("theme", k)
                    UIManager:askForRestart(_("KOReader needs to restart to change the theme."))
                end
            end }
        end), w),
        row("KOReader menu", _("Every setting of KOReader."), value("Open", function() app:showMenu() end), w),
    }
end

local BUILD = { look = look, covers = covers, fonts = fonts, home = home, speed = speed, about = about }

function M.build(app, w, h, route)
    local args = route.args
    args.tab_key = args.tab_key or "look"
    local head = U.header{ width = w, path = "~/.cyberui/config", title = "System", on_back = function() app:back() end }
    local tabs = U.segmented{ width = w, items = TABS, selected = args.tab_key, height = s(44), size = w < s(500) and 11 or 13,
        on_select = function(k)
            args.tab_key = k
            app:rebuild(true)
        end }
    local items = { head, U.vspace(s(14)), tabs, U.vspace(s(6)) }
    local ok, list = pcall(BUILD[args.tab_key] or look, app, w)
    if not ok then
        list = { U.textbox{ text = tostring(list), kind = "mono", size = 11, color = "accent", width = w } }
    end
    for _, it in ipairs(list) do table.insert(items, it) end
    return U.column(items, 0)
end

return M
