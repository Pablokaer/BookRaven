import { useState } from "react";
import { Modal } from "../components/ui/Modal";
import { postMessage, type ClubSummary } from "../lib/clubs";

/** Posts a passage from the book to one of the user's clubs reading it. */
export function DiscussDialog({ clubs, quote, locator, onClose }: { clubs: ClubSummary[]; quote: string; locator: string; onClose: () => void }) {
  const [clubId, setClubId] = useState(clubs[0]!.id);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const send = async () => {
    setState("sending");
    try {
      await postMessage(clubId, { text: text.trim(), quote: quote.slice(0, 3000), locator });
      setState("sent");
      setTimeout(onClose, 900);
    } catch {
      setState("error");
    }
  };

  return (
    <Modal
      title="Discuss in club"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={!text.trim() || state === "sending" || state === "sent"} onClick={() => void send()}>
            {state === "sent" ? "Sent" : "Post"}
          </button>
        </>
      }
    >
      <blockquote className="-mt-2 line-clamp-5 border-l-2 border-accent/60 pl-3 text-sm italic text-muted">{quote}</blockquote>
      {clubs.length > 1 && (
        <select className="input w-full" aria-label="Club" value={clubId} onChange={(e) => setClubId(e.target.value)}>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <textarea
        autoFocus
        className="input min-h-24 w-full"
        placeholder={`What do you think? (to ${clubs.find((c) => c.id === clubId)?.name})`}
        aria-label="Message"
        maxLength={4000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {state === "error" && <p className="text-sm text-rose-300">Could not post it, try again.</p>}
    </Modal>
  );
}
