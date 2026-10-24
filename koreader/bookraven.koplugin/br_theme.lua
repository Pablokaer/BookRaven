--[[--
Interface themes for KOReader. "original" leaves KOReader untouched; the others are:

  bookraven  The look of bookraven.cloud, modern with engraved details: titles in Cormorant
             Garamond, interface text in Inter, a star-and-hairline ornament under titles, a fine
             line icon set, rounded dialogs, the raven medallion as the home button, and Doré's
             engravings for "The Raven" on the library home and the shelves.
  cyberdeck  Neon noir, after the console cowboys of 1980s cyberpunk fiction: angular Chakra Petch
             type, a monospace status line, black HUD title bars with a cut corner and uppercase
             titles, angular icons, dashed rules, square dialogs, a glitched raven as the home
             button and scanlined engravings. On a colour screen it stays in greys.
  classic    A classic e-reader, inspired by the Kindle's stock look: white pages, black Noto Sans
             type, title bars with the title on the left and a hairline under them, thin line
             icons, covers in a grid with their titles below, and no ornaments. Nothing of
             Amazon's is used: the type is KOReader's own Noto Sans, the icons are drawn here.

All fonts and art are bundled (fonts renamed so they never clash with fonts you installed). Fonts
are read when widgets are created, so a theme is applied once at start-up and a change asks for a
restart. br_style.lua does the rest of the restyling (icons, menus, dialogs, file browser rows).

The reader's text settings (size, bold, font family: Settings.text) apply to the plugin's own
screens at once, through Theme.face, and to the theme's interface fonts at the next start-up.
]]

local Blitbuffer = require("ffi/blitbuffer")
local Font = require("ui/font")
local FontList = require("fontlist")
local logger = require("logger")
local _ = require("gettext")

local Settings = require("br_settings")

local Theme = {
    applied = nil, -- name of the theme applied this session
    applied_text = nil, -- the text settings the interface fonts were set up with
    plugin_dir = nil,
    FONTS = {
        "BookRavenSerif-Bold.ttf", "BookRavenSerif-SemiBold.ttf", "BookRavenSerif-Italic.ttf",
        "BookRavenSans-Regular.ttf", "BookRavenSans-SemiBold.ttf",
        "BookRavenCyber-Bold.ttf", "BookRavenCyber-SemiBold.ttf", "BookRavenCyber-Medium.ttf",
        "BookRavenMono-Regular.ttf",
    },
}

local TITLE_ROLES = { "tfont", "smalltfont", "x_smalltfont" }
local TEXT_ROLES = { "cfont", "hfont", "infofont", "smallinfofont", "x_smallinfofont", "xx_smallinfofont" }
local STATUS_ROLES = { "ffont", "smallffont", "largeffont", "rifont", "pgfont" }

local function roles(title, text, text_bold, status)
    local t = { smallinfofontbold = text_bold }
    for _, r in ipairs(TITLE_ROLES) do t[r] = title end
    for _, r in ipairs(TEXT_ROLES) do t[r] = text end
    for _, r in ipairs(STATUS_ROLES) do t[r] = status or text end
    return t
end

