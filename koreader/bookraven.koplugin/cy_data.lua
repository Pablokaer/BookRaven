--[[--
What the CyberUI screens show: books, folders, collections, reading telemetry and the device.

  * Books: title and author (KOReader's book information, else the file name), status and
    progress (BookList's cache: new, reading, complete, abandoned), when they were last opened
    (the reading history) and their annotations.
  * Folders: a folder's books and sub-folders, with counts.
  * Collections: KOReader's own (ReadCollection), favourites first.
  * Telemetry: KOReader's statistics database (the Reading statistics plugin): time and pages
    this week, minutes per day, a 12-week activity grid, the reading streak and the last
    sessions. Nothing when the plugin has never recorded anything.
  * The device: CPU load (two samples of /proc/stat), memory, battery (and its drain, measured
    while the plugin runs), Wi-Fi and address, SSH, storage, screen, uptime, sleep.

Everything is read when a screen is drawn; nothing runs in the background.
]]

local DataStorage = require("datastorage")
local Device = require("device")
local DocumentRegistry = require("document/documentregistry")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local Screen = Device.screen

local Covers = require("br_covers")
local Settings = require("br_settings")

local D = {
    started = os.time(),
    sleeps = 0, -- times the device went to sleep while KOReader ran (main.lua counts them)
    slept_at = nil,
}

-- ------------------------------------------------------------------ small helpers

local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local data = f:read("*a")
    f:close()
    return data
end

--- "NOW", "12M AGO", "2H AGO", "3D AGO", "5W AGO".
function D.ago(t)
    if not t then return "--" end
    local d = os.time() - t
    if d < 60 then return "NOW" end
    if d < 3600 then return string.format("%dM AGO", math.floor(d / 60)) end
    if d < 86400 then return string.format("%dH AGO", math.floor(d / 3600)) end
    if d < 86400 * 14 then return string.format("%dD AGO", math.floor(d / 86400)) end
    return string.format("%dW AGO", math.floor(d / (86400 * 7)))
end

--- "6:40" (hours:minutes) or "46M".
function D.hm(seconds)
    seconds = math.floor(seconds or 0)
    local h, m = math.floor(seconds / 3600), math.floor(seconds % 3600 / 60)
    return string.format("%d:%02d", h, m)
end

function D.duration(seconds)
    seconds = math.floor(seconds or 0)
    if seconds >= 3600 then
        return string.format("%dH %02dM", math.floor(seconds / 3600), math.floor(seconds % 3600 / 60))
    end
    return string.format("%dM", math.max(0, math.floor(seconds / 60)))
end

function D.size(bytes)
    bytes = tonumber(bytes) or 0
    if bytes >= 1e9 then return string.format("%.1f GB", bytes / 1e9) end
    if bytes >= 1e6 then return string.format("%.1f MB", bytes / 1e6) end
    return string.format("%d KB", math.floor(bytes / 1e3 + 0.5))
end

function D.isBook(path)
    local ok, has = pcall(DocumentRegistry.hasProvider, DocumentRegistry, path)
    return ok and has and true or false
end

-- ------------------------------------------------------------------ books

local describe -- br_gallery's, loaded late (it needs the plugin's modules)

--- Title and author of a book file.
function D.describe(file)
    describe = describe or require("br_gallery").describe
    local ok, title, author = pcall(describe, file)
    if ok then return title, author end
    return file:match("([^/]+)$"), nil
end

--- { status = "new" | "reading" | "complete" | "abandoned", percent, pages, annotated }
function D.status(file)
    local info
    local ok, BookList = pcall(require, "ui/widget/booklist")
    if ok and BookList and BookList.getBookInfo then
        local ok2, res = pcall(BookList.getBookInfo, file)
        if ok2 then info = res end
    end
    if not info then
        local ok3, ds = pcall(function() return require("docsettings"):open(file) end)
        if ok3 and ds then
            local summary = ds:readSetting("summary")
            info = { been_opened = ds:readSetting("percent_finished") ~= nil,
                percent_finished = ds:readSetting("percent_finished"), status = summary and summary.status }
        end
    end
    info = info or {}
    local status = info.been_opened and (info.status or "reading") or "new"
    return {
        status = status,
        percent = info.percent_finished or 0,
        pages = info.pages,
        annotated = info.has_annotations,
    }
end

--- Forgets what BookList knows about a book (after it was read, marked done…).
function D.forget(file)
    local ok, BookList = pcall(require, "ui/widget/booklist")
    if ok and BookList and BookList.resetBookInfoCache then pcall(BookList.resetBookInfoCache, file) end
end

--- When each book was last opened: { [file] = time }.
function D.lastOpened()
    local map = {}
    local ok, ReadHistory = pcall(require, "readhistory")
    if ok and ReadHistory then
        for _, item in ipairs(ReadHistory.hist or {}) do
            if item.file and item.time then map[item.file] = item.time end
        end
    end
    return map
end

--- The history: files on the device, most recent first.
function D.history(limit)
    local list = {}
    local ok, ReadHistory = pcall(require, "readhistory")
    if not ok or not ReadHistory then return list end
    for _, item in ipairs(ReadHistory.hist or {}) do
        if item.file and lfs.attributes(item.file, "mode") == "file" then
            table.insert(list, { file = item.file, time = item.time })
            if limit and #list >= limit then break end
        end
    end
    return list
end

--- Everything the dossier shows about a book.
function D.dossier(file)
    local title, author = D.describe(file)
    local attr = lfs.attributes(file) or {}
    local st = D.status(file)
    local t = {
        file = file, title = title, author = author,
        format = (util.getFileNameSuffix(file) or ""):upper(),
        size = attr.size, added = attr.modification,
        status = st.status, percent = st.percent, pages = st.pages,
        highlights = 0, notes = 0, bookmarks = 0,
    }
    t.opened = D.lastOpened()[file]
    local ok, ds = pcall(function() return require("docsettings"):open(file) end)
    if ok and ds then
        local props = ds:readSetting("doc_props") or {}
        t.description = props.description
        t.pages = t.pages or ds:readSetting("doc_pages")
        t.series = props.series
        t.language = props.language
        for _, a in ipairs(ds:readSetting("annotations") or {}) do
            if a.pos0 then
                if a.note and a.note ~= "" then t.notes = t.notes + 1 else t.highlights = t.highlights + 1 end
            else
                t.bookmarks = t.bookmarks + 1
            end
        end
    end
    if not t.description then
        local ok_bim, BookInfoManager = pcall(require, "bookinfomanager")
        if ok_bim and BookInfoManager then
            local ok2, info = pcall(BookInfoManager.getBookInfo, BookInfoManager, file, false)
            if ok2 and info then
                t.description = info.description
                t.pages = t.pages or info.pages
            end
        end
    end
    if type(t.description) == "string" then
        t.description = t.description:gsub("<[^>]+>", " "):gsub("&nbsp;", " "):gsub("&amp;", "&")
            :gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&quot;", "\""):gsub("%s+", " "):gsub("^ ", "")
        if t.description == "" then t.description = nil end
    end
    return t
