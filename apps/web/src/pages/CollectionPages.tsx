import { Folder, FolderPlus, MoreHorizontal, Pencil, Share2, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { BookBrowser, EmptyState } from "../components/books/BookBrowser";
import { BookCover } from "../components/books/BookCover";
import { CollectionShareDialog } from "../components/ShareDialog";
import { Menu } from "../components/ui/Menu";
import { collectionColor } from "../lib/bookStats";
import { useLibrary } from "../lib/libraryStore";

/** "/collections" — every collection as a card with a stack of its covers. */
export function CollectionsPage() {
  const { books, folders, addFolder, upload } = useLibrary();
  const navigate = useNavigate();
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const byFolder = useMemo(() => {
    const map = new Map<string, NonNullable<typeof books>>();
    for (const b of books ?? []) if (b.folderId) map.set(b.folderId, [...(map.get(b.folderId) ?? []), b]);
    return map;
  }, [books]);
  const loose = books?.filter((b) => !b.folderId).length ?? 0;

  const create = async () => {
    const f = await addFolder();
    if (f) navigate(`/collections/${f.id}`);
  };

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="font-display text-3xl font-medium tracking-tight">Collections</h1>
          <p className="mt-1.5 text-sm text-muted">
            Group books the way you think about them. Drop files on a collection to upload them into it.{" "}
            {books && `${loose} book${loose === 1 ? " is" : "s are"} not in a collection.`}
          </p>
        </div>
        <button className="btn" onClick={() => void create()}>
          <FolderPlus className="h-4 w-4" /> New collection
        </button>
      </header>

      {folders.length === 0 ? (
        <EmptyState icon={<Folder />} title="No collections yet">
          Create one, then use “Collection &amp; tags” in a book’s menu to put books in it.
        </EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
          {folders.map((f) => {
            const list = byFolder.get(f.id) ?? [];
            const color = collectionColor(f);
            return (
              <Link
                key={f.id}
                to={`/collections/${f.id}`}
                className={`surface group flex animate-rise items-center gap-5 p-5 transition hover:-translate-y-0.5 hover:border-accent/30 ${
                  dropTarget === f.id ? "-translate-y-0.5 border-accent ring-2 ring-accent/50" : ""
                }`}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("Files")) return;
                  e.preventDefault();
                  setDropTarget(f.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget((t) => (t === f.id ? null : t));
                }}
                onDrop={(e) => {
                  e.preventDefault(); // the app shell sees this and leaves the files alone
                  setDropTarget(null);
                  if (e.dataTransfer.files.length) upload(e.dataTransfer.files, f.id);
                }}
              >
                <div className="relative h-24 w-24 shrink-0">
                  {list.length === 0 ? (
                    <div className="flex h-full w-full items-center justify-center rounded-xl" style={{ background: `${color}1a` }}>
                      <Folder className="h-8 w-8" style={{ color }} />
                    </div>
                  ) : (
                    list.slice(0, 3).map((b, i, arr) => (
                      // fan the covers out a little
                      <div
                        key={b.id}
                        className="absolute top-1 w-14 transition duration-300"
                        style={{ left: i * 16, zIndex: arr.length - i, transform: `rotate(${(i - (arr.length - 1) / 2) * 7}deg)` }}
                      >
                        <BookCover book={b} size="xs" className="w-full" />
                      </div>
                    ))
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                    <h2 className="truncate font-display text-lg font-medium">{f.name}</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {dropTarget === f.id ? "Drop to upload into this collection" : `${list.length} book${list.length === 1 ? "" : "s"}`}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

/** "/collections/:id" — one collection's books. */
export function CollectionPage() {
  const { id = "" } = useParams();
  const { books, folders, foldersReady, renameFolderPrompt, removeFolder, pickFiles } = useLibrary();
  const navigate = useNavigate();
  const folder = folders.find((f) => f.id === id);
  const list = useMemo(() => books && books.filter((b) => b.folderId === id), [books, id]);
  const [sharing, setSharing] = useState(false);

  if (foldersReady && !folder) return <Navigate to="/collections" replace />;

  return (
    <>
      <header className="mb-8 flex items-center gap-3">
        {folder && <span className="h-3 w-3 rounded-full" style={{ background: collectionColor(folder) }} />}
        <h1 className="mr-auto truncate font-display text-3xl font-medium tracking-tight">{folder?.name ?? "Collection"}</h1>
        {folder && (
          <button className="btn" onClick={() => pickFiles(folder.id)}>
            <Upload className="h-4 w-4" /> Upload
          </button>
        )}
        {folder && (
          <button className="icon-btn" aria-label={`Share ${folder.name}`} title="Share" onClick={() => setSharing(true)}>
            <Share2 className="h-4 w-4" />
          </button>
        )}
        {folder && (
          <Menu
            label="Collection actions"
            trigger={<MoreHorizontal className="h-4 w-4" />}
            items={[
              { label: "Share…", icon: <Share2 />, onSelect: () => setSharing(true) },
              { label: "Rename", icon: <Pencil />, onSelect: () => void renameFolderPrompt(folder) },
              {
                label: "Delete collection",
                icon: <Trash2 />,
                danger: true,
                onSelect: async () => {
                  if (await removeFolder(folder)) navigate("/collections");
                },
              },
            ]}
          />
        )}
      </header>
      {sharing && folder && <CollectionShareDialog folder={folder} onClose={() => setSharing(false)} />}
      <BookBrowser
        books={list}
        title="Books"
        empty={
          <EmptyState icon={<Folder />} title="This collection is empty">
            Drag files here, or use <strong>Upload</strong>, to add new books straight into this collection. Books already in your library can be
            moved here from their ⋯ menu → “Collection &amp; tags”.
          </EmptyState>
        }
      />
    </>
  );
}
