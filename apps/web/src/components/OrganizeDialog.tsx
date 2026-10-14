import { useState } from "react";
import type { Book, Folder } from "../lib/api";
import { updateBook } from "../lib/library";
import { Modal } from "./ui/Modal";

/** Moves a book to a folder and edits its tags. */
export function OrganizeDialog({
  book,
  folders,
  allTags,
  onSaved,
  onClose,
}: {
  book: Book;
  folders: Folder[];
  /** Tags used anywhere in the library, offered as suggestions. */
  allTags: string[];
  onSaved: (book: Book) => void;
  onClose: () => void;
}) {
  const [folderId, setFolderId] = useState(book.folderId);
  const [tags, setTags] = useState(book.tags);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const has = (tag: string) => tags.some((t) => t.toLowerCase() === tag.toLowerCase());
  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (tag && !has(tag)) setTags((t) => [...t, tag]);
    setDraft("");
  };
  const suggestions = allTags.filter((t) => !has(t) && t.toLowerCase().includes(draft.trim().toLowerCase()));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // A tag still being typed counts too.
      const finalTags = draft.trim() && !has(draft) ? [...tags, draft.trim().replace(/\s+/g, " ")] : tags;
      onSaved(await updateBook(book.id, { folderId, tags: finalTags }));
      onClose();
    } catch {
      setError("Could not save, try again");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={book.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <label className="block space-y-2">
        <span className="eyebrow">Collection</span>
        <select className="input w-full" value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value || null)}>
          <option value="">No collection</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {folders.length === 0 && <span className="block text-xs text-muted">Create collections with + under “My Collections”.</span>}
      </label>

      <div className="space-y-2">
        <span className="eyebrow">Tags</span>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent/12 py-0.5 pl-2.5 pr-1 text-sm text-accent ring-1 ring-accent/25">
                {t}
                <button
                  className="rounded-full px-1.5 hover:bg-fg/10"
                  aria-label={`Remove tag ${t}`}
                  onClick={() => setTags((all) => all.filter((x) => x !== t))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          className="input w-full"
          placeholder="Add a tag and press Enter"
          aria-label="New tag"
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value.replace(",", ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(draft);
            } else if (e.key === "Backspace" && !draft && tags.length) {
              setTags((t) => t.slice(0, -1));
            }
          }}
        />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.slice(0, 12).map((t) => (
              <button key={t} className="pill py-0.5 text-xs" onClick={() => addTag(t)}>
                + {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-rose-300">{error}</p>}
    </Modal>
  );
}
