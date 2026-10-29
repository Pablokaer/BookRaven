--[[--
CyberUI telemetry log: your reading, from KOReader's Reading statistics plugin.

  * TIME and PAGES this week, and the STREAK (days in a row, and the best run);
  * MINUTES READ // THIS WEEK: a bar per day (today filled), the daily goal as a dashed line
    (System → Home → Daily goal);
  * ACTIVITY // 12 WEEKS: a cell per day, a column per week: empty, some reading, or the goal met;
  * SESSION LOG: the last sessions (a book's pages with less than ten minutes between them).

Without statistics (the plugin off, or nothing read yet) it says how to turn them on.
]]

local _ = require("gettext")

local D = require("cy_data")
local Pal = require("cy_palette")
local Settings = require("br_settings")
local U = require("cy_ui")
local s = U.s

local M = {}

local DAYS = { "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT" }

local function statBox(label, value, sub, w)
    return U.Box:new{ width = w, line = "fg", cuts = { tr = s(10) }, padding = s(10), valign = "top",
        U.column({
            U.text{ text = label, kind = "mono", size = 11, color = "fg", upper = true },
            U.text{ text = value, kind = "mono", size = 28, color = "fg" },
            U.text{ text = sub, kind = "body", size = 13, color = "muted", max_width = w - s(20) },
        }, s(2)) }
end

local function chart(t, w, h, goal)
    local label_h = U.lineHeight("mono", 11) + s(6)
    local plot_h = h - label_h
    local top = goal * 1.25
    for _, m in ipairs(t.days) do if m > top then top = m end end
    local labels = {}
    local col = math.floor(w / 7)
    for i = 1, 7 do
        local l = U.text{ text = DAYS[i], kind = "mono", size = 11, color = i == t.today and "fg" or "muted" }
        table.insert(labels, { l, x = (i - 1) * col + math.floor((col - l:getSize().w) / 2), y = plot_h + s(6) })
    end
    local plot = U.Painter:new{
        width = w, height = plot_h,
        paint = function(bb, x, y, pw, ph)
            local t2 = math.max(2, s(1.5))
            local bw = math.floor(col * 0.6)
            for i = 1, 7 do
                local m = t.days[i]
                local bh = math.floor((ph - t2) * m / top)
                local bx = x + (i - 1) * col + math.floor((col - bw) / 2)
                local by = y + ph - t2 - bh
                if bh > 0 then
                    if i == t.today then
                        Pal.fill(bb, bx, by, bw, bh, Pal.c("fg"))
                    elseif i < t.today then
                        Pal.border(bb, bx, by, bw, bh + t2, t2, Pal.c("fg"))
                    end
                end
            end
            -- the goal, dashed, and the baseline
            local gy = y + ph - t2 - math.floor((ph - t2) * goal / top)
            U.dashed(bb, x, gy, pw, math.max(1, s(1)), "muted")
            Pal.fill(bb, x, y + ph - t2, pw, t2, Pal.c("fg"))
        end,
    }
    local layers = U.Layers:new{ width = w, height = h, { plot, x = 0, y = 0 } }
    for _, l in ipairs(labels) do table.insert(layers, l) end
    return layers
end

local function heat(t, w, goal)
    local gap = s(5)
    local cw = math.floor((w - 11 * gap) / 12)
    local ch = s(11)
    return U.Painter:new{
        width = w, height = 7 * ch + 6 * gap,
        paint = function(bb, x, y)
            for wk = 1, 12 do
                for d = 1, 7 do
                    local m = t.heat[wk][d]
                    local cx, cy = x + (wk - 1) * (cw + gap), y + (d - 1) * (ch + gap)
                    if m >= goal then
                        Pal.fill(bb, cx, cy, cw, ch, Pal.c("fg"))
                    elseif m > 0 then
                        Pal.fill(bb, cx, cy, cw, ch, Pal.c("muted"))
                    elseif m == 0 then
                        Pal.border(bb, cx, cy, cw, ch, math.max(1, s(1)), Pal.c("rule"))
                    end
                end
            end
        end,
    }
end

local function sessionRow(sess, w)
    local right = U.text{ text = string.format("%s // %d PG", D.duration(sess.secs), sess.npages), kind = "mono", size = 13, color = "fg" }
    local text_w = w - right:getSize().w - s(16)
    local left = U.column({
        U.text{ text = sess.title, kind = "body", size = 16, color = "fg", max_width = text_w },
        U.text{ text = os.date("%a %d %b %H:%M", sess.start):upper(), kind = "mono", size = 12, color = "muted" },
    }, s(2))
    local h = left:getSize().h + s(12)
    return U.column({
        U.Layers:new{
            width = w, height = h,
            { left, x = 0, y = s(6) },
            { right, x = w - right:getSize().w, y = math.floor((h - right:getSize().h) / 2) },
        },
        U.rule(w, "rule"),
    }, 0)
end

function M.build(app, w, h, route)
    local head = U.header{ width = w, path = "/VAR/LOG/", title = "Telemetry.log", on_back = function() app:back() end }
    local t = D.telemetry()
    if not t then
        return U.column({
            head, U.vspace(s(24)),
            U.text{ text = "NO TELEMETRY", kind = "display", size = 20, color = "accent", tracked = true },
            U.vspace(s(8)),
            U.textbox{ text = _("Reading statistics are off, or nothing has been read yet. Turn on Tools → More tools → Plugin management → Reading statistics, then read a few pages."),
                kind = "body", size = 15, color = "muted", width = w },
        })
    end
    local goal = Settings.get("cyber_goal") or 30
    local gap = s(12)
    local bw = math.floor((w - 2 * gap) / 3)
    local boxes = U.row({
        statBox("Time", D.hm(t.week_time), _("this week"), bw),
        statBox("Pages", tostring(t.week_pages), _("this week"), bw),
        statBox("Streak", tostring(t.streak), string.format("days, best %d", t.best), bw),
    }, gap, "top")
    local items = {
        head, U.vspace(s(16)), boxes, U.vspace(s(18)),
        U.label("Minutes read // this week", w, string.format("%s = %d MIN", DAYS[t.today], t.today_min)),
        U.vspace(s(12)),
        chart(t, w, s(150), goal),
        U.vspace(s(18)),
        U.label("Activity // 12 weeks", w),
        U.vspace(s(10)),
        heat(t, w, goal),
        U.vspace(s(18)),
        U.label("Session log", w),
        U.vspace(s(4)),
    }
    local col = U.column(items, 0)
    local used = col:getSize().h
    for _, sess in ipairs(t.sessions) do
        local row = sessionRow(sess, w)
        local rh = row:getSize().h
        if used + rh > h then break end
        table.insert(col, row)
        used = used + rh
    end
    if #t.sessions == 0 then
        table.insert(col, U.text{ text = "NO SESSIONS", kind = "mono", size = 12, color = "muted" })
    end
    col:resetLayout() -- rows were added after it was measured
    return col
end

return M
