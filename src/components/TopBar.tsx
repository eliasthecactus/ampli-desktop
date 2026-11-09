import { ChevronLeft, ChevronRight, CloudOff, RefreshCw, Search } from "lucide-react";
import { syncAll, useLibrary } from "../lib/library";
import { platform } from "../lib/native";
import { useNav } from "../lib/nav";
import { useSettings } from "../lib/settings";
import { Spinner } from "./Shelf";

export function TopBar() {
  const { index, stack, back, forward, setPalette } = useNav();
  const syncing = useLibrary((l) => l.syncing);
  const offline = useSettings((s) => s.offlineMode);
  const set = useSettings((s) => s.set);
  const busy = Object.values(syncing)[0];
  const mod = platform === "mac" ? "⌘" : "Ctrl+";

  return (
    <div className="topbar" data-tauri-drag-region>
      <div className="topbar-nav">
        <button className="icon-btn" disabled={index === 0} onClick={back} aria-label="Back" title="Back">
          <ChevronLeft />
        </button>
        <button className="icon-btn" disabled={index >= stack.length - 1} onClick={forward} aria-label="Forward" title="Forward">
          <ChevronRight />
        </button>
      </div>
      <button className="search-trigger" onClick={() => setPalette(true)}>
        <Search size={16} />
        <span>Search music, books and stations</span>
        <kbd>{mod}K</kbd>
      </button>
      <div className="topbar-tools" data-tauri-drag-region>
        {offline && (
          <button className="chip warn" onClick={() => set({ offlineMode: false })} title="Offline mode: only downloads play. Click to go online.">
            <CloudOff size={14} /> Offline
          </button>
        )}
        {busy ? (
          <span className="chip" title="Syncing your library">
            <Spinner size={12} /> {busy.phase}
            {busy.loaded ? ` · ${busy.loaded.toLocaleString()}` : ""}
          </span>
        ) : (
          !offline && (
            <button className="icon-btn" onClick={() => void syncAll()} aria-label="Sync now" title="Sync now">
              <RefreshCw />
            </button>
          )
        )}
      </div>
    </div>
  );
}
