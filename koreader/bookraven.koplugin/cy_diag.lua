--[[--
CyberUI diagnostics: the device at a glance (SYS on the home).

  POWER CELL  the battery: charge, charging or not, the drain per hour and the hours left
              (measured while KOReader runs: after 20 minutes on battery), when it was charged
  CORE        CPU use (since the last reading: RESCAN reads again), clock, cores, load,
              memory, and KOReader's own memory and threads
  UPLINK      Wi-Fi, the network's name and the device's address, and SSH when it listens
  STORAGE     the library's storage, and the books KOReader found on the device
  OPTICS      the screen: size and density, colour or greys, the frontlight, rotation, night mode
  UPTIME      the device and KOReader, time asleep, how many times it slept and when

Everything comes from KOReader and /proc; what the device does not tell shows as "--".
]]

local Device = require("device")
local _ = require("gettext")

local D = require("cy_data")
local U = require("cy_ui")
local Wifi = require("br_wifi")
local s = U.s

local M = {}

local function hours(secs)
    if not secs then return "--" end
    return string.format("%dH %02dM", math.floor(secs / 3600), math.floor(secs % 3600 / 60))
end

--- A panel: a filled strip with its name and reading, then the body in an outline.
local function panel(name, value, body, w, h)
    local strip_h = s(30)
    local inner = w - s(24)
    local label = U.text{ text = name, kind = "display", size = 14, color = "ink", upper = true, tracked = true }
    local reading = U.text{ text = value or "", kind = "display", size = 14, color = "ink", upper = true }
    local strip = U.Box:new{ width = w, height = strip_h, fill = "fg", pad_l = s(12), pad_r = s(12),
        U.Layers:new{
            width = inner, height = label:getSize().h,
            { label, x = 0, y = 0 },
            { reading, x = inner - reading:getSize().w, y = 0 },
        } }
    local body_h = h and (h - strip_h) or (body:getSize().h + 2 * s(8))
    return U.column({
        strip,
        U.Box:new{ width = w, height = body_h, line = "fg", pad_l = s(12), pad_r = s(12), pad_t = s(7), pad_b = s(7),
            valign = "top", body },
    }, 0)
end

local function pair(left, right, w, gap)
    local lw = math.floor((w - gap) / 2)
    local lb, rb = left.body(lw - s(24)), right.body(lw - s(24))
    local h = math.max(lb:getSize().h, rb:getSize().h) + s(14) + s(30)
    return U.row({
        panel(left.name, left.value, lb, lw, h),
        panel(right.name, right.value, rb, w - lw - gap, h),
    }, gap, "top")
end

