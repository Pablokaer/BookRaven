import type { TocItem } from "foliate-js/view.js";

function Items({ items, depth, onSelect }: { items: TocItem[]; depth: number; onSelect: (href: string) => void }) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={`${item.href}-${i}`}>
          <button
            className="block w-full truncate rounded-md px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            style={{ paddingLeft: 12 + depth * 16 }}
            onClick={() => onSelect(item.href)}
          >
            {item.label?.trim() || "Untitled"}
          </button>
          {item.subitems?.length ? <Items items={item.subitems} depth={depth + 1} onSelect={onSelect} /> : null}
        </li>
      ))}
    </ul>
  );
}

export function TocPanel({
  toc,
  onSelect,
  onClose,
  title = "Contents",
}: {
  toc: TocItem[];
  onSelect: (href: string) => void;
  onClose: () => void;
  title?: string;
}) {
  return (
    <div className="panel left-0 w-full max-w-sm" role="dialog" aria-label={title}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button className="btn-icon" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
          ✕
        </button>
      </div>
      {toc.length ? (
        <Items items={toc} depth={0} onSelect={onSelect} />
      ) : (
        <p className="text-sm text-neutral-500">This book has no table of contents.</p>
      )}
    </div>
  );
}
