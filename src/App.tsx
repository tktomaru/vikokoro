import { useEffect, useMemo, useReducer, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { EditorView } from "./editor/EditorView";
import { TabBar } from "./editor/TabBar";
import { createInitialAppState, editorReducer } from "./editor/state";
import type { Workspace } from "./editor/types";

function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialAppState);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastSavedRevisionRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const pendingDRef = useRef(false);
  const pendingDTimerRef = useRef<number | null>(null);

  const activeDoc = state.workspace.documents[state.workspace.activeDocId];
  const activeTabIndex = useMemo(() => {
    return state.workspace.tabs.findIndex(
      (tab) => tab.docId === state.workspace.activeDocId,
    );
  }, [state.workspace.activeDocId, state.workspace.tabs]);

  useEffect(() => {
    if (state.mode === "normal") {
      viewportRef.current?.focus();
    }
  }, [state.mode, state.workspace.activeDocId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const loaded = await invoke<Workspace | null>("load_workspace");
        if (cancelled) return;
        dispatch({ type: "finishHydration", workspace: loaded });
      } catch {
        if (cancelled) return;
        dispatch({ type: "finishHydration", workspace: null });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (pendingDTimerRef.current !== null) {
        window.clearTimeout(pendingDTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    if (state.saveRevision <= lastSavedRevisionRef.current) return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    const revision = state.saveRevision;
    const workspace = state.workspace;
    saveTimerRef.current = window.setTimeout(() => {
      const run = async () => {
        try {
          await invoke("save_workspace", { workspace });
          lastSavedRevisionRef.current = revision;
        } catch {
          // no-op (e.g. running in browser mode)
        }
      };
      void run();
    }, 250);
  }, [state.hydrated, state.saveRevision, state.workspace]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!state.hydrated) return;

      if (state.closeConfirmDocId) {
        const key = event.key;
        if (key === "y" || key === "Y") {
          event.preventDefault();
          dispatch({ type: "closeActiveDoc" });
          return;
        }
        if (key === "n" || key === "N" || key === "Escape") {
          event.preventDefault();
          dispatch({ type: "cancelCloseConfirm" });
          return;
        }
        event.preventDefault();
        return;
      }

      if (state.mode === "insert") {
        pendingDRef.current = false;
        if (pendingDTimerRef.current !== null) {
          window.clearTimeout(pendingDTimerRef.current);
          pendingDTimerRef.current = null;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          dispatch({ type: "commitInsert" });
        }
        if (event.key === "Tab" || (event.ctrlKey && event.key === "Tab")) {
          event.preventDefault();
        }
        if (event.ctrlKey && (event.key === "t" || event.key === "w")) {
          event.preventDefault();
        }
        return;
      }

      if (event.key !== "d") {
        pendingDRef.current = false;
        if (pendingDTimerRef.current !== null) {
          window.clearTimeout(pendingDTimerRef.current);
          pendingDTimerRef.current = null;
        }
      }

      if (event.key === "d") {
        event.preventDefault();
        if (pendingDRef.current) {
          pendingDRef.current = false;
          if (pendingDTimerRef.current !== null) {
            window.clearTimeout(pendingDTimerRef.current);
            pendingDTimerRef.current = null;
          }
          dispatch({ type: "deleteNode" });
          return;
        }

        pendingDRef.current = true;
        if (pendingDTimerRef.current !== null) {
          window.clearTimeout(pendingDTimerRef.current);
        }
        pendingDTimerRef.current = window.setTimeout(() => {
          pendingDRef.current = false;
          pendingDTimerRef.current = null;
        }, 600);
        return;
      }

      if (event.ctrlKey && (event.key === "t" || event.key === "T")) {
        event.preventDefault();
        dispatch({ type: "createDoc" });
        return;
      }
      if (event.ctrlKey && (event.key === "w" || event.key === "W")) {
        event.preventDefault();
        dispatch({ type: "requestCloseActiveDoc" });
        return;
      }

      if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey) {
          dispatch({ type: "switchDocPrev" });
        } else {
          dispatch({ type: "switchDocNext" });
        }
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        dispatch({ type: "addChildAndInsert" });
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        dispatch({ type: "addSiblingAndInsert" });
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "commitInsert" });
        return;
      }

      if (event.key === "i") {
        event.preventDefault();
        dispatch({ type: "enterInsert" });
        return;
      }

      if (event.key === "h") {
        event.preventDefault();
        dispatch({ type: "moveCursor", direction: "parent" });
        return;
      }
      if (event.key === "l") {
        event.preventDefault();
        dispatch({ type: "moveCursor", direction: "child" });
        return;
      }
      if (event.key === "j") {
        event.preventDefault();
        dispatch({ type: "moveCursor", direction: "nextSibling" });
        return;
      }
      if (event.key === "k") {
        event.preventDefault();
        dispatch({ type: "moveCursor", direction: "prevSibling" });
        return;
      }
      if (event.key === "J") {
        event.preventDefault();
        dispatch({ type: "swapSibling", direction: "down" });
        return;
      }
      if (event.key === "K") {
        event.preventDefault();
        dispatch({ type: "swapSibling", direction: "up" });
        return;
      }

      if (event.key === "u") {
        event.preventDefault();
        dispatch({ type: "undo" });
        return;
      }
      if (event.ctrlKey && event.key === "r") {
        event.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.closeConfirmDocId, state.hydrated, state.mode]);

  if (!state.hydrated) {
    return (
      <div className="appRoot">
        <div className="loading">Loading workspace...</div>
      </div>
    );
  }

  return (
    <div className="appRoot">
      <TabBar
        tabs={state.workspace.tabs}
        activeDocId={state.workspace.activeDocId}
        documents={state.workspace.documents}
        mode={state.mode}
        disabled={state.closeConfirmDocId !== null}
        onSelect={(docId) => dispatch({ type: "setActiveDoc", docId })}
        onNew={() => dispatch({ type: "createDoc" })}
      />
      <div
        className="editorViewport"
        ref={viewportRef}
        onMouseDown={() => viewportRef.current?.focus()}
        tabIndex={0}
      >
        <EditorView
          doc={activeDoc}
          mode={state.mode}
          disabled={state.closeConfirmDocId !== null}
          onSelectNode={(nodeId) => dispatch({ type: "selectNode", nodeId })}
          onChangeText={(text) => dispatch({ type: "setCursorText", text })}
          onEsc={() => dispatch({ type: "commitInsert" })}
        />
        {state.closeConfirmDocId ? (
          <div className="modalOverlay" onMouseDown={(e) => e.preventDefault()}>
            <div className="modal">
              <div className="modalTitle">タブを閉じますか？</div>
              <div className="modalBody">y: 閉じる / n: キャンセル</div>
              <div className="modalActions">
                <button
                  type="button"
                  className="modalButton modalButtonDanger"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    dispatch({ type: "closeActiveDoc" });
                  }}
                >
                  閉じる (y)
                </button>
                <button
                  type="button"
                  className="modalButton"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    dispatch({ type: "cancelCloseConfirm" });
                  }}
                >
                  キャンセル (n)
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="statusBar">
        <div className="statusLeft">
          Mode: {state.mode} / Doc: {activeTabIndex + 1}
        </div>
        <div className="statusRight">
          Tab/Enter: add+insert, i/Esc/Enter, hjkl/jk, J/K, dd, u/Ctrl+r, Ctrl+T/W
        </div>
      </div>
    </div>
  );
}

export default App;