end

-- ------------------------------------------------------------------ folders

--- The library's root: KOReader's home folder.
function D.root()
    local home = G_reader_settings:readSetting("home_dir") or Device.home_dir
    if home and lfs.attributes(home, "mode") == "directory" then return (home:gsub("/+$", "")) end
    return G_reader_settings:readSetting("lastdir") or "/"
end

--- A folder's sub-folders and books: dirs { path, name, count, sample = a book inside },
--- books { file, title, author, mtime }.
function D.folder(dir)
    local dirs, books = {}, {}
    if lfs.attributes(dir, "mode") ~= "directory" then return dirs, books end
    for name in lfs.dir(dir) do
        if name:sub(1, 1) ~= "." then
            local path = dir .. "/" .. name
            local attr = lfs.attributes(path)
            if attr and attr.mode == "directory" and not name:match("%.sdr$") then
                table.insert(dirs, { path = path, name = name })
            elseif attr and attr.mode == "file" and D.isBook(path) then
                local title, author = D.describe(path)
                table.insert(books, { file = path, title = title, author = author, mtime = attr.modification })
            end
        end
    end
    for _, d in ipairs(dirs) do
        local n, sample = 0, nil
        for name in lfs.dir(d.path) do
            if name:sub(1, 1) ~= "." then
                local path = d.path .. "/" .. name
                if lfs.attributes(path, "mode") == "file" and D.isBook(path) then
                    n = n + 1
                    sample = sample or path
                end
            end
        end
        d.count, d.sample = n, sample
    end
    table.sort(dirs, function(a, b) return a.name:lower() < b.name:lower() end)
    table.sort(books, function(a, b) return (a.title or ""):lower() < (b.title or ""):lower() end)
    return dirs, books
