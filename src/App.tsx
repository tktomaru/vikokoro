import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { EditorView } from "./editor/EditorView";
import { TabBar } from "./editor/TabBar";
import { createInitialAppState, editorReducer } from "./editor/state";
import type { Document, NodeId, Workspace } from "./editor/types";

type ThemeName = "dark" | "light" | "tokyoNight";

function cycleTheme(theme: ThemeName): ThemeName {
  if (theme === "dark") return "light";
  if (theme === "light") return "tokyoNight";
  return "dark";
}

function loadThemeFromStorage(): ThemeName {
  const raw = localStorage.getItem("vikokoro.theme");
  if (raw === "dark" || raw === "light" || raw === "tokyoNight") return raw;
  return "dark";
}

type ViewState = { zoom: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getNodePath(doc: Document, nodeId: NodeId): { subtitle: string; depth: number } {
  const labels: string[] = [];
  let depth = 0;
  let current = doc.nodes[nodeId];
  while (current) {
    labels.push(current.text.trim() === "" ? "(empty)" : current.text.trim());
    if (!current.parentId) break;
    current = doc.nodes[current.parentId];
    depth += 1;
    if (depth > 1000) break;
  }

  labels.reverse();
  const ancestors = labels.slice(0, -1);
  if (ancestors.length === 0) {
    return { subtitle: "Path: Root", depth: 0 };
  }
  if (ancestors.length > 3) {
    const tail = ancestors.slice(-3);
    return { subtitle: `Path: ${["…", ...tail].join(" › ")}`, depth };
  }
  return { subtitle: `Path: ${ancestors.join(" › ")}`, depth };
}

function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialAppState);
  const [theme, setTheme] = useState<ThemeName>(() => loadThemeFromStorage());
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [tauriAvailable, setTauriAvailable] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unavailable">("saved");
  const [spaceDown, setSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [viewByDocId, setViewByDocId] = useState<Record<string, ViewState>>({});
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const paletteInputRef = useRef<HTMLInputElement | null>(null);
  const lastSavedRevisionRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef<{ revision: number; workspace: Workspace } | null>(null);
  const pendingDRef = useRef(false);
  const pendingDTimerRef = useRef<number | null>(null);
  const panStartRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const pendingZoomAnchorRef = useRef<{
    docId: string;
    worldX: number;
    worldY: number;
    mouseX: number;
    mouseY: number;
    zoom: number;
  } | null>(null);

  const activeDoc = state.workspace.documents[state.workspace.activeDocId];
  const activeView = viewByDocId[state.workspace.activeDocId] ?? { zoom: 1 };
  const zoom = activeView.zoom;
  const activeTabIndex = useMemo(() => {
    return state.workspace.tabs.findIndex(
      (tab) => tab.docId === state.workspace.activeDocId,
    );
  }, [state.workspace.activeDocId, state.workspace.tabs]);

  const modeLabel = state.mode === "insert" ? "INSERT" : "NORMAL";

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query === "") return [];
    const results = Object.values(activeDoc.nodes)
      .filter((node) => node.text.toLowerCase().includes(query))
      .map((node) => {
        const { subtitle, depth } = getNodePath(activeDoc, node.id);
        return {
          nodeId: node.id,
          title: node.text.trim() || "(empty)",
          subtitle,
          depth,
        };
      });

    results.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.title.localeCompare(b.title);
    });

    return results;
  }, [activeDoc.nodes, searchQuery]);

  const activeSearchNodeId =
    searchResults.length > 0 ? searchResults[searchIndex]?.nodeId ?? null : null;

  const searchListStart = useMemo(() => {
    const len = searchResults.length;
    if (len <= 8) return 0;
    return Math.max(0, Math.min(searchIndex - 3, len - 8));
  }, [searchIndex, searchResults.length]);

  const highlightedNodeIds = useMemo(() => {
    if (!searchOpen) return null;
    if (searchResults.length === 0) return null;
    return new Set(searchResults.map((r) => r.nodeId));
  }, [searchOpen, searchResults]);

  const paletteItems = useMemo(() => {
    const query = paletteQuery.trim().toLowerCase();
    const items: {
      id: string;
      title: string;
      subtitle?: string;
      run: () => void;
    }[] = [
      {
        id: "new-tab",
        title: "New tab",
        subtitle: "Ctrl+T",
        run: () => dispatch({ type: "createDoc" }),
      },
      {
        id: "close-tab",
        title: "Close tab",
        subtitle: "Ctrl+W",
        run: () => dispatch({ type: "requestCloseActiveDoc" }),
      },
      {
        id: "search",
        title: "Search",
        subtitle: "Ctrl+F",
        run: () => {
          setSearchOpen(true);
          setPaletteOpen(false);
        },
      },
      {
        id: "help",
        title: "Help",
        subtitle: "?",
        run: () => {
          setHelpOpen(true);
          setPaletteOpen(false);
        },
      },
      {
        id: "cycle-theme",
        title: "Cycle theme",
        subtitle: "Theme button",
        run: () => setTheme((t) => cycleTheme(t)),
      },
    ];

    if (query === "") return items;
    return items.filter((item) => {
      const target = (item.title + " " + (item.subtitle ?? "")).toLowerCase();
      return target.includes(query);
    });
  }, [dispatch, paletteQuery]);

  useEffect(() => {
    const docId = state.workspace.activeDocId;
    setViewByDocId((current) => {
      if (current[docId]) return current;
      return { ...current, [docId]: { zoom: 1 } };
    });
  }, [state.workspace.activeDocId]);

  useEffect(() => {
    setSearchIndex(0);
  }, [searchQuery, state.workspace.activeDocId]);

  useEffect(() => {
    setPaletteIndex(0);
  }, [paletteQuery]);

  useEffect(() => {
    if (!paletteOpen) return;
    setPaletteIndex(0);
  }, [paletteOpen]);

  useEffect(() => {
    setPaletteIndex((idx) => {
      if (paletteItems.length === 0) return 0;
      return clamp(idx, 0, paletteItems.length - 1);
    });
  }, [paletteItems.length]);

  useEffect(() => {
    setSearchIndex((idx) => {
      if (searchResults.length === 0) return 0;
      return clamp(idx, 0, searchResults.length - 1);
    });
  }, [searchResults.length]);

  useEffect(() => {
    if (!searchOpen) return;
    const id = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [searchOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    const id = requestAnimationFrame(() => {
      paletteInputRef.current?.focus();
      paletteInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [paletteOpen]);

  useLayoutEffect(() => {
    const pending = pendingZoomAnchorRef.current;
    if (!pending) return;
    if (pending.docId !== state.workspace.activeDocId) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    viewport.scrollLeft = pending.worldX * pending.zoom - pending.mouseX;
    viewport.scrollTop = pending.worldY * pending.zoom - pending.mouseY;
    pendingZoomAnchorRef.current = null;
  }, [state.workspace.activeDocId, zoom]);

  useEffect(() => {
    if (!spaceDown && isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }
  }, [isPanning, spaceDown]);

  useEffect(() => {
    if (state.mode === "insert") {
      setSearchOpen(false);
      setPaletteOpen(false);
    }
  }, [state.mode]);

  useEffect(() => {
    if (!helpOpen && !searchOpen && !paletteOpen) return;
    setSpaceDown(false);
    setIsPanning(false);
    panStartRef.current = null;
  }, [helpOpen, paletteOpen, searchOpen]);

  const saveLabel = tauriAvailable
    ? saveStatus === "saving"
      ? "Saving…"
      : "Saved"
    : "Local";

  const moveSearch = (delta: number) => {
    if (searchResults.length === 0) return;
    const currentIndex = searchResults.findIndex((r) => r.nodeId === activeDoc.cursorId);
    const len = searchResults.length;
    let nextIndex = 0;
    if (currentIndex === -1) {
      nextIndex = delta >= 0 ? 0 : len - 1;
    } else {
      nextIndex = (currentIndex + delta + len) % len;
    }
    const nodeId = searchResults[nextIndex]?.nodeId;
    if (!nodeId) return;
    setSearchIndex(nextIndex);
    dispatch({ type: "selectNode", nodeId });
  };

  const runPaletteSelected = () => {
    const item = paletteItems[paletteIndex];
    if (!item) return;
    setPaletteOpen(false);
    setPaletteQuery("");
    item.run();
  };

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
        setTauriAvailable(false);
        dispatch({ type: "finishHydration", workspace: null });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("vikokoro.theme", theme);
  }, [theme]);

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
      saveTimerRef.current = null;
      queuedSaveRef.current = { revision, workspace };

      if (!tauriAvailable) {
        lastSavedRevisionRef.current = Math.max(lastSavedRevisionRef.current, revision);
        setSaveStatus("unavailable");
        return;
      }

      setSaveStatus("saving");

      const flushSaveQueue = async () => {
        if (savingRef.current) return;
        const queued = queuedSaveRef.current;
        if (!queued) return;
        queuedSaveRef.current = null;

        savingRef.current = true;
        try {
          await invoke("save_workspace", { workspace: queued.workspace });
          lastSavedRevisionRef.current = Math.max(lastSavedRevisionRef.current, queued.revision);
          setSaveStatus("saved");
        } catch {
          lastSavedRevisionRef.current = Math.max(lastSavedRevisionRef.current, queued.revision);
          setTauriAvailable(false);
          setSaveStatus("unavailable");
        } finally {
          savingRef.current = false;
        }

        void flushSaveQueue();
      };

      void flushSaveQueue();
    }, 250);
  }, [state.hydrated, state.saveRevision, state.workspace, tauriAvailable]);

  useEffect(() => {
    if (!tauriAvailable) return;
    if (state.saveRevision <= lastSavedRevisionRef.current) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("saving");
  }, [state.saveRevision, tauriAvailable]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!state.hydrated) return;

      if (helpOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setHelpOpen(false);
          return;
        }
        event.preventDefault();
        return;
      }

      if (searchOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setSearchOpen(false);
          return;
        }

        if (event.ctrlKey && (event.key === "w" || event.key === "t" || event.key === "Tab")) {
          event.preventDefault();
        }
        return;
      }

      if (paletteOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setPaletteOpen(false);
          return;
        }

        if (event.ctrlKey && (event.key === "w" || event.key === "t" || event.key === "Tab")) {
          event.preventDefault();
        }
        return;
      }

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

      if (state.mode === "normal" && event.code === "Space") {
        event.preventDefault();
        setSpaceDown(true);
        return;
      }

      if (state.mode === "normal" && (event.key === "?" || (event.key === "/" && event.shiftKey))) {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (state.mode === "normal" && event.ctrlKey && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        setSearchOpen(true);
        setPaletteOpen(false);
        return;
      }

      if (state.mode === "normal" && event.ctrlKey && (event.key === "p" || event.key === "P")) {
        event.preventDefault();
        setPaletteQuery("");
        setPaletteIndex(0);
        setPaletteOpen(true);
        setSearchOpen(false);
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

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpaceDown(false);
      }
    };

    const handleWindowBlur = () => {
      setSpaceDown(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [helpOpen, paletteOpen, searchOpen, state.closeConfirmDocId, state.hydrated, state.mode]);

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
        theme={theme}
        onCycleTheme={() => setTheme((t) => cycleTheme(t))}
      />
      <div
        className={
          "editorViewport" +
          (spaceDown ? " editorViewportPannable" : "") +
          (isPanning ? " editorViewportPanning" : "")
        }
        ref={viewportRef}
        onMouseDown={(e) => {
          viewportRef.current?.focus();

          if (helpOpen || state.closeConfirmDocId) return;
          if (state.mode !== "normal") return;
          if (!spaceDown) return;
          if (e.button !== 0) return;

          e.preventDefault();
          const viewport = viewportRef.current;
          if (!viewport) return;

          setIsPanning(true);
          panStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            scrollLeft: viewport.scrollLeft,
            scrollTop: viewport.scrollTop,
          };

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const start = panStartRef.current;
            const currentViewport = viewportRef.current;
            if (!start || !currentViewport) return;
            moveEvent.preventDefault();
            const dx = moveEvent.clientX - start.x;
            const dy = moveEvent.clientY - start.y;
            currentViewport.scrollLeft = start.scrollLeft - dx;
            currentViewport.scrollTop = start.scrollTop - dy;
          };

          const handleMouseUp = () => {
            setIsPanning(false);
            panStartRef.current = null;
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
          };

          window.addEventListener("mousemove", handleMouseMove, { passive: false });
          window.addEventListener("mouseup", handleMouseUp);
        }}
        onWheel={(e) => {
          if (helpOpen || state.closeConfirmDocId) return;
          if (!e.ctrlKey) return;
          const viewport = viewportRef.current;
          if (!viewport) return;

          e.preventDefault();

          const rect = viewport.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          const worldX = (viewport.scrollLeft + mouseX) / zoom;
          const worldY = (viewport.scrollTop + mouseY) / zoom;
          const factor = Math.exp(-e.deltaY * 0.002);
          const nextZoom = clamp(zoom * factor, 0.5, 2);

          pendingZoomAnchorRef.current = {
            docId: state.workspace.activeDocId,
            worldX,
            worldY,
            mouseX,
            mouseY,
            zoom: nextZoom,
          };

          setViewByDocId((current) => ({
            ...current,
            [state.workspace.activeDocId]: { zoom: nextZoom },
          }));
        }}
        tabIndex={0}
      >
        <EditorView
          doc={activeDoc}
          mode={state.mode}
          disabled={state.closeConfirmDocId !== null}
          zoom={zoom}
          panGestureActive={spaceDown || isPanning}
          highlightedNodeIds={highlightedNodeIds}
          activeHighlightedNodeId={activeSearchNodeId}
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

        {searchOpen ? (
          <div
            className="modalOverlay"
            onMouseDown={(e) => {
              e.preventDefault();
              setSearchOpen(false);
            }}
          >
            <div
              className="modal searchModal"
              onMouseDown={(e) => {
                e.preventDefault();
              }}
            >
              <div className="modalTitle">Search</div>
              <div className="modalBody">
                <div className="searchBar">
                  <input
                    ref={searchInputRef}
                    className="searchInput"
                    value={searchQuery}
                    placeholder="Type to search nodes…"
                    onChange={(e) => setSearchQuery(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setSearchOpen(false);
                        return;
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        moveSearch(e.shiftKey ? -1 : 1);
                        return;
                      }
                    }}
                  />
                  <div className="searchMeta">
                    {searchResults.length === 0
                      ? "0 results"
                      : `${searchIndex + 1}/${searchResults.length}`}
                  </div>
                </div>

                {searchResults.length > 0 ? (
                  <div className="searchList" role="listbox" aria-label="Search results">
                    {searchResults
                      .slice(searchListStart, searchListStart + 8)
                      .map((result) => {
                        const isActive = result.nodeId === activeSearchNodeId;
                        return (
                          <button
                            key={result.nodeId}
                            type="button"
                            className={"searchItem" + (isActive ? " searchItemActive" : "")}
                            title={`${result.subtitle} › ${result.title}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const nextIndex = searchResults.findIndex((r) => r.nodeId === result.nodeId);
                              if (nextIndex >= 0) setSearchIndex(nextIndex);
                              dispatch({ type: "selectNode", nodeId: result.nodeId });
                            }}
                          >
                            <div className="searchItemTitle">{result.title}</div>
                            <div className="searchItemSubtitle">{result.subtitle}</div>
                          </button>
                        );
                      })}
                  </div>
                ) : null}
              </div>

              <div className="modalActions">
                <button
                  type="button"
                  className="modalButton"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    moveSearch(-1);
                  }}
                  disabled={searchResults.length === 0}
                >
                  Prev (Shift+Enter)
                </button>
                <button
                  type="button"
                  className="modalButton"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    moveSearch(1);
                  }}
                  disabled={searchResults.length === 0}
                >
                  Next (Enter)
                </button>
                <button
                  type="button"
                  className="modalButton"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSearchOpen(false);
                  }}
                >
                  Close (Esc)
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {paletteOpen ? (
          <div
            className="modalOverlay"
            onMouseDown={(e) => {
              e.preventDefault();
              setPaletteOpen(false);
            }}
          >
            <div
              className="modal paletteModal"
              onMouseDown={(e) => {
                e.preventDefault();
              }}
            >
              <div className="modalTitle">Command palette</div>
              <div className="modalBody">
                <div className="paletteBar">
                  <input
                    ref={paletteInputRef}
                    className="paletteInput"
                    value={paletteQuery}
                    placeholder="Type a command…"
                    onChange={(e) => setPaletteQuery(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setPaletteOpen(false);
                        return;
                      }
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setPaletteIndex((idx) => clamp(idx + 1, 0, Math.max(0, paletteItems.length - 1)));
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setPaletteIndex((idx) => clamp(idx - 1, 0, Math.max(0, paletteItems.length - 1)));
                        return;
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runPaletteSelected();
                        return;
                      }
                    }}
                  />
                  <div className="paletteMeta">{paletteItems.length} commands</div>
                </div>

                <div className="paletteList" role="listbox" aria-label="Commands">
                  {paletteItems.map((item, idx) => {
                    const isActive = idx === paletteIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={"paletteItem" + (isActive ? " paletteItemActive" : "")}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setPaletteIndex(idx);
                          setPaletteOpen(false);
                          setPaletteQuery("");
                          item.run();
                        }}
                      >
                        <div className="paletteItemTitle">{item.title}</div>
                        {item.subtitle ? (
                          <div className="paletteItemSubtitle">{item.subtitle}</div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="modalActions">
                <button
                  type="button"
                  className="modalButton"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runPaletteSelected();
                  }}
                  disabled={paletteItems.length === 0}
                >
                  Run (Enter)
                </button>
                <button
                  type="button"
                  className="modalButton"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setPaletteOpen(false);
                  }}
                >
                  Close (Esc)
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {helpOpen ? (
          <div
            className="modalOverlay"
            onMouseDown={(e) => {
              e.preventDefault();
              setHelpOpen(false);
            }}
          >
            <div
              className="modal helpModal"
              onMouseDown={(e) => {
                e.preventDefault();
              }}
            >
              <div className="modalTitle">Help</div>
              <div className="modalBody">
                <div className="helpGrid">
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>Tab</kbd>
                    </div>
                    <div className="helpDesc">Add child (and edit)</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>Enter</kbd>
                    </div>
                    <div className="helpDesc">Add sibling (and edit)</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>i</kbd> / <kbd>Esc</kbd>
                    </div>
                    <div className="helpDesc">Insert / Commit (back to Normal)</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>h</kbd>
                      <kbd>j</kbd>
                      <kbd>k</kbd>
                      <kbd>l</kbd>
                    </div>
                    <div className="helpDesc">Move (parent / next / prev / child)</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>J</kbd> / <kbd>K</kbd>
                    </div>
                    <div className="helpDesc">Swap siblings (down / up)</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>dd</kbd>
                    </div>
                    <div className="helpDesc">Delete (root is protected)</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>u</kbd> / <kbd>Ctrl</kbd>+<kbd>r</kbd>
                    </div>
                    <div className="helpDesc">Undo / Redo</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>Ctrl</kbd>+<kbd>T</kbd> / <kbd>Ctrl</kbd>+<kbd>W</kbd>
                    </div>
                    <div className="helpDesc">New tab / Close tab</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>Ctrl</kbd>+<kbd>Tab</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Tab</kbd>
                    </div>
                    <div className="helpDesc">Switch tab (next / prev)</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>Ctrl</kbd>+<kbd>F</kbd>
                    </div>
                    <div className="helpDesc">Search</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>Ctrl</kbd>+<kbd>P</kbd>
                    </div>
                    <div className="helpDesc">Command palette</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>Ctrl</kbd> + <kbd>Wheel</kbd>
                    </div>
                    <div className="helpDesc">Zoom (around mouse)</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>Space</kbd> + Drag
                    </div>
                    <div className="helpDesc">Pan (grab to move)</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">
                      <kbd>?</kbd>
                    </div>
                    <div className="helpDesc">Open help</div>
                  </div>
                  <div className="helpRow">
                    <div className="helpKeys">Theme</div>
                    <div className="helpDesc">Cycle on the top right (Dark/Light/Tokyo Night)</div>
                  </div>
                </div>
              </div>

              <div className="modalActions">
                <button
                  type="button"
                  className="modalButton"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setHelpOpen(false);
                  }}
                >
                  Close (Esc)
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="statusBar">
        <div className="statusLeft">
          <span className="statusLabel">Mode</span>
          <span
            className={
              "statusPill " + (state.mode === "insert" ? "statusPillInsert" : "statusPillNormal")
            }
          >
            {modeLabel}
          </span>
          <span className="statusDot">•</span>
          <span className="statusLabel">Doc</span>
          <span className="statusValue">
            {activeTabIndex + 1}/{state.workspace.tabs.length}
          </span>
          <span className="statusDot">•</span>
          <span className="statusLabel">Save</span>
          <span className={"statusValue " + (saveStatus === "saving" ? "statusValueSaving" : "")}>
            {saveLabel}
          </span>
        </div>
        <div className="statusRight">
          <button
            type="button"
            className="statusHelpButton"
            onMouseDown={(e) => {
              e.preventDefault();
              setHelpOpen(true);
            }}
          >
            ? Help
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