Theme.THEMES = {
    bookraven = {
        label = "BookRaven",
        roles = roles("BookRavenSerif-Bold.ttf", "BookRavenSans-Regular.ttf", "BookRavenSans-SemiBold.ttf"),
        size_bump = { tfont = 4, smalltfont = 4, x_smalltfont = 3 }, -- Cormorant has a small x-height
        bold_pairs = {
            ["BookRavenSans-Regular.ttf"] = "BookRavenSans-SemiBold.ttf",
            ["BookRavenSerif-SemiBold.ttf"] = "BookRavenSerif-Bold.ttf",
        },
        titlebar = "ornament",
        fm_title = "BookRaven",
        style = "engraved",
        icons = "icons/bookraven",
        art = "art/bookraven",
        marks = { check_on = "br.check.on", check_off = "br.check.off", radio_on = "br.radio.on", radio_off = "br.radio.off" },
        tabs = "underline",
        lines = "soft",
        dialog_radius = 12,
        home = {
            display = "BookRavenSerif-Bold.ttf",
            italic = "BookRavenSerif-Italic.ttf",
            text = "BookRavenSans-Regular.ttf",
            strong = "BookRavenSans-SemiBold.ttf",
            label = "BookRavenSans-SemiBold.ttf",
            mono = "BookRavenSans-Regular.ttf",
        },
        card = {
            title = "BookRavenSerif-Bold.ttf",
            author = "BookRavenSans-Regular.ttf",
            cover_title = "BookRavenSerif-Bold.ttf",
            cover_author = "BookRavenSerif-Italic.ttf",
        },
    },
    cyberdeck = {
        label = "Cyberdeck",
        roles = roles("BookRavenCyber-Bold.ttf", "BookRavenCyber-Medium.ttf", "BookRavenCyber-Bold.ttf", "BookRavenMono-Regular.ttf"),
        size_bump = {},
        bold_pairs = {
            ["BookRavenCyber-Medium.ttf"] = "BookRavenCyber-Bold.ttf",
            ["BookRavenCyber-SemiBold.ttf"] = "BookRavenCyber-Bold.ttf",
        },
        titlebar = "hud",
        uppercase_titles = true,
        fm_title = "BOOKRAVEN",
        style = "hud",
        icons = "icons/cyberdeck",
        art = "art/cyberdeck",
        marks = { check_on = "cy.check.on", check_off = "cy.check.off", radio_on = "cy.radio.on", radio_off = "cy.radio.off" },
        tabs = "invert",
        lines = "dashed",
        dialog_radius = 0,
        home = {
            display = "BookRavenCyber-Bold.ttf",
            italic = "BookRavenCyber-Medium.ttf",
            text = "BookRavenCyber-Medium.ttf",
            strong = "BookRavenCyber-SemiBold.ttf",
            label = "BookRavenMono-Regular.ttf",
            mono = "BookRavenMono-Regular.ttf",
        },
        card = {
            style = "hud",
            title = "BookRavenCyber-SemiBold.ttf",
            author = "BookRavenMono-Regular.ttf",
            author_prefix = "// ",
            cover_title = "BookRavenCyber-Bold.ttf",
            cover_author = "BookRavenMono-Regular.ttf",
        },
    },
    classic = {
        label = _("Classic e-reader"),
        roles = roles("NotoSans-Bold.ttf", "NotoSans-Regular.ttf", "NotoSans-Bold.ttf"),
        size_bump = {},
        bold_pairs = {},
        titlebar = "classic",
        fm_title = _("Library"),
        style = "classic",
        icons = "icons/classic",
        art = "art/bookraven",
        marks = { check_on = "cl.check.on", check_off = "cl.check.off", radio_on = "cl.radio.on", radio_off = "cl.radio.off" },
        tabs = "plain",
        lines = "soft",
        dialog_radius = 6,
        home = {
            display = "NotoSans-Bold.ttf",
            italic = "NotoSans-Italic.ttf",
            text = "NotoSans-Regular.ttf",
            strong = "NotoSans-Regular.ttf",
            label = "NotoSans-Bold.ttf",
            mono = "NotoSans-Regular.ttf",
        },
        card = {
            style = "classic",
            title = "NotoSans-Bold.ttf",
            author = "NotoSans-Regular.ttf",
            cover_title = "NotoSans-Bold.ttf",
            cover_author = "NotoSans-Regular.ttf",
        },
    },
}

--- Font families for the plugin's screens (Settings → BookRaven, or the quick settings panel).
--- "theme" keeps the theme's own fonts. regular / strong (secondary lines) / bold / italic.
Theme.FAMILIES = {
    { key = "theme", label = _("Theme's own") },
    { key = "noto", label = "Noto Sans", regular = "NotoSans-Regular.ttf", strong = "NotoSans-Regular.ttf",
        bold = "NotoSans-Bold.ttf", italic = "NotoSans-Italic.ttf" },
    { key = "noto_serif", label = "Noto Serif", regular = "NotoSerif-Regular.ttf", strong = "NotoSerif-Regular.ttf",
        bold = "NotoSerif-Bold.ttf", italic = "NotoSerif-Italic.ttf" },
    { key = "sans", label = "Inter", regular = "BookRavenSans-Regular.ttf", strong = "BookRavenSans-SemiBold.ttf",
        bold = "BookRavenSans-SemiBold.ttf", italic = "BookRavenSans-Regular.ttf" },
    { key = "serif", label = "Cormorant", regular = "BookRavenSerif-SemiBold.ttf", strong = "BookRavenSerif-SemiBold.ttf",
        bold = "BookRavenSerif-Bold.ttf", italic = "BookRavenSerif-Italic.ttf" },
    { key = "cyber", label = "Chakra Petch", regular = "BookRavenCyber-Medium.ttf", strong = "BookRavenCyber-SemiBold.ttf",
        bold = "BookRavenCyber-Bold.ttf", italic = "BookRavenCyber-Medium.ttf" },
}

