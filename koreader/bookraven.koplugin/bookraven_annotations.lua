--[[--
Highlights, notes and bookmarks between KOReader and BookRaven.

Reads and writes the open book's annotations through KOReader's annotation module (KOReader
2024.07 and later: `ui.annotation.annotations`, one list of highlights, notes and bookmarks).
Older versions kept them in `ui.bookmark.bookmarks`: those are not supported, `isSupported`
says so and the plugin shows a message.

What each sync sends (see apps/api/src/routes/koreader.ts for the server's side):
- the annotations added or changed since the last sync of this book (all of them the first
  time), each with a stable id: "ko-<md5 of its position and creation time>" for those made in
  KOReader, the server's for those that came from BookRaven ("br-…"), kept in the item as
  `bookraven_id`;
- the ids synced before that are gone now (deleted here);
- the server's cursor from the last sync.
It gets back what changed on the server since then, and applies it.

Per book, in its sidecar (doc_settings "bookraven_sync"): the cursor, and a signature of each
synced annotation, to tell what changed since.

KOReader APIs used (from its source, frontend/apps/reader/modules/readerannotation.lua,
readerhighlight.lua, readerbookmark.lua; not run here, no KOReader was available when this was
written): ui.annotation.annotations, ui.annotation:addItem(item), the "AnnotationsModified"
event, ui.document:getPageFromXPointer / getPageCount / getPageTextBoxes /
getTextFromPositions, ui.doc_settings:readSetting / saveSetting, ffi/sha2 md5.

@module bookraven_annotations
]]

local Event = require("ui/event")
local logger = require("logger")
local md5 = require("ffi/sha2").md5

local Annotations = {}

local STATE_KEY = "bookraven_sync"

--- Whether this KOReader has the annotation module this plugin works with (2024.07+).
function Annotations.isSupported(ui)
    return ui ~= nil and ui.annotation ~= nil and type(ui.annotation.annotations) == "table"
end

local function isBookmark(item)
    return item.drawer == nil and item.pos0 == nil
end

--- A position as text: an XPointer, or a PDF position's page and coordinates.
local function positionKey(pos)
    if type(pos) == "table" then
        return string.format("%s:%s:%s", tostring(pos.page), tostring(pos.x), tostring(pos.y))
    end
    return tostring(pos)
end

--- The item's id for BookRaven, made once and kept in the item.
local function itemId(item)
    if type(item.bookraven_id) ~= "string" then
        local key = table.concat({
            tostring(item.datetime),
            positionKey(item.pos0),
            positionKey(item.pos1),
            positionKey(item.page),
        }, "|")
        item.bookraven_id = "ko-" .. md5(key)
    end
    return item.bookraven_id
end

--- What the server keeps of an item: when this changes, the item is sent again.
local function signature(item)
    return md5(table.concat({
        isBookmark(item) and "b" or "h",
        tostring(item.text or ""),
        tostring(item.note or ""),
        tostring(item.color or ""),
        tostring(item.drawer or ""),
        positionKey(item.pos0),
        positionKey(item.pos1),
        positionKey(item.page),
    }, "\0"))
end

--- A JSON-safe copy of a PDF position (numbers and strings only).
local function plainPosition(pos)
    if type(pos) ~= "table" then
        return pos
    end
    local out = {}
    for k, v in pairs(pos) do
        if type(k) == "string" and (type(v) == "number" or type(v) == "string" or type(v) == "boolean") then
            out[k] = v
        end
    end
    return out
end

local function plainBoxes(boxes)
    if type(boxes) ~= "table" or #boxes == 0 then
        return nil
    end
    local out = {}
    for i, box in ipairs(boxes) do
        if i > 500 then
            break
        end
        out[i] = plainPosition(box)
    end
    return out
end

local Sync = {}
Sync.__index = Sync

--- A sync of the book open in `ui`.
function Annotations.new(ui)
    local self = setmetatable({}, Sync)
    self.ui = ui
    self.document = ui.document
    self.paging = ui.paging ~= nil
    return self
end

function Sync:readState()
    local state = self.ui.doc_settings:readSetting(STATE_KEY)
    if type(state) ~= "table" or type(state.synced) ~= "table" then
        state = { synced = {} }
    end
    return state
end

function Sync:saveState(state)
    self.ui.doc_settings:saveSetting(STATE_KEY, state)
end

--- Where a bookmark is in the book, 0 to 1 (BookRaven sorts bookmarks by it).
function Sync:percentOf(item)
    local ok, percent = pcall(function()
        local count = self.document:getPageCount()
        local page = item.page
        if type(page) == "string" then
            page = self.document:getPageFromXPointer(page)
        end
        if type(page) ~= "number" or not count or count <= 1 then
            return nil
        end
        return math.max(0, math.min(1, (page - 1) / (count - 1)))
    end)
    return ok and percent or nil
end

--- An item as the server takes it.
function Sync:toWire(item)
    local bookmark = isBookmark(item)
    return {
        id = itemId(item),
        kind = bookmark and "bookmark" or "highlight",
        text = type(item.text) == "string" and item.text:sub(1, 10000) or nil,
        note = type(item.note) == "string" and item.note:sub(1, 5000) or nil,
        color = item.color,
        drawer = item.drawer,
        chapter = type(item.chapter) == "string" and item.chapter:sub(1, 500) or nil,
        datetime = item.datetime,
        pos0 = plainPosition(item.pos0),
        pos1 = plainPosition(item.pos1),
        page = item.page,
        pboxes = plainBoxes(item.pboxes),
        percent = bookmark and self:percentOf(item) or nil,
    }
end

--[[--
What to send: `{ since, changed, deleted }` for the server, and the signatures of what is sent.
]]
function Sync:collect()
    local state = self:readState()
    local first = state.cursor == nil
    local changed, present, signatures = {}, {}, {}
    for _, item in ipairs(self.ui.annotation.annotations) do
        local id = itemId(item)
        local sig = signature(item)
        present[id] = true
        signatures[id] = sig
        if first or state.synced[id] ~= sig then
            table.insert(changed, self:toWire(item))
        end
    end
    local deleted = {}
    for id in pairs(state.synced) do
        if not present[id] then
            table.insert(deleted, id)
        end
    end
    return state, changed, deleted, signatures
end

function Sync:findIndex(id)
    for i, item in ipairs(self.ui.annotation.annotations) do
        if itemId(item) == id then
            return i, item
        end
    end
    return nil
end

function Sync:notify(item, added_highlights, added_bookmarks)
    -- Lets the footer, the bookmark list and statistics follow (as readerhighlight does).
    local ok, err = pcall(function()
        self.ui:handleEvent(Event:new("AnnotationsModified", {
            item,
            nb_highlights_added = added_highlights,
            nb_bookmarks_added = added_bookmarks,
        }))
    end)
    if not ok then
        logger.warn("BookRaven: AnnotationsModified failed:", err)
    end
end

--- Normalized words of a text, for finding a passage on a PDF page.
local function words(text)
    local out = {}
    for word in tostring(text or ""):gmatch("%S+") do
        local w = word:lower():gsub("[%p%c]", "")
        if w ~= "" then
            table.insert(out, w)
        end
    end
    return out
end

--[[--
Finds a BookRaven PDF highlight's words on its page (KOReader needs coordinates, BookRaven has
the page and the text). Returns pos0, pos1 and the boxes, or nil when the text isn't found.
]]
function Sync:placeOnPage(page, text)
    local ok, result = pcall(function()
        local lines = self.document:getPageTextBoxes(page)
        if type(lines) ~= "table" then
            return nil
        end
        local boxes = {}
        for _, line in ipairs(lines) do
            for _, word in ipairs(line) do
                if type(word) == "table" and word.word then
                    local w = words(word.word)
                    if w[1] then
                        table.insert(boxes, { word = table.concat(w), box = word })
                    end
                end
            end
        end
        local wanted = words(text)
        if #wanted == 0 then
            return nil
        end
        for start = 1, #boxes - #wanted + 1 do
            local match = true
            for j = 1, #wanted do
                if boxes[start + j - 1].word ~= wanted[j] then
                    match = false
                    break
                end
            end
            if match then
                local first = boxes[start].box
                local last = boxes[start + #wanted - 1].box
                local pos0 = { page = page, x = (first.x0 + first.x1) / 2, y = (first.y0 + first.y1) / 2 }
                local pos1 = { page = page, x = (last.x0 + last.x1) / 2, y = (last.y0 + last.y1) / 2 }
                local pboxes
                local selected = self.document:getTextFromPositions(pos0, pos1)
                if type(selected) == "table" and type(selected.pboxes) == "table" then
                    pboxes = selected.pboxes
                    pos0 = selected.pos0 or pos0
                    pos1 = selected.pos1 or pos1
                else
                    pboxes = {}
                    for j = start, start + #wanted - 1 do
                        local b = boxes[j].box
                        table.insert(pboxes, { x = b.x0, y = b.y0, w = b.x1 - b.x0, h = b.y1 - b.y0 })
                    end
                end
                return { pos0 = pos0, pos1 = pos1, pboxes = pboxes }
            end
        end
        return nil
    end)
    if not ok then
        logger.warn("BookRaven: could not place a PDF highlight:", result)
        return nil
    end
    return result
end

local function str(v)
    return type(v) == "string" and v or nil
end

--- A new KOReader item for a server annotation, or nil when it can't be shown in this book.
function Sync:newItem(remote)
    local item = {
        bookraven_id = remote.id,
        datetime = str(remote.datetime) or os.date("%Y-%m-%d %H:%M:%S"),
        text = str(remote.text),
        note = str(remote.note),
        chapter = str(remote.chapter),
    }
    if remote.kind == "bookmark" then
        if self.paging then
            item.page = tonumber(remote.page)
        else
            item.page = str(remote.page)
        end
        if not item.page then
            return nil
        end
        return item
    end
    item.drawer = str(remote.drawer) or "lighten"
    item.color = str(remote.color)
    if self.paging then
        if type(remote.pos0) == "table" and type(remote.pos1) == "table" then
            item.pos0, item.pos1 = remote.pos0, remote.pos1
            item.pboxes = type(remote.pboxes) == "table" and remote.pboxes or nil
            item.page = tonumber(remote.page) or tonumber(remote.pos0.page)
        else
            -- Made in BookRaven: find its words on the page.
            local page = tonumber(remote.page)
            local placed = page and item.text and self:placeOnPage(page, item.text)
            if not placed then
                return nil
            end
            item.pos0, item.pos1, item.pboxes, item.page = placed.pos0, placed.pos1, placed.pboxes, page
        end
    else
        item.pos0, item.pos1 = str(remote.pos0), str(remote.pos1)
        item.page = item.pos0
        if not item.pos0 or not item.pos1 then
            return nil
        end
    end
    if not item.page then
        return nil
    end
    return item
end

--[[--
Applies the server's answer: deletions, then changes. Returns counts { added, updated, deleted,
skipped } and the new signatures of what it applied.
]]
function Sync:apply(answer)
    local counts = { added = 0, updated = 0, deleted = 0, skipped = tonumber(answer.skipped) or 0 }
    local applied = {}
    local deleted = {}
    for _, id in ipairs(type(answer.deleted) == "table" and answer.deleted or {}) do
        if type(id) == "string" then
            deleted[id] = true
            local index, item = self:findIndex(id)
            if index then
                table.remove(self.ui.annotation.annotations, index)
                counts.deleted = counts.deleted + 1
                if isBookmark(item) then
                    self:notify(item, 0, -1)
                else
                    self:notify(item, -1, 0)
                end
            end
        end
    end
    for _, remote in ipairs(type(answer.changed) == "table" and answer.changed or {}) do
        if type(remote) == "table" and type(remote.id) == "string" and not deleted[remote.id] then
            local _, item = self:findIndex(remote.id)
            if item then
                -- Positions don't change; the note, the color and the style can.
                item.note = str(remote.note)
                if not isBookmark(item) then
                    item.color = str(remote.color) or item.color
                    item.drawer = str(remote.drawer) or item.drawer
                end
                item.datetime_updated = os.date("%Y-%m-%d %H:%M:%S")
                counts.updated = counts.updated + 1
                applied[remote.id] = signature(item)
                self:notify(item, 0, 0)
            else
                local new_item = self:newItem(remote)
                if new_item then
                    local ok, err = pcall(function()
                        local datetime = new_item.datetime
                        self.ui.annotation:addItem(new_item)
                        -- addItem may stamp the time it was added: keep the original one, the
                        -- same on every device.
                        new_item.datetime = datetime
                    end)
                    if ok then
                        counts.added = counts.added + 1
                        applied[remote.id] = signature(new_item)
                        if isBookmark(new_item) then
                            self:notify(new_item, 0, 1)
                        else
                            self:notify(new_item, 1, 0)
                        end
                    else
                        logger.warn("BookRaven: could not add an annotation:", err)
                        counts.skipped = counts.skipped + 1
                    end
                else
                    counts.skipped = counts.skipped + 1
                end
            end
        end
    end
    return counts, applied, deleted
