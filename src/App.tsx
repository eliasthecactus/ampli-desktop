import { Radio, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { addServer } from "./components/AddServer";
import { MiniPlayer } from "./components/MiniPlayer";
import { NowPlaying, QueuePanel } from "./components/NowPlaying";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ContextMenu, Dialogs, Palette, Toast } from "./components/Overlays";
import { enterMini, leaveMini, PlayerBar } from "./components/PlayerBar";
import { Reader } from "./components/Reader";
import { Sidebar } from "./components/Sidebar";
import { Spinner } from "./components/Shelf";
import { TopBar } from "./components/TopBar";
import { loadCredentials, useAccounts } from "./lib/accounts";
import { refreshAll } from "./lib/amplicon";
import { audiobook } from "./lib/audiobook";
import { loadDownloads } from "./lib/downloads";
import { useSource } from "./lib/engine";
import { loadLibrary, syncAll } from "./lib/library";
import { initNative, platform } from "./lib/native";
import { useNav } from "./lib/nav";
import { player, restoreQueue, usePlayer } from "./lib/player";
import { loadCatalog, radio } from "./lib/radio";
import { accents, settings, useSettings } from "./lib/settings";
import { AmpliconHome, CatalogAlbumView, CatalogArtistView, CatalogPlaylistView, ReviewWatcher } from "./views/Amplicon";
import { BookView, Books } from "./views/Books";
import { Downloads } from "./views/Downloads";
import { Home } from "./views/Home";
import { AlbumView, ArtistView, GenreView, Library, PlaylistView } from "./views/Library";
import { Radio as RadioView } from "./views/Radio";
import { Search } from "./views/Search";
import { Settings } from "./views/Settings";

let booting: Promise<void> | null = null;
const bootOnce = () => (booting ??= boot());

async function boot() {
  await initNative();
  await loadCredentials();
  await Promise.all([loadLibrary(), loadDownloads(), loadCatalog()]);
  restoreQueue();
  const s = settings();
  if (s.syncOnLaunch && !s.offlineMode) void syncAll();
  void refreshAll();
}

function useTheme() {
  const appearance = useSettings((s) => s.appearance);
  const accent = useSettings((s) => s.accent);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = appearance === "dark" || (appearance === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);
  useEffect(() => {
    const a = accents[accent];
    document.documentElement.style.setProperty("--accent", a.b);
    document.documentElement.style.setProperty("--accent-2", a.a);
  }, [accent]);
  useEffect(() => {
    document.documentElement.dataset.platform = platform;
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = platform === "mac" ? e.metaKey : e.ctrlKey;
      const typing = (e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]");
      const nav = useNav.getState();
      if (nav.reader) return;
      const source = useSource.getState().source;
      const toggle = () => (source === "audiobook" ? audiobook.toggle() : source === "radio" ? radio.toggle() : player.toggle());
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        nav.setPalette(!nav.palette);
      } else if (mod && e.altKey && e.code === "KeyM") {
        e.preventDefault();
        if (document.documentElement.classList.contains("mini")) void leaveMini();
        else void enterMini();
      } else if (mod && e.key === ",") {
        e.preventDefault();
        nav.go({ name: "settings" });
      } else if (mod && e.key === "[") {
        e.preventDefault();
        nav.back();
      } else if (mod && e.key === "]") {
        e.preventDefault();
        nav.forward();
      } else if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        nav.setOverlay(nav.overlay === "player" ? null : "player");
      } else if (typing) {
        return;
      } else if (e.key === " " && !nav.palette) {
        e.preventDefault();
        toggle();
      } else if (mod && e.key === "ArrowRight") {
        e.preventDefault();
        if (source === "audiobook") audiobook.skip(30);
        else if (source === "radio") radio.step(1);
        else player.next();
      } else if (mod && e.key === "ArrowLeft") {
        e.preventDefault();
        if (source === "audiobook") audiobook.skip(-15);
        else if (source === "radio") radio.step(-1);
        else player.previous();
      } else if (mod && e.key === "ArrowUp") {
        e.preventDefault();
        player.setVolume(Math.min(1, settings().volume + 0.05));
      } else if (mod && e.key === "ArrowDown") {
        e.preventDefault();
        player.setVolume(Math.max(0, settings().volume - 0.05));
      } else if (e.key === "Escape" && nav.overlay) {
        nav.setOverlay(null);
      }
    };
    const mouse = (e: MouseEvent) => {
      // Mouse back/forward buttons.
      if (e.button === 3) useNav.getState().back();
      if (e.button === 4) useNav.getState().forward();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mouseup", mouse);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mouseup", mouse);
    };
  }, []);
}