-- The heavier file of each of our fonts, for "bold text" (KOReader knows its own Noto pairs).
local BOLD_OF = {
    ["BookRavenSans-Regular.ttf"] = "BookRavenSans-SemiBold.ttf",
    ["BookRavenSerif-SemiBold.ttf"] = "BookRavenSerif-Bold.ttf",
    ["BookRavenSerif-Italic.ttf"] = "BookRavenSerif-Bold.ttf",
    ["BookRavenCyber-Medium.ttf"] = "BookRavenCyber-Bold.ttf",
    ["BookRavenCyber-SemiBold.ttf"] = "BookRavenCyber-Bold.ttf",
}

function Theme.family(key)
    for _, fam in ipairs(Theme.FAMILIES) do
        if fam.key == key and fam.regular then return fam end
    end
end

--- The bold file of a font (a file name or a KOReader role), or the font itself if it has none.
function Theme.boldOf(font)
    local real = Font.fontmap[font] or font
    return BOLD_OF[real] or Font.bold_font_variant[real] or real
end

--- A face for the plugin's own screens, after the text settings.
--- font: the theme's choice; kind: "bold", "strong", "italic", "regular" or "mono" (left alone).
function Theme.face(font, size, kind)
    local text = Settings.text()
    if kind ~= "mono" then
        local fam = Theme.family(text.font)
        if fam then font = fam[kind] or fam.regular end
        if text.bold then font = Theme.boldOf(font) end
    end
    size = math.max(8, math.floor(size * text.scale / 100 + 0.5))
    return Font:getFace(font, size) or Font:getFace("cfont", size)
end

--- How much bigger the plugin's text is than at 100%, for boxes that hold it (at least 1).
function Theme.textGrowth()
    return math.max(1, Settings.text().scale / 100)
end

--- True when the text settings changed since the interface fonts were set up (a restart applies them).
function Theme.textPending()
    if not Theme.applied or not Theme.applied_text then return false end
    local now, was = Settings.text(), Theme.applied_text
    return now.scale ~= was.scale or now.bold ~= was.bold or now.font ~= was.font
end

--- The theme in effect this session (nil for the original look).
function Theme.current()
    return Theme.applied and Theme.THEMES[Theme.applied] or nil
end

--- Makes the bundled fonts findable by Font:getFace(), whatever the theme.
function Theme.registerFonts(plugin_dir)
    Theme.plugin_dir = plugin_dir
    local list = FontList:getFontList()
    local known = {}
    for _, path in ipairs(list) do known[path] = true end
    for _, name in ipairs(Theme.FONTS) do
        local path = plugin_dir .. "/fonts/" .. name
        if not known[path] then
            table.insert(list, path)
        end
    end
end

local function isFace(v)
    return type(v) == "table" and rawget(v, "ftsize") ~= nil and rawget(v, "realname") ~= nil
end

--- Re-fetches class-level face defaults (e.g. TitleBar.title_face_fullscreen) in modules
--- that were loaded before the theme was applied.
local function refreshLoadedFaces(theme, old_map, old_sizes)
    local swaps = 0
    for name, mod in pairs(package.loaded) do
        if type(name) == "string" and type(mod) == "table"
                and (name:find("^ui/") or name:find("^apps/")) then
            for k, v in pairs(mod) do
                if isFace(v) then
                    local role = v.orig_font
                    local new
                    if role and theme.roles[role] then
                        local size = v.orig_size
                        if size == old_sizes[role] then size = Font.sizemap[role] end
                        new = Font:getFace(role, size)
                    elseif v.realname == old_map.cfont then
                        new = Font:getFace(theme.roles.cfont, v.orig_size)
                    elseif v.realname == old_map.tfont then
                        local is_title = type(k) == "string" and k:find("title") ~= nil
                        new = Font:getFace(is_title and theme.roles.tfont or theme.roles.smallinfofontbold, v.orig_size)
                    end
                    if new then
                        mod[k] = new
                        swaps = swaps + 1
                    end
                end
            end
        end
    end
    logger.dbg("BookRaven theme: refreshed", swaps, "class-level faces")
