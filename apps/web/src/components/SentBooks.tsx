import { Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { listDeliveries, removeDelivery, type Delivery } from "../lib/deliveries";
import { onServerEvent } from "../lib/events";
import { timeAgo } from "../lib/format";
import { showToast } from "../lib/toast";
import { useApi } from "../lib/useApi";

const devices = (d: Delivery) =>
  d.deliveredTo.length ? `On ${d.deliveredTo.map((t) => t.name).join(", ")}` : "Waiting for your e-readers";

/**
 * Books sent to the e-readers ("Send to Kindle" in a book's menu), with which devices downloaded
 * them. Removing one stops devices that don't have it yet from downloading it (it stays on those
 * that do).
 */
export function SentBooks() {
  const [version, setVersion] = useState(0);
  const { data: list, reload } = useApi(listDeliveries, [], { fallback: [], reloadOn: [version] });
  useEffect(
    () =>
      onServerEvent((event, _data) => {
        if (event === "delivery.changed" || event === "reconnected") setVersion((v) => v + 1);
      }),
    [],
  );

  const remove = async (d: Delivery) => {
    try {
      await removeDelivery(d.id);
      reload();
    } catch {
      showToast("Could not remove it, try again.", "error");
    }
  };

  return (
    <div>
      <span className="eyebrow">Sent to your e-readers</span>
      {list === null ? (
        <div className="mt-2 h-12 animate-pulse rounded-xl bg-elevated/50" />
      ) : list.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          Nothing yet. Choose <b className="text-fg/90">Send to Kindle</b> in a book’s menu: the BookRaven plugin downloads it to your e-readers.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line/70 rounded-xl border border-line">
          {list.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Send className="h-4 w-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <Link to={`/books/${d.bookId}`} className="block truncate hover:text-accent">
                  {d.title}
                </Link>
                <span className="block truncate text-xs text-muted">
                  {devices(d)} · sent {timeAgo(d.sentAt)}
                </span>
              </div>
              <button className="icon-btn h-8 w-8" aria-label={`Stop sending ${d.title}`} title="Remove" onClick={() => void remove(d)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