end

-- ------------------------------------------------------------------ collections

local function collections()
    local ok, RC = pcall(require, "readcollection")
    if not ok or not RC then return nil end
    pcall(RC._read, RC)
    return RC
end
D.readCollection = collections

--- KOReader's collections, favourites first: { name, label, files = { ordered paths }, default }.
function D.collections()
    local RC = collections()
    local list = {}
    if not RC or not RC.coll then return list end
    for name in pairs(RC.coll) do
        local files = {}
        local ok, ordered = pcall(RC.getOrderedCollection, RC, name)
        for _, item in ipairs(ok and ordered or {}) do
            if item.file and lfs.attributes(item.file, "mode") == "file" then table.insert(files, item.file) end
        end
        local fav = name == RC.default_collection_name
        table.insert(list, {
            name = name,
            label = fav and "Favorites" or name,
            files = files,
            favorites = fav,
            order = (RC.coll_settings[name] or {}).order or 999,
        })
    end
    table.sort(list, function(a, b)
        if a.favorites ~= b.favorites then return a.favorites end
        return a.order < b.order
    end)
    return list
end

--- The collections a book is in (their labels).
function D.collectionsOf(file)
    local out = {}
    for _, c in ipairs(D.collections()) do
        for _, f in ipairs(c.files) do
            if f == file then table.insert(out, c.label); break end
        end
    end
    return out
end

-- ------------------------------------------------------------------ telemetry

local function statsDb()
    local path = DataStorage:getSettingsDir() .. "/statistics.sqlite3"
    if lfs.attributes(path, "mode") ~= "file" then return nil end
    local ok, SQ3 = pcall(require, "lua-ljsqlite3/init")
    if not ok then return nil end
    local ok2, conn = pcall(SQ3.open, path)
    return ok2 and conn or nil
end

local function midnight(t)
    local d = os.date("*t", t)
    return os.time{ year = d.year, month = d.month, day = d.day, hour = 0 }
end

local function dayKey(t) return os.date("%Y-%m-%d", t) end