end

--- Black HUD bar: the title bar is painted, then inverted, then given a cut corner and a status rule.
local function paintHud(self, bb, x, y)
    local Screen = require("device").screen
    local w, h = self.dimen.w, self.dimen.h
    if not w or not h or w <= 0 or h <= 0 then return end
    bb:invertRect(x, y, w, h)
    local cut = math.floor(h * 0.42)
    for r = 0, cut - 1 do -- bottom-right corner cut at 45°
        bb:paintRect(x + w - (r + 1), y + h - cut + r, r + 1, 1, Blitbuffer.COLOR_WHITE)
    end
    local line = math.max(1, Screen:scaleBySize(1.5))
    local inset = Screen:scaleBySize(6)
    -- a thin grey rule along the bottom, stopping short of the cut
    bb:paintRect(x, y + h - inset - line, w - cut - inset * 2, line, Blitbuffer.COLOR_GRAY_7)
    -- data ticks at the bottom left
    local tick_w, tick_h, gap = Screen:scaleBySize(3), Screen:scaleBySize(7), Screen:scaleBySize(5)
    for i = 0, 3 do
        bb:paintRect(x + inset + i * (tick_w + gap), y + h - inset - line - gap - tick_h, tick_w,
            i == 3 and math.floor(tick_h / 2) or tick_h, Blitbuffer.COLOR_WHITE)
    end
end

--- The ornament under BookRaven titles: "wide" for full-screen title bars, "small" in dialogs.
local function ornament(kind, width)
    local ImageWidget = require("ui/widget/imagewidget")
    local w = math.floor(width * (kind == "wide" and 0.40 or 0.34))
    local h = math.floor(w * (kind == "wide" and 40 / 400 or 30 / 240))
    return ImageWidget:new{
        file = Theme.plugin_dir .. "/icons/bookraven/ornament." .. kind .. ".svg",
        width = w,
        height = h,
        alpha = true,
    }
end

--- Cyberdeck dialog titles: a hairline with a heavy left segment and three ticks.
local function paintHudLine(self, bb, x, y)
    local Screen = require("device").screen
    local w = self.width or self.dimen.w
    local tg = self.title_group and self.title_group:getSize().h or (self.titlebar_height - self.bottom_v_padding)
    local ly = y + tg + math.floor(self.bottom_v_padding / 2)
    local t = math.max(2, Screen:scaleBySize(2))
    bb:paintRect(x, ly, w, 1, Blitbuffer.COLOR_BLACK)
    bb:paintRect(x, ly - t + 1, math.floor(w * 0.22), t, Blitbuffer.COLOR_BLACK)
    local tick = Screen:scaleBySize(3)
    for i = 0, 2 do
        bb:paintRect(x + w - Screen:scaleBySize(12) - i * Screen:scaleBySize(7), ly - tick, tick, tick, Blitbuffer.COLOR_BLACK)
    end
end

