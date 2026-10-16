import type { TocItem } from "foliate-js/view.js";
import { PanelShell } from "./PanelShell";

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

export function TocPanel({ toc, title, onSelect, onClose }: { toc: TocItem[]; title: string; onSelect: (href: string) => void; onClose: () => void }) {
  return (
    <PanelShell side="left" label={title} title={title} closeLabel={`Close ${title.toLowerCase()}`} closeIcon="✕" onClose={onClose}>
      {toc.length ? (
        <Items items={toc} depth={0} onSelect={onSelect} />
      ) : (
        <p className="text-sm text-neutral-500">This book has no table of contents.</p>
      )}
    </PanelShell>
  );
}