--- The reading telemetry, or nil without statistics. goal: daily minutes.
function D.telemetry()
    local conn = statsDb()
    if not conn then return nil end
    local ok, res = pcall(function()
        local today = midnight(os.time())
        local wday = tonumber(os.date("%w", today)) -- 0 = Sunday
        local week_start = today - wday * 86400 -- (DST: os.date below keeps the days right)
        local grid_start = week_start - 11 * 7 * 86400
        local t = {
            days = {}, today = wday + 1, heat = {}, sessions = {},
            week_time = 0, week_pages = 0, today_min = 0, streak = 0, best = 0,
        }
        -- seconds and pages per day, for the last 12 weeks
        local per_day = {}
        local rows = conn:exec(string.format([[
            SELECT strftime('%%Y-%%m-%%d', start_time, 'unixepoch', 'localtime') AS day,
                   sum(duration) AS secs, count(DISTINCT id_book || '-' || page) AS pages
            FROM page_stat_data WHERE start_time >= %d GROUP BY day;]], grid_start - 86400))
        if rows and rows[1] then
            for i = 1, #rows[1] do
                per_day[rows[1][i]] = { secs = tonumber(rows[2][i]) or 0, pages = tonumber(rows[3][i]) or 0 }
            end
        end
        for i = 0, 6 do
            local key = dayKey(week_start + i * 86400 + 3600 * 12)
            local d = per_day[key] or { secs = 0, pages = 0 }
            t.days[i + 1] = math.floor(d.secs / 60 + 0.5)
            t.week_time = t.week_time + d.secs
            t.week_pages = t.week_pages + d.pages
        end
        t.today_min = t.days[t.today]
        for w = 1, 12 do
            t.heat[w] = {}
            for d = 1, 7 do
                local day = grid_start + ((w - 1) * 7 + (d - 1)) * 86400 + 3600 * 12
                local rec = per_day[dayKey(day)]
                t.heat[w][d] = day > os.time() and -1 or (rec and math.floor(rec.secs / 60 + 0.5) or 0)
            end
        end
        -- the streak: days in a row with reading, up to today (or yesterday), and the best run
        local all = conn:exec([[
            SELECT DISTINCT strftime('%Y-%m-%d', start_time, 'unixepoch', 'localtime') AS day
            FROM page_stat_data ORDER BY day;]])
        local have = {}
        local days = all and all[1] or {}
        local run, prev = 0, nil
        for i = 1, #days do
            local key = days[i]
            have[key] = true
            local y, m, d = key:match("(%d+)-(%d+)-(%d+)")
            local tm = os.time{ year = tonumber(y), month = tonumber(m), day = tonumber(d), hour = 12 }
            if prev and math.floor((tm - prev) / 86400 + 0.5) == 1 then run = run + 1 else run = 1 end
            prev = tm
            if run > t.best then t.best = run end
        end
        local day = today + 3600 * 12
        if not have[dayKey(day)] then day = day - 86400 end
        while have[dayKey(day)] do
            t.streak = t.streak + 1
            day = day - 86400
        end
        -- sessions: a book's pages read with less than 10 minutes between them
        local titles = {}
        local books = conn:exec("SELECT id, title FROM book;")
        if books and books[1] then
            for i = 1, #books[1] do titles[tonumber(books[1][i])] = books[2][i] end
        end
        local recent = conn:exec([[
            SELECT id_book, start_time, duration, page FROM page_stat_data
            ORDER BY start_time DESC LIMIT 800;]])
        local cur
        if recent and recent[1] then
            for i = 1, #recent[1] do
                local id, start, dur, page = tonumber(recent[1][i]), tonumber(recent[2][i]), tonumber(recent[3][i]), recent[4][i]
                if cur and cur.id == id and cur.start - (start + dur) < 600 then
                    cur.start = start
                    cur.secs = cur.secs + dur
                    cur.pages[tostring(page)] = true
                else
                    if cur then table.insert(t.sessions, cur) end
                    if #t.sessions >= 20 then cur = nil; break end
                    cur = { id = id, title = titles[id] or "?", start = start, secs = dur, pages = { [tostring(page)] = true } }
                end
            end
        end
        if cur then table.insert(t.sessions, cur) end
        for _, sess in ipairs(t.sessions) do
            local n = 0
            for _ in pairs(sess.pages) do n = n + 1 end
            sess.npages = n
        end
        return t
    end)
    pcall(conn.close, conn)
    if not ok then
        logger.warn("CyberUI: could not read the statistics", res)
        return nil
    end
    return res
end

-- ------------------------------------------------------------------ the device

local last_cpu

--- CPU use since the last call, in percent (nil the first time).
function D.cpu()
    local line = (readFile("/proc/stat") or ""):match("^cpu%s+([^\n]+)")
    if not line then return nil end
    local total, idle, i = 0, 0, 0
    for n in line:gmatch("%d+") do
        i = i + 1
        n = tonumber(n)
        total = total + n
        if i == 4 or i == 5 then idle = idle + n end
    end
    local pct
    if last_cpu and total > last_cpu.total then
        pct = math.floor(100 * (1 - (idle - last_cpu.idle) / (total - last_cpu.total)) + 0.5)
    end
    last_cpu = { total = total, idle = idle }
    return pct and math.max(0, math.min(100, pct)) or nil
