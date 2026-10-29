--[[--
CyberUI file dossier: one book.

  * its cover, title and author; format and size, pages, when it was added and last opened, the
    collections it is in;
  * DECRYPTED 42% and its status, the progress as a heartbeat;
  * the synopsis (the book's description), a few lines at a time: tap it for the next lines;
  * how many highlights, notes and bookmarks it has;
  * OPEN FILE; MARK DONE (or MARK UNREAD when it is done); COLLECTION + (add it to collections
    or take it out, or start a new one); SHOW FOLDER (in the library); RENAME, MOVE TO and
    DELETE, which keep KOReader's reading position, history and collections in step (as the
    file browser does).

Opened with a long-press on a book anywhere in CyberUI, or a tap on the active file's cover.
]]

local ConfirmBox = require("ui/widget/confirmbox")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local ffiUtil = require("ffi/util")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local _ = require("gettext")
local T = ffiUtil.template

local Cover = require("cy_cover")
local D = require("cy_data")
local U = require("cy_ui")
local s = U.s

local M = {}

local STATUS = { new = "UNREAD", reading = "READING", complete = "DONE", abandoned = "ON HOLD" }

local function fileManager()
    local ok, FileManager = pcall(require, "apps/filemanager/filemanager")
    return ok and FileManager.instance or nil
end

--- After a file moved: everything that remembers it, as KOReader's file browser does.
local function moved(from, to)
    pcall(function() require("docsettings").updateLocation(from, to) end)
    pcall(function() require("readhistory"):updateItem(from, to) end)
    pcall(function() require("readcollection"):updateItem(from, to) end)
    D.forget(from)
    require("br_search").index = nil
end

local function moveTo(app, args, dest)
    local from = args.file
    if lfs.attributes(dest) then
        UIManager:show(InfoMessage:new{ text = T(_("There is already a file called:\n%1"), dest) })
        return
    end
    local fm = fileManager()
    local ok = fm and fm:moveFile(from, dest) or os.rename(from, dest)
    if not ok then
        UIManager:show(InfoMessage:new{ text = T(_("Could not move the file to:\n%1"), dest) })
        return
    end
    moved(from, dest)
    args.file = dest
    app:rebuild(true)
end

