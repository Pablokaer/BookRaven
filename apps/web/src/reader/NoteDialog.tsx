import { useState } from "react";
import { Modal } from "../components/ui/Modal";

/** Writes or edits the note on a highlight. Saving an empty note removes it. */
export function NoteDialog({ quote, initial, onSave, onClose }: { quote: string; initial: string; onSave: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState(initial);
  return (
    <Modal
      title="Note"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={() => onSave(note.trim())}>
            Save
          </button>
        </>
      }
    >
      <blockquote className="-mt-2 line-clamp-4 border-l-2 border-accent/60 pl-3 text-sm italic text-muted">{quote}</blockquote>
      <textarea
        autoFocus
        className="input min-h-32 w-full leading-relaxed"
        placeholder="Your thoughts on this passage…"
        aria-label="Note"
        maxLength={5000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(note.trim());
        }}
      />
    </Modal>
  );
}
