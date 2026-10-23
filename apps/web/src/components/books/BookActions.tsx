import { BookOpen, CloudDownload, Download, FolderInput, Globe, Heart, Info, MoreHorizontal, Send, Share2, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";
import type { Book } from "../../lib/api";
import { saveForOffline } from "../../lib/books";
import { sendToDevices } from "../../lib/deliveries";
import { downloadOwnBook, updateBook } from "../../lib/library";
import { useLibraryActions } from "../../lib/libraryStore";
import { Menu } from "../ui/Menu";

export function FavoriteButton({ book, className = "icon-btn" }: { book: Book; className?: string }) {
  const { toggleFavorite } = useLibraryActions();
  return (
    <button
      type="button"
      className={className}
      aria-pressed={book.favorite}
      aria-label={book.favorite ? `Remove ${book.title} from favorites` : `Add ${book.title} to favorites`}
      title={book.favorite ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggleFavorite(book);
      }}
    >
      <Heart className={`h-4 w-4 transition ${book.favorite ? "fill-rose-400 text-rose-400" : ""}`} />
    </button>
  );
}

export function ShareButton({ book, className = "icon-btn" }: { book: Book; className?: string }) {
  const { openShare } = useLibraryActions();
  return (
    <button
      type="button"
      className={className}
      aria-label={`Share ${book.title}`}
      title="Share"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openShare(book);
      }}
    >
      <Share2 className="h-4 w-4" />
    </button>
  );
}

/** "More" menu with the book's remaining actions. */
export function BookMenu({ book, className }: { book: Book; className?: string }) {
  const navigate = useNavigate();
  const { openShare, openOrganize, removeBook, toggleFavorite, replaceBook } = useLibraryActions();
  const setPublic = async (isPublic: boolean) => {
    if (
      isPublic &&
      !window.confirm(`Publish “${book.title}” to the Public Library? Every account on this server will be able to read and download it.`)
    )
      return;
    try {
      replaceBook(await updateBook(book.id, { isPublic }));
    } catch {
      window.alert("Could not change this, try again.");
    }
  };
  return (
    <Menu
      label={`More actions for ${book.title}`}
      triggerClassName={className ?? "icon-btn"}
      trigger={<MoreHorizontal className="h-4 w-4" />}
      items={[
        { label: book.progress ? "Continue reading" : "Start reading", icon: <BookOpen />, onSelect: () => navigate(`/read/${book.id}`) },
        { label: "Details", icon: <Info />, onSelect: () => navigate(`/books/${book.id}`) },
        { label: "Collection & tags…", icon: <FolderInput />, onSelect: () => openOrganize(book) },
        { label: "Share…", icon: <Share2 />, onSelect: () => openShare(book) },
        book.isPublic
          ? { label: "Remove from Public Library", icon: <Globe />, onSelect: () => void setPublic(false) }
          : { label: "Publish to Public Library", icon: <Globe />, onSelect: () => void setPublic(true) },
        {
          label: "Save for offline reading",
          icon: <CloudDownload />,
          onSelect: () =>
            void saveForOffline(book)
              .then(() => window.alert(`“${book.title}” is saved on this device and opens without internet.`))
              .catch((err) =>
                window.alert(
                  err?.name === "QuotaExceededError"
                    ? "There is no room left on this device. Clear downloaded books in your profile, then try again."
                    : "Could not save it, try again.",
                ),
              ),
        },
        // To the account's e-readers, through the BookRaven plugin for KOReader (Profile → Other apps).
        { label: "Send to Kindle", icon: <Send />, onSelect: () => void sendToDevices(book) },
        { label: "Download file", icon: <Download />, onSelect: () => void downloadOwnBook(book).catch(() => window.alert("Download failed, try again.")) },
        {
          label: book.favorite ? "Remove from favorites" : "Add to favorites",
          icon: <Heart />,
          onSelect: () => void toggleFavorite(book),
        },
        { separator: true },
        { label: "Delete book", icon: <Trash2 />, danger: true, onSelect: () => void removeBook(book) },
      ]}
    />
  );
}