end

--- { total, avail, pct } in bytes.
function D.mem()
    local info = readFile("/proc/meminfo")
    if not info then return nil end
    local function kb(key) return tonumber(info:match(key .. ":%s+(%d+)")) end
    local total = kb("MemTotal")
    local avail = kb("MemAvailable") or ((kb("MemFree") or 0) + (kb("Buffers") or 0) + (kb("Cached") or 0))
    if not total or total == 0 then return nil end
    return { total = total * 1024, avail = avail * 1024, pct = math.floor(100 * (1 - avail / total) + 0.5) }
end

local function powerd()
    local ok, p = pcall(Device.getPowerDevice, Device)
    return ok and p or nil
end
D.powerd = powerd

local drain_from -- { time, capacity } while discharging

--- { pct, charging, charged, drain (%/h), left (hours), charged_at }
function D.battery()
    local p = powerd()
    if not p or not Device:hasBattery() then return nil end
    local ok, cap = pcall(p.getCapacity, p)
    if not ok or not cap then return nil end
    local _, charging = pcall(p.isCharging, p)
    local _, charged = pcall(p.isCharged, p)
    local b = { pct = cap, charging = charging == true, charged = charged == true }
    local now = os.time()
    if b.charging or b.charged then
        Settings.set("cyber_charged_at", now)
        drain_from = nil
    elseif not drain_from or cap > drain_from.capacity then
        drain_from = { time = now, capacity = cap }
    elseif now - drain_from.time >= 20 * 60 and drain_from.capacity > cap then
        b.drain = (drain_from.capacity - cap) / ((now - drain_from.time) / 3600)
        b.left = cap / b.drain
    end
    b.charged_at = Settings.get("cyber_charged_at")
    return b
end

--- Seconds since the device started.
function D.uptime()
    local up = tonumber((readFile("/proc/uptime") or ""):match("^([%d%.]+)"))
    return up and math.floor(up) or nil
end

function D.loadavg()
    return (readFile("/proc/loadavg") or ""):match("^(%S+ %S+ %S+)")
end

--- { mhz, cores, name }
function D.cpuInfo()
    local t = {}
    local khz = tonumber(readFile("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq") or "")
    if khz then t.mhz = math.floor(khz / 1000 + 0.5) end
    local info = readFile("/proc/cpuinfo") or ""
    local n = 0
    for _ in info:gmatch("\nprocessor%s*:") do n = n + 1 end
    if info:match("^processor%s*:") then n = n + 1 end
    t.cores = n > 0 and n or nil
    t.name = info:match("Hardware%s*:%s*([^\n]+)") or info:match("model name%s*:%s*([^\n]+)")
    return t
end

--- KOReader's own memory and threads.
function D.process()
    local st = readFile("/proc/self/status") or ""
    local rss = tonumber(st:match("VmRSS:%s+(%d+)"))
    return { rss = rss and rss * 1024, threads = tonumber(st:match("Threads:%s+(%d+)")) }
end

--- The device's IPv4 address on the network, if it has one.
function D.address()
    for _, cmd in ipairs({ "ip -4 -o addr show 2>/dev/null", "ifconfig 2>/dev/null" }) do
        local ok, out = pcall(function()
            local h = io.popen(cmd)
            if not h then return nil end
            local data = h:read("*a")
            h:close()
            return data
        end)
        if ok and out then
            for ip in out:gmatch("inet%s+a?d?d?r?:?(%d+%.%d+%.%d+%.%d+)") do
                if not ip:match("^127%.") then return ip end
            end
        end
    end
end

