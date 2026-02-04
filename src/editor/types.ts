export type NodeId = string;
export type DocId = string;

export type Mode = "normal" | "insert";

export type Node = {
  id: NodeId;
  text: string;
  parentId: NodeId | null;
  childrenIds: NodeId[];
};

export type DocumentState = {
  rootId: NodeId;
  cursorId: NodeId;
  nodes: Record<NodeId, Node>;
};

export type Document = DocumentState & {
  id: DocId;
  undoStack: DocumentState[];
  redoStack: DocumentState[];
};

export type Tab = {
  docId: DocId;
};

export type Workspace = {
  tabs: Tab[];
  activeDocId: DocId;
  documents: Record<DocId, Document>;
};
