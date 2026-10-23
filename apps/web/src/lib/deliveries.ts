import { apiDelete, apiJson } from "./api";
import { showToast } from "./toast";

/**
 * "Send to Kindle": books queued for the account's e-readers. The BookRaven plugin for KOReader
 * downloads them into a BookRaven folder on each device; KOReader's catalog lists them under
 * "Sent to this device" (Profile → Other apps sets both up).
 */
export type Delivery = {
  id: string;
  bookId: string;
  title: string;
  author: string | null;
  format: string;
  hasCover: boolean;
  sentAt: string;
  /** The devices (app passwords) that downloaded it. */
  deliveredTo: { name: string; at: string }[];
};

export const listDeliveries = () => apiJson<Delivery[]>("/api/deliveries");

export const removeDelivery = (id: string) => apiDelete(`/api/deliveries/${id}`);

/** Sends a book to the e-readers, and says so (or that it failed) in a toast. */
export async function sendToDevices(book: { id: string; title: string }) {
  try {
    const d = await apiJson<Delivery>("/api/deliveries", { method: "POST", body: JSON.stringify({ bookId: book.id }) });
    showToast(`“${book.title}” is on its way to your e-readers. It arrives the next time KOReader checks for sent books.`);
    return d;
  } catch {
    showToast("Could not send it, try again.", "error");
    return null;
  }
}