--- The port an SSH server listens on (KOReader's SSH plugin: 2222), or nil.
function D.ssh()
    for _, file in ipairs({ "/proc/net/tcp", "/proc/net/tcp6" }) do
        local data = readFile(file) or ""
        for port, state in data:gmatch("%s%x+:(%x%x%x%x)%s+%x+:%x+%s+(%x%x)") do
            local p = tonumber(port, 16)
            if state == "0A" and (p == 2222 or p == 22) then return p end
        end
    end
end

--- { total, used } of the library's storage.
function D.storage()
    local ok, usage = pcall(util.diskUsage, D.root())
    if ok and usage and usage.total then return usage end
end

function D.kernel()
    return ((readFile("/proc/sys/kernel/osrelease") or ""):gsub("%s+$", ""))
end

function D.koreader()
    local ok, Version = pcall(require, "version")
    if ok and Version then
        local ok2, v = pcall(Version.getCurrentRevision, Version)
        if ok2 and v then return (v:match("^(v[%d%.]+)") or v) end
    end
    return "?"
end

function D.model()
    return Device.model or (Device:isKindle() and "Kindle") or (Device:isEmulator() and "Emulator") or "Device"
end

--- Plugins: { loaded, all }.
function D.plugins()
    local all, disabled = 0, G_reader_settings:readSetting("plugins_disabled") or {}
    local seen = {}
    for _, dir in ipairs({ "plugins", DataStorage:getDataDir() .. "/plugins" }) do
        if lfs.attributes(dir, "mode") == "directory" then
            for name in lfs.dir(dir) do
                local key = name:match("^(.+)%.koplugin$")
                if key and not seen[key] then
                    seen[key] = true
                    all = all + 1
                end
            end
        end
    end
    local off = 0
    for key, v in pairs(disabled) do if v and seen[key] then off = off + 1 end end
    return { loaded = all - off, all = all }
end

function D.dictionaries()
    local n = 0
    local function walk(dir, depth)
        if depth > 3 or lfs.attributes(dir, "mode") ~= "directory" then return end
        for name in lfs.dir(dir) do
            if name ~= "." and name ~= ".." then
                local path = dir .. "/" .. name
                if name:match("%.ifo$") then n = n + 1
                elseif lfs.attributes(path, "mode") == "directory" then walk(path, depth + 1) end
            end
        end
    end
    walk(DataStorage:getDataDir() .. "/data/dict", 0)
    return n
end

function D.fonts()
    local ok, FontList = pcall(require, "fontlist")
    if ok and FontList then
        local ok2, list = pcall(FontList.getFontList, FontList)
        if ok2 and list then return #list end
    end
    return 0
end

--- Time spent asleep and in standby since KOReader started, in seconds.
function D.sleep()
    local ok, time = pcall(require, "ui/time")
    if not ok then return nil end
    local function secs(v)
        if not v then return 0 end
        local ok2, n = pcall(time.to_s, v)
        return ok2 and tonumber(n) or 0
    end
    return secs(Device.total_suspend_time) + secs(Device.total_standby_time)
end

--- The screen: { w, h, dpi, colour, light, light_max, landscape, night, touch }.
function D.screen()
    local t = {
        w = Screen:getWidth(), h = Screen:getHeight(), dpi = Screen:getDPI(),
        colour = require("cy_palette").colour(),
        night = G_reader_settings:isTrue("night_mode"),
        touch = Device:isTouchDevice(),
    }
    t.landscape = t.w > t.h
    local p = powerd()
    if p and Device:hasFrontlight() then
        local ok, v = pcall(p.frontlightIntensity, p)
        local ok_on, on = pcall(p.isFrontlightOn, p)
        t.light = ok and (ok_on and on == false and 0 or v) or nil
        t.light_max = p.fl_max
    end
    return t
end

--- The status bar's readings: { battery, cpu, mem }, CPU and memory unless turned off.
function D.readings()
    local t = {}
    local b = D.battery()
    t.battery = b and b.pct
    if Settings.get("cyber_telemetry") ~= false then
        t.cpu = D.cpu()
        local m = D.mem()
        t.mem = m and m.pct
    end
    return t
end

--- The cover of a book, from the cache or extracted now (path or nil).
function D.cover(file)
    local ok, path = pcall(Covers.forBook, Covers, file)
    return ok and path or nil
end

function D.cachedCover(file)
    local ok, path = pcall(Covers.cachedBook, Covers, file)
    return ok and path or nil
end

return D
