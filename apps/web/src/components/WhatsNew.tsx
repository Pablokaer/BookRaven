import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useLibrary } from "../lib/libraryStore";
import { lastSeenNote, markNotesSeen, RELEASE_NOTES, unseenNotes, type ReleaseNote } from "../lib/whatsNew";
import { Modal } from "./ui/Modal";

const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/**
 * "What's new": shown once after an update, with the notes not seen yet (lib/whatsNew.ts). Waits for
 * the account (`me`): notes about the Admin page are only for administrators.
 */
export function WhatsNew() {
  const { me } = useLibrary();
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null);
  const known = me != null;
  const isAdmin = me?.isAdmin === true;
  useEffect(() => {
    if (known) setNotes((current) => current ?? unseenNotes(RELEASE_NOTES, lastSeenNote(), isAdmin));
  }, [known, isAdmin]);
  if (!notes?.length) return null;
  const close = () => {
    markNotesSeen();
    setNotes([]);
  };
  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent" /> What's new
        </span>
      }
      onClose={close}
      footer={
        <button className="btn" onClick={close}>
          Got it
        </button>
      }
    >
      <div className="-mr-2 max-h-[60dvh] space-y-5 overflow-y-auto pr-2">
        {notes.map((n) => (
          <section key={n.id} aria-label={n.title}>
            <h3 className="font-semibold">{n.title}</h3>
            <p className="text-xs text-muted">{dateLabel(n.date)}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {n.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
