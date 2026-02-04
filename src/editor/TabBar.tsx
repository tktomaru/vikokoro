import type { DocId, Document, Mode, Tab } from "./types";

type Props = {
  tabs: Tab[];
  activeDocId: DocId;
  documents: Record<DocId, Document>;
  mode: Mode;
  disabled: boolean;
  onSelect: (docId: DocId) => void;
  onNew: () => void;
};

function getTabTitle(doc: Document | undefined): string {
  if (!doc) return "(missing)";
  const root = doc.nodes[doc.rootId];
  const text = root?.text ?? "";
  return text.trim() === "" ? "Untitled" : text;
}

export function TabBar({ tabs, activeDocId, documents, mode, disabled, onSelect, onNew }: Props) {
  return (
    <div className="tabBar">
      <div className="tabList">
        {tabs.map((tab) => {
          const isActive = tab.docId === activeDocId;
          const title = getTabTitle(documents[tab.docId]);
          return (
            <button
              key={tab.docId}
              className={"tab" + (isActive ? " tabActive" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                if (disabled || mode === "insert") return;
                onSelect(tab.docId);
              }}
              type="button"
            >
              {title}
            </button>
          );
        })}
      </div>
      <div className="tabActions">
        <button
          className="tabNew"
          onMouseDown={(e) => {
            e.preventDefault();
            if (disabled || mode === "insert") return;
            onNew();
          }}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}
