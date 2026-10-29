--[[--
CyberUI home: the operator console.

  * the header: CYBERDECK // KINDLE // OPERATOR ACCESS, READER // ONLINE (or OFFLINE), a barcode.
    Tap: ask the server again and lay the home out anew; long-press: KOReader's menu;
  * INDEX OK … N BOOKS: the books on the device (br_search's index, counted after the first paint);
  * the day: its number, the date, the reading streak, today's minutes and the daily goal
    (cy_log's telemetry); SYS opens the diagnostics;
  * ACTIVE_FILE: the book you are reading, its progress as a heartbeat, RESUME (tap the cover for
    its dossier);
  * RECENT_FILES (the reading history; tap: open, long-press: dossier) and the menu: Library,
    Collections, History, Search, Uplink (the BookRaven catalog) and System;
  * the prompt ROOT@KINDLE:~#: KOReader's file browser.
]]

local Device = require("device")
local _ = require("gettext")

local Cover = require("cy_cover")
local D = require("cy_data")
local Settings = require("br_settings")
local U = require("cy_ui")
local s = U.s

local M = {}

local VERSION = "CYBERUI 1.0.0"

local function header(app, w)
    local status = app.offline and "OFFLINE" or "ONLINE"
    local kind = Device:isKindle() and "KINDLE" or "READER"
    local texts = U.column({
        U.text{ text = "CYBERDECK // " .. kind .. " // OPERATOR ACCESS", kind = "mono", size = 10, color = "muted",
            max_width = w - s(170) },
        U.text{ text = "READER // " .. status, kind = "display", size = 18, color = "fg", tracked = true, max_width = w - s(170) },
    }, 0)
    local left = U.row({ U.icon("book", s(28), "accent"), texts }, s(12))
    local h = math.max(s(52), texts:getSize().h + s(14))
    local code = U.barcode(s(96), s(30), "bookraven" .. status)
    local box = U.Box:new{
        width = w, height = h, line = "fg", cuts = { tl = s(12) }, pad_l = s(14), pad_r = s(10),
        U.Layers:new{
            width = w - s(24), height = h - s(4),
            { left, x = 0, y = math.floor((h - s(4) - left:getSize().h) / 2) },
            { code, x = w - s(24) - s(96), y = math.floor((h - s(4) - s(30)) / 2) },
        },
    }
    return U.Tap:new{
        callback = function() app:goHome() end,
        hold_callback = function() app:showMenu() end,
        box,
    }
end

local function indexRow(w)
    local idx = require("br_search").index
    local text = idx and string.format("INDEX OK ... %d BOOKS", #(idx.files or {})) or "INDEX ... SCANNING"
    local tag = U.Box:new{ fill = "accent", cuts = { bl = s(10) }, pad_l = s(16), pad_r = s(12), pad_t = s(3), pad_b = s(3),
        U.text{ text = text, kind = "mono", size = 14, color = "ink" } }
    local th = tag:getSize().h
    local tw = tag:getSize().w
    local t = math.max(2, s(2))
    return U.Layers:new{
        width = w, height = th,
        { U.rule(w - tw, "fg", t), x = 0, y = th - t },
        { tag, x = w - tw, y = 0 },
    }
end

local function dayRow(app, w, tele)
    local size = s(60)
    local day = U.Box:new{ width = size, height = size, fill = "fg", cuts = { bl = s(12) }, align = "center",
        U.text{ text = os.date("%d"):gsub("^0", ""), kind = "display", size = 30, color = "ink" } }
    local goal = Settings.get("cyber_goal") or 30
    local line = string.format("GOAL %d", goal)
    if tele then
        line = string.format("STREAK %d DAY%s // %d MIN TODAY // GOAL %d", tele.streak, tele.streak == 1 and "" or "S",
            tele.today_min, goal)
    end
    local sys = U.button{ text = "Sys", icon = "pulse", kind = "outline", size = 13, cuts = { tr = s(10), bl = s(10) },
        height = s(40), callback = function() app:go("diag") end }
    local text_w = w - size - s(14) - sys:getSize().w - s(10)
    local texts = U.column({
        U.text{ text = os.date("%A, %B ") .. os.date("%d"):gsub("^0", ""), kind = "display", size = 17, color = "fg",
            upper = true, tracked = true, max_width = text_w },
        U.text{ text = line, kind = "mono", size = 11, color = "muted", max_width = text_w },
    }, s(4))
    return U.Layers:new{
        width = w, height = size,
        { day, x = 0, y = 0 },
        { texts, x = size + s(14), y = math.floor((size - texts:getSize().h) / 2) },
        { sys, x = w - sys:getSize().w, y = math.floor((size - sys:getSize().h) / 2) },
    }
end

--- The active file, in brackets.
local function activeFile(app, w)
    local cur = app.current
    local pad = s(14)
    local inner = w - 2 * pad
    local body
    if cur then
        local cover_w = math.min(s(104), math.floor(w * 0.24))
        local cover_h = math.floor(cover_w * 1.5)
        local cover = Cover.framed(cur.file, cur.title, cur.authors, cover_w, cover_h, { style = "image" })
        local text_w = inner - cover_w - s(16)
        local pct = cur.percent or 0
        local opened = D.lastOpened()[cur.file]
        local parts = {
            U.textbox{ text = cur.title, kind = "display", size = 19, color = "fg", upper = true, tracked = true,
                width = text_w, height = U.lineHeight("display", 19) * 2 },
        }
        if cur.authors and cur.authors ~= "" then
            table.insert(parts, U.text{ text = cur.authors, kind = "body", size = 14, color = "muted", max_width = text_w })
        end
        table.insert(parts, U.vspace(s(4)))
        table.insert(parts, U.progress(text_w, pct))
        table.insert(parts, U.vspace(s(4)))
        table.insert(parts, U.text{ text = string.format("%d%% DECRYPTED", math.floor(pct * 100 + 0.5)), kind = "mono",
            size = 13, color = "fg" })
        table.insert(parts, U.text{ text = "LAST OPEN " .. D.ago(opened), kind = "mono", size = 11, color = "muted" })
        table.insert(parts, U.vspace(s(8)))
        table.insert(parts, U.button{ text = "Resume", icon = "forward", kind = "accent", size = 14,
            width = math.min(text_w, s(170)), height = s(40), cuts = { bl = s(10), tr = s(10) },
            callback = function() app:openBook(cur.file) end })
        body = U.row({
            U.Tap:new{ callback = function() app:dossier(cur.file, "HOME") end,
                hold_callback = function() app:dossier(cur.file, "HOME") end, cover },
            U.column(parts, s(2)),
        }, s(16), "top")
    else
        body = U.column({
            U.text{ text = "NO ACTIVE FILE", kind = "display", size = 19, color = "fg", tracked = true },
            U.textbox{ text = _("Open a book from the library and it will wait for you here."), kind = "body", size = 14,
                color = "muted", width = inner },
            U.vspace(s(8)),
            U.button{ text = "Library", icon = "library", kind = "accent", size = 14, height = s(40), width = s(180),
                cuts = { bl = s(10), tr = s(10) }, callback = function() app:tab("library") end },
        }, s(6))
    end
    local label = U.text{ text = "ACTIVE_FILE", kind = "mono", size = 11, color = "muted" }
    local lh = label:getSize().h
    local h = body:getSize().h + 2 * pad + lh
    local frame = U.Painter:new{
        width = w, height = h,
        paint = function(bb, x, y, fw, fh)
            local t = math.max(2, s(1.5))
            local arm = s(18)
            local c = U.col("fg")
            local top = y + math.floor(lh / 2)
            local Pal = require("cy_palette")
            Pal.fill(bb, x, top, s(10), t, c); Pal.fill(bb, x, top, t, arm, c)
            Pal.fill(bb, x + fw - arm, top, arm, t, c); Pal.fill(bb, x + fw - t, top, t, arm, c)
            Pal.fill(bb, x, y + fh - t, arm, t, c); Pal.fill(bb, x, y + fh - arm, t, arm, c)
            Pal.fill(bb, x + fw - arm, y + fh - t, arm, t, c); Pal.fill(bb, x + fw - t, y + fh - arm, t, arm, c)
        end,
    }
    return U.Layers:new{
        width = w, height = h,
        { frame, x = 0, y = 0 },
        { label, x = s(16), y = 0 },
        { body, x = pad, y = lh + pad - s(2) },
    }
end

local function statusLabel(file)
    local st = D.status(file)
    if st.status == "new" then return "NEW" end
    if st.status == "complete" then return "DONE" end
    if st.status == "abandoned" then return "ON HOLD" end
    return string.format("%d%%", math.floor((st.percent or 0) * 100 + 0.5))
end

local function recentFiles(app, w, h)
    local bar = math.max(3, s(3))
    local x0 = bar + s(14)
    local inner = w - x0
    local label = U.text{ text = "RECENT_FILES", kind = "mono", size = 11, color = "muted" }
    local items = { label, U.vspace(s(8)) }
    local used = label:getSize().h + s(8)
    local cover_w, cover_h = s(30), s(44)
    local skip = app.current and app.current.file
    local shown = 0
    for _, it in ipairs(D.history(12)) do
        if it.file ~= skip then
            local title = D.describe(it.file)
            local text_w = inner - cover_w - s(12)
            local texts = U.column({
                U.text{ text = title, kind = "semi", size = 15, color = "fg", tracked = true, max_width = text_w },
                U.text{ text = statusLabel(it.file) .. " // " .. D.ago(it.time), kind = "mono", size = 11, color = "muted",
                    max_width = text_w },
            }, s(2))
            local row_h = math.max(s(56), texts:getSize().h + s(14))
            if used + row_h > h then break end
            local cover = Cover.framed(it.file, title, nil, cover_w, cover_h, { style = "image" })
            local row = U.column({
                U.place(U.row({ cover, texts }, s(12)), inner, row_h - s(6)),
                U.rule(inner, "rule", math.max(1, s(1))),
            }, s(4))
            table.insert(items, U.Tap:new{
                callback = function() app:openBook(it.file) end,
                hold_callback = function() app:dossier(it.file, "HOME") end,
                row,
            })
            used = used + row_h
            shown = shown + 1
        end
    end
    if shown == 0 then
        table.insert(items, U.text{ text = "NO RECENT FILES", kind = "mono", size = 12, color = "muted" })
    end
    return U.Layers:new{
        width = w, height = h,
        { U.Painter:new{ width = bar, height = h, paint = function(bb, x, y, pw, ph) require("cy_palette").fill(bb, x, y, pw, ph, U.col("accent")) end }, x = 0, y = 0 },
        { U.column(items, 0), x = x0, y = 0 },
    }
end

local function menuTiles(app, w, h)
    local bar = math.max(3, s(3))
    local tw = w - bar - s(12)
    local idx = require("br_search").index
    local books = idx and #(idx.files or {})
    local colls = #D.collections()
    local account = app:account()
    local uplink_sub = app.offline and "LINK // OFFLINE" or (account and "CATALOG // ONLINE" or "LINK ACCOUNT")
    local view = (Settings.get("cyber_library_view") or "grid"):upper()
    local tiles = {
        { "Library", (books and (books .. " FILES") or "SCAN") .. " // " .. view, "library", function() app:tab("library") end },
        { "Collections", string.format("%d CACHE%s", colls, colls == 1 and "" or "S"), "caches", function() app:tab("caches") end },
        { "History", "TELEMETRY.LOG", "log", function() app:tab("log") end },
        { "Search", "GREP THE ARCHIVE", "search", function() app:search() end },
        { "Uplink", uplink_sub, "uplink", function() M.uplink(app) end },
        { "System", "THEME // SETTINGS", "system", function() app:tab("system") end },
    }
    local gap = s(6)
    local tile_h = math.min(s(52), math.floor((h - (#tiles - 1) * gap) / #tiles))
    local items = {}
    for i, t in ipairs(tiles) do
        if i * tile_h + (i - 1) * gap > h then break end
        local small = tile_h < s(34)
        table.insert(items, U.button{
            text = t[1], sub = not small and t[2] or nil, icon = t[3], kind = "panel", size = small and 12 or 13,
            sub_size = 10, width = tw, height = tile_h, cuts = { tr = s(12) }, align = "left", pad = s(12),
            icon_size = s(22), callback = t[4],
        })
    end
    return U.Layers:new{
        width = w, height = h,
        { U.column(items, gap), x = 0, y = 0 },
        { U.Painter:new{ width = bar, height = h, paint = function(bb, x, y, pw, ph) require("cy_palette").fill(bb, x, y, pw, ph, U.col("accent")) end }, x = w - bar, y = 0 },
    }
end

--- The Uplink tile: the BookRaven catalog, or the account setup without one.
function M.uplink(app)
    if app:account() then
        app:openCatalog(nil)
    else
        require("br_account").showDialog(app.ui, function() app:refresh(true) end)
    end
end

local function footer(app, w)
    local code = U.barcode(s(80), s(22), "root")
    local prompt = U.text{ text = "ROOT@KINDLE:~#", kind = "mono", size = 13, color = "fg" }
    local left = U.Tap:new{
        callback = function() app:exitToFiles() end,
        hold_callback = function() app:showMenu() end,
        U.row({ code, prompt }, s(12)),
    }
    local right = U.text{ text = VERSION, kind = "mono", size = 12, color = "muted" }
    local h = math.max(left:getSize().h, right:getSize().h)
    return U.Layers:new{
        width = w, height = h,
        { left, x = 0, y = 0 },
        { right, x = w - right:getSize().w, y = math.floor((h - right:getSize().h) / 2) },
    }
end

--- Landscape: the header across, then the day and the active file on the left, the menu on the
--- right (recent files only if they fit under the menu).
local function landscape(app, w, h, tele)
    local gap = s(18)
    local top = U.column({ header(app, w), U.vspace(s(12)), indexRow(w), U.vspace(s(12)) }, 0)
    local right_w = math.floor(w * 0.36)
    local left_w = w - right_w - gap
    local left = U.column({ dayRow(app, left_w, tele), U.vspace(s(14)), activeFile(app, left_w) }, 0)
    local foot = footer(app, w)
    local top_h, foot_h = top:getSize().h, foot:getSize().h
    local avail = h - top_h - foot_h - s(14)
    return U.Layers:new{
        width = w, height = h,
        { top, x = 0, y = 0 },
        { left, x = 0, y = top_h },
        { menuTiles(app, right_w, avail), x = left_w + gap, y = top_h },
        { foot, x = 0, y = h - foot_h },
    }
end

function M.build(app, w, h)
    local tele = D.telemetry()
    if w > h then return landscape(app, w, h, tele) end
    local top = U.column({
        header(app, w), U.vspace(s(12)),
        indexRow(w), U.vspace(s(12)),
        dayRow(app, w, tele), U.vspace(s(14)),
        activeFile(app, w),
    }, 0)
    local foot = footer(app, w)
    local top_h, foot_h = top:getSize().h, foot:getSize().h
    local split_h = h - top_h - foot_h - s(28)
    local layers = U.Layers:new{ width = w, height = h, { top, x = 0, y = 0 } }
    if split_h >= s(120) then
        local gap = s(14)
        local right_w = math.floor(w * 0.4)
        local left_w = w - right_w - gap
        if Settings.get("cyber_home_recent") ~= false then
            table.insert(layers, { recentFiles(app, left_w, split_h), x = 0, y = top_h + s(14) })
            table.insert(layers, { menuTiles(app, right_w, split_h), x = left_w + gap, y = top_h + s(14) })
        else
            table.insert(layers, { menuTiles(app, w, split_h), x = 0, y = top_h + s(14) })
        end
    end
    table.insert(layers, { foot, x = 0, y = h - foot_h })
    return layers
end

return M