function useBackgroundSync() {
  const interval = useSettings((s) => s.syncInterval);
  useEffect(() => {
    if (!interval) return;
    const timer = setInterval(() => void syncAll(), interval * 60_000);
    return () => clearInterval(timer);
  }, [interval]);
}

function Page() {
  const route = useNav((s) => s.stack[s.index]);
  switch (route.name) {
    case "home":
      return <Home />;
    case "search":
      return <Search initial={route.query} />;
    case "library":
      return <Library tab={route.tab} />;
    case "album":
      return <AlbumView albumKey={route.key} />;
    case "artist":
      return <ArtistView artistKey={route.key} />;
    case "playlist":
      return <PlaylistView playlistKey={route.key} />;
    case "genre":
      return <GenreView genre={route.genre} />;
    case "books":
      return <Books initialTab={route.tab} />;
    case "book":
      return <BookView bookKey={route.key} />;
    case "radio":
      return <RadioView />;
    case "downloads":
      return <Downloads />;
    case "settings":
      return <Settings section={route.section} />;
    case "amplicon":
      return <AmpliconHome serverId={route.serverId} tab={route.tab} />;
    case "catalog-album":
      return <CatalogAlbumView serverId={route.serverId} id={route.id} />;
    case "catalog-playlist":
      return <CatalogPlaylistView serverId={route.serverId} id={route.id} />;
    case "catalog-artist":
      return <CatalogArtistView serverId={route.serverId} id={route.id} />;
  }
}

function Welcome() {
  const set = useSettings((s) => s.set);
  return (
    <div className="welcome" data-tauri-drag-region>
      <div className="welcome-glow" />
      <div className="welcome-card">
        <img src="/logo.svg" alt="" className="welcome-logo" />
        <h1>Welcome to Ampli</h1>
        <p>Your music, audiobooks, ebooks and radio — from your own server, beautifully.</p>
        <div className="welcome-actions">
          <button className="btn primary big" onClick={() => addServer(() => set({ welcomeDone: true }))}>
            <Server size={18} /> Connect a Server
          </button>
          <button
            className="btn big"
            onClick={() => {
              set({ welcomeDone: true });
              useNav.getState().root({ name: "radio" });
            }}
          >
            <Radio size={18} /> Just Listen to Radio
          </button>
        </div>
        <p className="welcome-small">Jellyfin · Navidrome & Subsonic · Audiobookshelf · Amplicon</p>
        <p className="welcome-small muted">No ads, no account, no tracking.</p>
      </div>
    </div>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const servers = useAccounts((a) => a.servers);
  const welcomeDone = useSettings((s) => s.welcomeDone);
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const overlay = useNav((s) => s.overlay);
  const reader = useNav((s) => s.reader);
  const route = useNav((s) => s.stack[s.index]);
  const [mini, setMini] = useState(false);
  useTheme();
  useShortcuts();
  useBackgroundSync();
  usePlayer((s) => s.index);

  useEffect(() => {
    bootOnce()
      .catch((e) => console.error("Boot failed", e))
      .finally(() => setReady(true));
    const observer = new MutationObserver(() => setMini(document.documentElement.classList.contains("mini")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  if (!ready)
    return (
      <div className="boot" data-tauri-drag-region>
        <Spinner size={28} />
      </div>
    );

  if (mini)
    return (
      <>
        <MiniPlayer />
        <Toast />
      </>
    );

  return (
    <>
      {servers.length === 0 && !welcomeDone ? (
        <Welcome />
      ) : (
        <div className={`app ${collapsed ? "sidebar-collapsed" : ""}`}>
          <Sidebar />
          <main className="main">
            <TopBar />
            <div className="content">
              <ErrorBoundary resetKey={route}>
                <Page />
              </ErrorBoundary>
            </div>
            {overlay === "queue" && <QueuePanel />}
          </main>
          <PlayerBar />
          {overlay === "player" && <NowPlaying />}
        </div>
      )}
      {reader && (
        <ErrorBoundary onClose={() => useNav.getState().openReader(null)}>
          <Reader />
        </ErrorBoundary>
      )}
      <Palette />
      <ContextMenu />
      <Dialogs />
      <ReviewWatcher />
      <Toast />
    </>
  );
}