end

--[[--
Syncs the open book with `client`. Returns `ok, result`: on success `result` has the counts; on
failure an error code ("unknown_document", "unauthorized", "network", "server") and a message.
]]
function Sync:run(client, document_id)
    local state, changed, deleted_ids, signatures = self:collect()
    local body = { document = document_id, since = state.cursor }
    if #changed > 0 then
        body.changed = changed
    end
    if #deleted_ids > 0 then
        body.deleted = deleted_ids
    end
    local ok, status, answer = client:request("POST", "/api/koreader/sync", body)
    if not ok then
        if status == 404 then
            return false, { code = "unknown_document" }
        elseif status == 401 then
            return false, { code = "unauthorized" }
        elseif status == nil then
            return false, { code = "network", message = answer }
        end
        return false, { code = "server", message = "HTTP " .. tostring(status) }
    end
    if type(answer) ~= "table" or type(answer.cursor) ~= "string" then
        return false, { code = "server", message = "unexpected answer" }
    end

    local counts, applied, deleted = self:apply(answer)

    -- Everything here is synced now, as it was sent (unless the server deleted it meanwhile),
    -- and what came from the server as applied.
    local synced = {}
    for id, sig in pairs(signatures) do
        if not deleted[id] then
            synced[id] = sig
        end
    end
    for id, sig in pairs(applied) do
        synced[id] = sig
    end
    state.synced = synced
    state.cursor = answer.cursor
    self:saveState(state)
    counts.sent = #changed
    return true, counts
end

return Annotations