local function rename(app, args)
    local InputDialog = require("ui/widget/inputdialog")
    local dialog
    dialog = InputDialog:new{
        title = _("Rename file"),
        input = ffiUtil.basename(args.file),
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            { text = _("Rename"), is_enter_default = true, callback = function()
                local name = dialog:getInputText()
                UIManager:close(dialog)
                if name == "" or name:find("/", 1, true) or name == ffiUtil.basename(args.file) then return end
                moveTo(app, args, ffiUtil.dirname(args.file) .. "/" .. name)
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

local function move(app, args)
    local PathChooser = require("ui/widget/pathchooser")
    UIManager:show(PathChooser:new{
        select_directory = true, select_file = false, show_files = false,
        path = ffiUtil.dirname(args.file),
        onConfirm = function(dir)
            if dir == ffiUtil.dirname(args.file) then return end
            moveTo(app, args, dir .. "/" .. ffiUtil.basename(args.file))
        end,
    })
end

local function delete(app, args)
    UIManager:show(ConfirmBox:new{
        text = T(_("Delete this book from the device?\n\n%1"), ffiUtil.basename(args.file)),
        ok_text = _("Delete"),
        ok_callback = function()
            local file = args.file
            local fm = fileManager()
            local ok
            if fm then
                ok = fm:deleteFile(file, true)
            else
                ok = os.remove(file)
                if ok then
                    pcall(function() require("docsettings").updateLocation(file) end)
                    pcall(function() require("readhistory"):fileDeleted(file) end)
                    pcall(function() require("readcollection"):removeItem(file) end)
                end
            end
            if ok then
                D.forget(file)
                require("br_search").index = nil
                app:back()
            end
        end,
    })
end

--- Marks the book done, or (when it is done) back to reading.
local function toggleDone(app, args, status)
    local ok, err = pcall(function()
        local ds = require("docsettings"):open(args.file)
        local summary = ds:readSetting("summary") or {}
        summary.status = status == "complete" and "reading" or "complete"
        summary.modified = os.date("%Y-%m-%d", os.time())
        ds:saveSetting("summary", summary)
        ds:flush()
    end)
    if not ok then logger.warn("CyberUI: could not change the status", err) end
    D.forget(args.file)
    app:rebuild()
end

--- Adds the book to a collection, or takes it out (and "+ New cache").
local function collections(app, args)
    local RC = D.readCollection()
    if not RC then return end
    local choices = {}
    local member = {}
    for _, c in ipairs(D.collections()) do
        local inside = false
        for _, f in ipairs(c.files) do if f == args.file then inside = true break end end
        member[c.name] = inside
        table.insert(choices, { text = c.label, key = c.name, on = inside })
    end
    table.insert(choices, { text = "+ New cache", key = "\0new" })
    local function done()
        pcall(RC.write, RC)
        app:rebuild()
    end
    U.popup{
        title = "Collections",
        choices = choices,
        selected = nil,
        on_select = function(key)
            if key == "\0new" then
                require("cy_caches").newCollection(app, function(name)
                    RC:addItem(args.file, name)
                    done()
                end)
                return
            end
            if member[key] then RC:removeItem(args.file, key, true) else RC:addItem(args.file, key) end
            done()
        end,
    }
end

function M.build(app, w, h, route)
    local args = route.args
    if not args.file or lfs.attributes(args.file, "mode") ~= "file" then
        return U.column({
            U.header{ width = w, path = args.from, title = "File dossier", on_back = function() app:back() end },
            U.vspace(s(20)),
            U.text{ text = "FILE NOT FOUND", kind = "display", size = 18, color = "accent", tracked = true },
        })
    end
    local d = D.dossier(args.file)
    local head = U.header{ width = w, path = args.from or "LIBRARY", title = "File dossier", on_back = function() app:back() end }

    -- the cover and the facts
    local cover_w = math.min(s(120), math.floor(w * 0.24))
    local cover_h = math.floor(cover_w * 1.45)
    local cover = Cover.framed(d.file, d.title, d.author, cover_w, cover_h, { style = "image" })
    local text_w = w - cover_w - s(18)
    local key_w = s(90)
    local caches = D.collectionsOf(d.file)
    local facts = U.column({
        U.textbox{ text = d.title, kind = "display", size = 20, color = "fg", upper = true, tracked = true,
            width = text_w, height = U.lineHeight("display", 20) * 3 },
        U.text{ text = d.author or "?", kind = "body", size = 15, color = "muted", max_width = text_w },
        U.vspace(s(6)),
        U.kv({
            { "Format", string.format("%s // %s", d.format, D.size(d.size)) },
            { "Pages", d.pages and tostring(d.pages) or "?" },
            { "Added", d.added and os.date("%Y-%m-%d", d.added) or "?" },
            { "Opened", d.opened and D.ago(d.opened) or "NEVER" },
            { "Caches", #caches > 0 and table.concat(caches, ", ") or "--" },
        }, key_w, text_w, 12),
    }, s(2))
    local top = U.row({ cover, facts }, s(18), "top")

    -- progress
    local pct = d.status == "complete" and 1 or (d.percent or 0)
    local prog_label = U.label(string.format("Decrypted %d%%", math.floor(pct * 100 + 0.5)), w, STATUS[d.status] or "")

    -- the synopsis, a few lines at a time
    local syn_lines = 2
    local syn_w = w - 2 * s(16)
    local syn = U.textbox{ text = d.description or "No synopsis in this file.", kind = "body", size = 15,
        color = d.description and "fg" or "muted", width = syn_w, height = U.lineHeight("body", 15) * syn_lines }
    local total = math.max(1, math.ceil(syn:getAllLineCount() / syn_lines))
    args.syn = math.min(args.syn or 1, total)
    for _ = 2, args.syn do syn:scrollDown() end
    local syn_label = U.text{ text = "SYNOPSIS", kind = "mono", size = 11, color = "muted" }
    local more = U.text{ text = string.format("%d/%d %s", args.syn, total, total > 1 and "\u{25BC}" or ""), kind = "mono", size = 11, color = "muted" }
    local lh = syn_label:getSize().h
    local syn_h = lh + syn:getSize().h + more:getSize().h + s(12)
    local synopsis = U.Tap:new{
        callback = function()
            args.syn = args.syn % total + 1
            app:rebuild()
        end,
        U.Layers:new{
            width = w, height = syn_h,
            { U.Painter:new{ width = w, height = syn_h, paint = function(bb, x, y, pw, ph)
                local t, arm = math.max(2, s(1.5)), s(16)
                local c = U.col("fg")
                local Pal = require("cy_palette")
                local top_y = y + math.floor(lh / 2)
                Pal.fill(bb, x, top_y, s(10), t, c); Pal.fill(bb, x, top_y, t, arm, c)
                Pal.fill(bb, x + pw - arm, top_y, arm, t, c); Pal.fill(bb, x + pw - t, top_y, t, arm, c)
                Pal.fill(bb, x, y + ph - t, arm, t, c); Pal.fill(bb, x, y + ph - arm, t, arm, c)
                Pal.fill(bb, x + pw - arm, y + ph - t, arm, t, c); Pal.fill(bb, x + pw - t, y + ph - arm, t, arm, c)
            end }, x = 0, y = 0 },
            { syn_label, x = s(16), y = 0 },
            { syn, x = s(16), y = lh + s(4) },
            { more, x = w - s(16) - more:getSize().w, y = syn_h - more:getSize().h - s(6) },
        },
    }

    -- counts
    local cw = math.floor((w - 2 * s(12)) / 3)
    local function count(n, label)
        return U.Box:new{ width = cw, height = s(62), line = "fg", cuts = { tr = s(12), bl = s(12) }, align = "center",
            U.column({
                U.text{ text = string.format("%02d", n), kind = "mono", size = 24, color = "fg" },
                U.text{ text = label, kind = "mono", size = 11, color = "fg", upper = true },
            }, s(2), "center") }
    end
    local counts = U.row({ count(d.highlights, "Highlights"), count(d.notes, "Notes"), count(d.bookmarks, "Bookmarks") }, s(12))

    -- actions
    local bh = s(42)
    local third = math.floor((w - 2 * s(12)) / 3)
    local open = U.button{ text = "Open file", icon = "forward", kind = "accent", width = w, height = bh + s(4), size = 15,
        cuts = { tl = s(12), br = s(12) }, callback = function() app:openBook(d.file) end }
    local row1 = U.row({
        U.button{ text = d.status == "complete" and "Mark unread" or "Mark done", kind = "outline", width = third, height = bh,
            size = 13, cuts = { tr = s(10), bl = s(10) }, pad = s(6), callback = function() toggleDone(app, args, d.status) end },
        U.button{ text = "Collection +", kind = "outline", width = third, height = bh, size = 13, cuts = { tr = s(10), bl = s(10) },
            pad = s(6), callback = function() collections(app, args) end },
        U.button{ text = "Show folder", kind = "outline", width = third, height = bh, size = 13, cuts = { tr = s(10), bl = s(10) },
            pad = s(6), callback = function()
                app:go("library", { dir = ffiUtil.dirname(d.file), page = 1, filter = "all" })
            end },
    }, s(12))
    local row2 = U.row({
        U.button{ text = "Rename", icon = "rename", kind = "outline", width = third, height = bh, size = 14,
            cuts = { tr = s(10), bl = s(10) }, callback = function() rename(app, args) end },
        U.button{ text = "Move to", icon = "move", kind = "outline", width = third, height = bh, size = 14,
            cuts = { tr = s(10), bl = s(10) }, callback = function() move(app, args) end },
        U.button{ text = "Delete", icon = "trash", kind = "danger", width = third, height = bh, size = 14,
            cuts = { tr = s(10), bl = s(10) }, callback = function() delete(app, args) end },
    }, s(12))

    local gap = s(12)
    local blocks = { head, top, prog_label, U.progress(w, pct), synopsis, counts, open, row1, row2 }
    local used = 0
    for _, b in ipairs(blocks) do used = used + b:getSize().h end
    used = used + gap * (#blocks - 1)
    if used > h then
        -- a short screen (landscape): the counts go first, then the progress line
        table.remove(blocks, 6)
        used = used - counts:getSize().h - gap
        if used > h then table.remove(blocks, 4) end
    end
    return U.column(blocks, gap)
end

return M