local function patchTitleBar(theme)
    local TitleBar = require("ui/widget/titlebar")
    if TitleBar._bookraven then return end
    TitleBar._bookraven = true
    local Size = require("ui/size")
    local Utf8Proc = require("ffi/utf8proc")
    local function upper(s)
        if theme.uppercase_titles and type(s) == "string" then
            local ok, u = pcall(Utf8Proc.uppercase_dumb, s)
            if ok and u then return u end
        end
        return s
    end

    local orig_init = TitleBar.init
    TitleBar.init = function(self, ...)
        local width = self.width or require("device").screen:getWidth()
        if theme.titlebar == "ornament" then
            if self._br_orn == nil then
                if self.fullscreen and not self.with_bottom_line then
                    self._br_orn = "wide"
                elseif not self.fullscreen and self.with_bottom_line then
                    self._br_orn = "small"
                else
                    self._br_orn = false
                end
            end
            if self._br_orn then
                self.with_bottom_line = false
                self._br_orn_widget = self._br_orn_widget or ornament(self._br_orn, width)
                local oh = self._br_orn_widget:getSize().h
                self.bottom_v_padding = oh + Size.padding.default + (self._br_orn == "wide" and Size.padding.small or 0)
            end
        elseif theme.titlebar == "classic" then
            if self.fullscreen then -- title on the left, a hairline under the bar
                self.align = "left"
                self.with_bottom_line = true
                self.bottom_line_color = Blitbuffer.COLOR_BLACK
            end
        elseif theme.titlebar == "hud" then
            if self.fullscreen then
                self._br_hud = true
                self.with_bottom_line = false
                self.title = upper(self.title)
            elseif self.with_bottom_line or self._br_hudline then
                self._br_hudline = true
                self.with_bottom_line = false
                self.bottom_v_padding = Size.padding.large + Size.padding.default
            end
        end
        return orig_init(self, ...)
    end

    local orig_setTitle = TitleBar.setTitle
    TitleBar.setTitle = function(self, title, ...)
        if self._br_hud then title = upper(title) end
        return orig_setTitle(self, title, ...)
    end
    local orig_paintTo = TitleBar.paintTo
    TitleBar.paintTo = function(self, bb, x, y)
        orig_paintTo(self, bb, x, y)
        local ok, err = true, nil
        if self._br_hud then
            ok, err = pcall(paintHud, self, bb, x, y)
        elseif self._br_hudline then
            ok, err = pcall(paintHudLine, self, bb, x, y)
        elseif self._br_orn and self._br_orn_widget then
            ok, err = pcall(function()
                -- right under the title (and subtitle), above any info text
                local o = self._br_orn_widget
                local osz = o:getSize()
                local w = self.width or self.dimen.w
                local tg = self.title_group and self.title_group:getSize().h or (self.titlebar_height - self.bottom_v_padding)
                o:paintTo(bb, x + math.floor((w - osz.w) / 2),
                    y + tg + math.floor((self.bottom_v_padding - osz.h) / 2))
            end)
        end
        if not ok then logger.warn("BookRaven title bar:", err) end
    end
end

--- Applies a theme for this session. Safe to call more than once.
function Theme.apply(plugin_dir, name)
    local theme = Theme.THEMES[name]
    if Theme.applied or not theme then return end
    Theme.applied = name
    Theme.registerFonts(plugin_dir)

    local old_map, old_sizes = {}, {}
    for k, v in pairs(Font.fontmap) do old_map[k] = v end
    for k, v in pairs(Font.sizemap) do old_sizes[k] = v end

    -- Real bold pairs, so bold text uses the heavier file instead of a synthesized one.
    for regular, bold in pairs(theme.bold_pairs) do
        Font.bold_font_variant[regular] = bold
        Font.regular_font_variant[bold] = regular
    end
    -- The reader's text settings, on the theme's interface fonts: family, bold, size.
    local text = Settings.text()
    Theme.applied_text = text
    local fam = Theme.family(text.font)
    local title_roles, text_roles = {}, { smallinfofontbold = true }
    for _, r in ipairs(TITLE_ROLES) do title_roles[r] = true end
    for _, r in ipairs(TEXT_ROLES) do text_roles[r] = true end
    for role, font in pairs(theme.roles) do
        if fam and title_roles[role] then
            font = fam.bold
        elseif fam and text_roles[role] then
            font = role == "smallinfofontbold" and fam.bold or fam.regular
        end
        if text.bold and text_roles[role] then font = Theme.boldOf(font) end
        Font.fontmap[role] = font
    end
    for role, bump in pairs(theme.size_bump) do
        if Font.sizemap[role] then Font.sizemap[role] = Font.sizemap[role] + bump end
    end
    if text.scale ~= 100 then
        for role in pairs(theme.roles) do
            if (title_roles[role] or text_roles[role]) and Font.sizemap[role] then
                Font.sizemap[role] = math.floor(Font.sizemap[role] * text.scale / 100 + 0.5)
            end
        end
    end

    refreshLoadedFaces(theme, old_map, old_sizes)
    patchTitleBar(theme)
    require("br_style").apply(plugin_dir, theme)
    logger.info("BookRaven theme applied:", name)
end

return Theme
