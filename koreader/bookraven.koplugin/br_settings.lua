--[[--
BookRaven plugin settings, kept in G_reader_settings under "bookraven".

    theme       "original" | "bookraven" | "cyberdeck" | "classic"   (applied at start-up; a change restarts)
    opds_view   "list" | "cards"           (how OPDS book lists are shown)
    cards_grid  "3x2" | "3x3" | "4x3"      (columns x rows of cards per page)
    server      "https://bookraven.cloud"  (base URL of the BookRaven server)
    email       account email used for OPDS and progress sync
    text_scale  100                        (text size on the plugin's screens, in percent)
    text_bold   false                      (bold text on the plugin's screens)
    text_font   "theme" or a key of br_theme's FAMILIES (font of the plugin's screens)
    last_search the last search, offered again next time

The three text settings also restyle KOReader's menus and dialogs when a theme other than the
original look is on; that part is applied at start-up, like the theme itself.
]]

local Settings = {
    KEY = "bookraven",
    START_WITH = "bookraven_catalog", -- our value for the core "start_with" setting
    DEFAULT_SERVER = "https://bookraven.cloud",
    defaults = {
        theme = "original",
        opds_view = "cards",
        cards_grid = "3x2",
        text_scale = 100,
        text_bold = false,
        text_font = "theme",
    },
    GRIDS = {
        ["3x2"] = { cols = 3, rows = 2 },
        ["3x3"] = { cols = 3, rows = 3 },
        ["4x3"] = { cols = 4, rows = 3 },
    },
    TEXT_SCALES = { 80, 90, 100, 110, 120, 135, 150 },
}

local function data()
    return G_reader_settings:readSetting(Settings.KEY) or {}
end

function Settings.get(key)
    local value = data()[key]
    if value == nil then
        return Settings.defaults[key]
    end
    return value
end

function Settings.set(key, value)
    local t = data()
    t[key] = value
    G_reader_settings:saveSetting(Settings.KEY, t)
end

function Settings.server()
    local server = Settings.get("server") or Settings.DEFAULT_SERVER
    return (server:gsub("/+$", ""))
end

function Settings.opdsUrl()
    return Settings.server() .. "/opds"
end

--- The chosen theme's name, or nil for KOReader's original look.
function Settings.themeName()
    local name = Settings.get("theme")
    if name and name ~= "original" then return name end
end

--- Text on the plugin's screens: { scale = percent, bold = true/false, font = family key }.
function Settings.text()
    return {
        scale = tonumber(Settings.get("text_scale")) or 100,
        bold = Settings.get("text_bold") == true,
        font = Settings.get("text_font") or "theme",
    }
end

function Settings.grid()
    local landscape = false
    local ok, Screen = pcall(function() return require("device").screen end)
    if ok and Screen then
        landscape = Screen:getWidth() > Screen:getHeight()
    end
    local g = Settings.GRIDS[Settings.get("cards_grid")] or Settings.GRIDS["3x2"]
    if landscape then
        return { cols = g.rows + 2, rows = math.max(1, g.cols - 1) }
    end
    return g
end

return Settings
