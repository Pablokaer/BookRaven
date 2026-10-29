--[[--
CyberUI caches: KOReader's collections, and the other shelves.

  * Favorites, pinned on top: its covers fanned out, PINNED // QUEUE;
  * every other collection as a card with up to four covers (empty slots when it has fewer);
  * the BookRaven catalog's shelves (UPLINK, when online with an account) and your folder
    shelves (MOUNT, from br_gallery), then + MOUNT to add a folder;
  * + NEW makes a collection. Tap a collection to see its books (cy_library); long-press it to
    rename or delete it (Favorites stays). Long-press a folder shelf to remove it.

Paged like the library (CACHE 01 / 02), with swipes too.
]]

local ConfirmBox = require("ui/widget/confirmbox")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local _ = require("gettext")
local T = require("ffi/util").template

local Cover = require("cy_cover")
local D = require("cy_data")
local Settings = require("br_settings")
local U = require("cy_ui")
local s = U.s

local M = {}

--- Asks for a name and makes a collection; then(name), or the screen is drawn again.
function M.newCollection(app, after, old)
    local RC = D.readCollection()
    if not RC then return end
    local InputDialog = require("ui/widget/inputdialog")
    local dialog
    dialog = InputDialog:new{
        title = old and _("Rename collection") or _("New collection"),
        input = old or "",
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            { text = old and _("Rename") or _("Create"), is_enter_default = true, callback = function()
                local name = dialog:getInputText():gsub("^%s+", ""):gsub("%s+$", "")
                UIManager:close(dialog)
                if name == "" or name == old then return end
                if RC.coll[name] then
                    UIManager:show(InfoMessage:new{ text = T(_("There is already a collection called \"%1\"."), name) })
                    return
                end
                if old then RC:renameCollection(old, name) else RC:addCollection(name) end
                pcall(RC.write, RC)
                if after then after(name) else app:rebuild() end
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

local function collectionMenu(app, c)
    if c.favorites then return end
    U.popup{
        title = c.label,
        choices = { { text = "Rename", key = "rename" }, { text = "Delete", key = "delete" } },
        on_select = function(key)
            local RC = D.readCollection()
            if key == "rename" then
                M.newCollection(app, nil, c.name)
            elseif key == "delete" then
                UIManager:show(ConfirmBox:new{
                    text = T(_("Delete the collection \"%1\"?\n\nIts books stay on the device."), c.label),
                    ok_text = _("Delete"),
                    ok_callback = function()
                        RC:removeCollection(c.name)
                        pcall(RC.write, RC)
                        app:rebuild()
                    end,
                })
            end
        end,
    }
end

--- The pinned favourites: covers fanned out, and the name.
local function pinned(app, c, w, h)
    local pad = s(18)
    local ch = h - 2 * pad - s(8)
    local cw = math.floor(ch / 1.45)
    local step = math.floor(cw * 0.32)
    local fan = U.Layers:new{ width = cw + step * 3, height = ch + s(8) }
    local n = math.min(4, #c.files)
    for i = 1, n do
        local file = c.files[i]
        local title = D.describe(file)
        table.insert(fan, { (Cover.framed(file, title, nil, cw, ch, { style = "image" })), x = (i - 1) * step,
            y = (n - i) * s(2) + (i == n and s(4) or 0) })
    end
    if n == 0 then
        for i = 1, 3 do
            table.insert(fan, { U.Painter:new{ width = cw, height = ch, paint = function(bb, x, y, pw, ph)
                U.frame(bb, x, y, pw, ph, math.max(2, s(1.5)), "fg", "bg", { tr = s(8) }) end }, x = (i - 1) * step, y = 0 })
        end
    end
    local text_w = w - 2 * pad - fan:getSize().w - s(24)
    local texts = U.column({
        U.text{ text = "PINNED // QUEUE", kind = "mono", size = 12, color = "muted" },
        U.text{ text = c.label, kind = "display", size = 28, color = "fg", upper = true, tracked = true, max_width = text_w },
        U.text{ text = string.format("%d FILE%s", #c.files, #c.files == 1 and "" or "S"), kind = "mono", size = 14, color = "fg" },
    }, s(6))
    return U.Tap:new{
        callback = function() app:go("library", { collection = c.name, title = c.label, page = 1, filter = "all", tab = "caches" }) end,
        U.Box:new{ width = w, height = h, line = "fg", cuts = { tl = s(14), br = s(14) }, padding = pad,
            U.row({ fan, texts }, s(24)) },
    }
end

--- A card: art on the left (four covers, or an icon), a name and a line under it.
local function card(args, w, h)
    local pad = s(10)
    local art_h = h - 2 * pad
    local art
    if args.files then
        local cw = math.floor((art_h - s(6)) / 2 / 1.35)
        local ch = math.floor((art_h - s(6)) / 2)
        local cells = {}
        for i = 1, 4 do
            local file = args.files[i]
            if file then
                local title = D.describe(file)
                cells[i] = (Cover.framed(file, title, nil, cw, ch, { style = "image" }))
            else
                cells[i] = U.Painter:new{ width = cw, height = ch, paint = function(bb, x, y, pw, ph)
                    U.frame(bb, x, y, pw, ph, math.max(2, s(1.5)), "fg", "bg", { tr = s(6) }) end }
            end
        end
        art = U.column({ U.row({ cells[1], cells[2] }, s(6)), U.row({ cells[3], cells[4] }, s(6)) }, s(6))
    else
        art = U.Box:new{ width = math.floor(art_h * 0.8), height = art_h, line = "fg", cuts = { tr = s(8) }, align = "center",
            U.icon(args.icon, s(30), args.icon_role or "fg") }
    end
    local text_w = w - 2 * pad - art:getSize().w - s(14)
    local texts = U.column({
        U.textbox{ text = args.title, kind = "semi", size = 17, color = "fg", width = text_w,
            height = U.lineHeight("semi", 17) * 2 },
        U.text{ text = args.sub, kind = "mono", size = 12, color = args.sub_role or "fg", upper = true, max_width = text_w },
    }, s(4))
    return U.Tap:new{
        callback = args.callback, hold_callback = args.hold,
        U.Box:new{ width = w, height = h, line = "fg", padding = pad, U.row({ art, texts }, s(14)) },
    }
end

function M.build(app, w, h, route)
    local args = route.args
    args.page = args.page or 1
    local head = U.header{ width = w, path = "/SYS/CACHES/", title = "Collections", on_back = function() app:back() end,
        right = { U.button{ text = "+ New", kind = "accent", size = 14, height = s(44), cuts = { tr = s(12) },
            callback = function() M.newCollection(app) end } } }

    local colls = D.collections()
    local fav
    local cards = {}
    for _, c in ipairs(colls) do
        if c.favorites then
            fav = c
        else
            table.insert(cards, { title = c.label, files = c.files,
                sub = string.format("%d FILE%s", #c.files, #c.files == 1 and "" or "S"),
                callback = function() app:go("library", { collection = c.name, title = c.label, page = 1, filter = "all", tab = "caches" }) end,
                hold = function() collectionMenu(app, c) end })
        end
    end
    if not app.offline and app:account() then
        for _, shelf in ipairs(app.cache.shelves or {}) do
            table.insert(cards, { title = shelf.title, icon = "uplink", sub = "UPLINK // BOOKRAVEN",
                callback = function() app:openShelf(shelf.url, shelf.title) end })
        end
    end
    local Shelves = require("br_gallery")
    for _, shelf in ipairs(Shelves.list()) do
        local n = Shelves.count(shelf.path)
        table.insert(cards, { title = shelf.title, icon = "folder",
            sub = n and string.format("MOUNT // %d FILE%s", n, n == 1 and "" or "S") or "MOUNT // MISSING", sub_role = n and "fg" or "accent",
            callback = function() app:go("library", { dir = shelf.path, page = 1, filter = "all", tab = "caches" }) end,
            hold = function() app:shelfHold({ kind = "folder", local_path = shelf.path, title = shelf.title }) end })
    end
    table.insert(cards, { title = "+ Mount", icon = "plus", sub = "A FOLDER AS A SHELF", sub_role = "muted",
        callback = function() app:addShelf() end })

    local gap = s(14)
    local pager_h = s(42)
    local area_top = head:getSize().h + s(16)
    local area_h = h - area_top - pager_h - s(14)
    local big_h = math.min(s(170), math.floor(area_h * 0.32))
    local card_h = s(118)
    local cols = w > h and 3 or 2
    local card_w = math.floor((w - (cols - 1) * gap) / cols)
    -- the first page has Favorites on top
    local first_rows = math.max(0, math.floor((area_h - big_h - gap + gap) / (card_h + gap)))
    local rows = math.max(1, math.floor((area_h + gap) / (card_h + gap)))
    local first_n = first_rows * cols
    local per = rows * cols
    local pages = 1 + math.max(0, math.ceil((#cards - first_n) / per))
    args.page = math.min(args.page, pages)
    local items = {}
    local from, to
    if args.page == 1 then
        if fav then table.insert(items, pinned(app, fav, w, big_h)) end
        from, to = 1, math.min(#cards, first_n)
    else
        from = first_n + (args.page - 2) * per + 1
        to = math.min(#cards, from + per - 1)
    end
    local row
    for i = from, to do
        if (i - from) % cols == 0 then
            row = U.row({}, 0, "top")
            table.insert(items, row)
        else
            table.insert(row, U.hspace(gap))
        end
        table.insert(row, card(cards[i], card_w, card_h))
    end
    app.pager = { page = args.page, pages = pages, go = function(n)
        args.page = n
        app:rebuild(Settings.get("cyber_flash") ~= false)
    end }
    return U.Layers:new{
        width = w, height = h,
        { head, x = 0, y = 0 },
        { U.column(items, gap), x = 0, y = area_top },
        { U.pager{ width = w, label = "Cache", page = args.page, pages = pages, on_page = app.pager.go }, x = 0, y = h - pager_h },
    }
end

return M