function M.build(app, w, h)
    local head = U.header{ width = w, path = "root@kindle // sys.monitor", title = "Diagnostics", on_back = function() app:back() end,
        right = { U.button{ text = "Rescan", kind = "outline", size = 14, height = s(44), cuts = { tr = s(10), bl = s(10) },
            callback = function() app:rebuild(true) end } } }
    local key_w = s(96)
    local gap = s(12)
    local items = { head, U.vspace(s(14)) }

    -- POWER CELL
    local b = D.battery()
    local power_body
    if b then
        local state = b.charging and "CHARGING" or (b.charged and "FULL" or "DISCHARGING")
        local drain = "MEASURING..."
        if b.drain then drain = string.format("%.1f%%/H // ~%dH LEFT", b.drain, math.floor(b.left + 0.5)) end
        if b.charging or b.charged then drain = "--" end
        power_body = U.column({
            U.blocks(w - s(24), s(14), b.pct / 100, 24),
            U.vspace(s(6)),
            U.kv({
                { "State", state },
                { "Drain", drain },
                { "Charged", b.charged_at and D.ago(b.charged_at) or "--" },
            }, math.floor(key_w * 1.4), w - s(24), 11, s(2)),
        }, 0)
    else
        power_body = U.kv({ { "State", "MAINS // NO BATTERY" } }, math.floor(key_w * 1.4), w - s(24), 11, s(2))
    end
    table.insert(items, panel("Power cell", b and (b.pct .. "%") or "--", power_body, w))
    table.insert(items, U.vspace(gap))

    -- CORE and UPLINK
    local cpu = D.cpu()
    local info = D.cpuInfo()
    local mem = D.mem()
    local proc = D.process()
    local wifi = Wifi.available() and Wifi.state() or nil
    local ok_net, connected = pcall(function() return require("ui/network/manager"):isConnected() end)
    local net_on = wifi and wifi.connected or (not wifi and ok_net and connected)
    table.insert(items, pair(
        { name = "Core", value = cpu and (cpu .. "%") or "--%", body = function(bw)
            local rows = {
                U.blocks(bw, s(12), (cpu or 0) / 100, 16), U.vspace(s(6)),
                U.kv({
                    { "Clock", info.mhz and (info.mhz .. " MHZ") or "--" },
                    { "Cores", info.cores and (string.format("%d\u{00D7} ", info.cores) .. (info.name or "")) or "--" },
                    { "Load", D.loadavg() or "--" },
                    { "Mem", mem and string.format("%d MB / %d MB", (mem.total - mem.avail) / 1e6, mem.total / 1e6) or "--" },
                }, key_w, bw, 11, s(2)),
            }
            if mem then
                table.insert(rows, U.vspace(s(4)))
                table.insert(rows, U.blocks(bw, s(12), mem.pct / 100, 16))
                table.insert(rows, U.vspace(s(4)))
            end
            table.insert(rows, U.kv({ { "Proc", proc.rss and string.format("%d MB // %s THR", proc.rss / 1e6, proc.threads or "?") or "--" } }, key_w, bw, 11, s(2)))
            return U.column(rows, 0)
        end },
        { name = "Uplink", value = net_on and "Active" or "Offline", body = function(bw)
            local port = D.ssh()
            return U.kv({
                { "Node", wifi and wifi.ssid and U.upper(wifi.ssid) or (net_on and "CONNECTED" or "--") },
                { "Addr", net_on and D.address() or "--" },
                { "Wi-Fi", wifi and (wifi.on and "ON" or "OFF") or "N/A" },
                { "SSH", port and string.format("OPEN :%d", port) or "CLOSED" },
                { "Server", app.offline and "UNREACHABLE" or (app:account() and "ONLINE" or "NO ACCOUNT") },
            }, key_w, bw, 11, s(2))
        end },
        w, gap))
    table.insert(items, U.vspace(gap))

    -- STORAGE and OPTICS
    local disk = D.storage()
    local idx = require("br_search").index
    local archive = "--"
    if idx and idx.files then
        local bytes = 0
        local lfs = require("libs/libkoreader-lfs")
        for _, e in ipairs(idx.files) do bytes = bytes + (lfs.attributes(e.local_file, "size") or 0) end
        archive = string.format("%d FILES // %s", #idx.files, D.size(bytes))
    end
    local scr = D.screen()
    table.insert(items, pair(
        { name = "Storage", value = disk and string.format("%d%%", math.floor(100 * disk.used / math.max(1, disk.total) + 0.5)) or "--",
            body = function(bw)
                return U.column({
                    U.kv({ { "Internal", disk and string.format("%s / %s", D.size(disk.used), D.size(disk.total)) or "--" } }, key_w, bw, 11, s(2)),
                    U.vspace(s(4)),
                    U.blocks(bw, s(12), disk and disk.used / math.max(1, disk.total) or 0, 16),
                    U.vspace(s(4)),
                    U.kv({ { "Archive", archive } }, key_w, bw, 11, s(2)),
                }, 0)
            end },
        { name = "Optics", value = scr.night and "Inverted" or "", body = function(bw)
            return U.kv({
                { "Panel", string.format("%d\u{00D7}%d @%d", scr.w, scr.h, scr.dpi) },
                { "Depth", scr.colour and "COLOUR" or "GREYSCALE" },
                { "Lumen", scr.light and string.format("%d/%d", scr.light, scr.light_max or 0) or "--" },
                { "Mode", (scr.landscape and "LANDSCAPE" or "PORTRAIT") .. " // INVERT " .. (scr.night and "ON" or "OFF") },
                { "Input", scr.touch and "TOUCH" or "KEYS" },
            }, key_w, bw, 11, s(2))
        end },
        w, gap))
    table.insert(items, U.vspace(gap))

    -- UPTIME
    local up = D.uptime()
    local ko = os.time() - D.started
    local sleep = D.sleep() or 0
    table.insert(items, panel("Uptime", hours(up), U.column({
        U.kv({ { "Device", hours(up) }, { "KOReader", hours(ko) } }, math.floor(key_w * 1.4), w - s(24), 11, s(2)),
        U.vspace(s(4)),
        U.blocks(w - s(24), s(12), up and ko / math.max(1, up) or 0, 24),
        U.vspace(s(4)),
        U.kv({
            { "Awake", hours(math.max(0, ko - sleep)) .. " // SLEEP " .. hours(sleep) },
            { "Wakes", tostring(D.sleeps) },
            { "Slept at", D.slept_at and os.date("%H:%M", D.slept_at) or "--" },
        }, math.floor(key_w * 1.4), w - s(24), 11, s(2)),
    }, 0), w))

    local plugins = D.plugins()
    local footer = U.column({
        U.text{ text = string.format("%s // KOREADER %s // KERNEL %s", U.upper(D.model()), D.koreader(), U.upper(D.kernel())),
            kind = "mono", size = 11, color = "muted", max_width = w },
        U.text{ text = string.format("MODULES %d/%d // DICTS %d // FONTS %d // UTC%s", plugins.loaded, plugins.all,
            D.dictionaries(), D.fonts(), os.date("%z")), kind = "mono", size = 11, color = "muted", max_width = w },
    }, s(2))
    local col = U.column(items, 0)
    if col:getSize().h + s(12) + footer:getSize().h <= h then
        return U.column({ col, U.vspace(s(12)), footer }, 0)
    end
    return col
end

return M
