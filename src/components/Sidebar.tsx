import {
  ArrowDownToLine,
  BookOpen,
  Disc3,
  Heart,
  Home,
  Library,
  ListMusic,
  Mic2,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Radio,
  Search,
  Settings,
  Sparkles,
  Tags,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAccounts } from "../lib/accounts";
import { activeJobs, useAmplicon } from "../lib/amplicon";
import { useDownloads } from "../lib/downloads";
import { useLibrary } from "../lib/library";
import { platform } from "../lib/native";
import { useNav, type LibraryTab, type Route } from "../lib/nav";
import { useSettings } from "../lib/settings";
import { hasMusic } from "../lib/types";
import { newPlaylist } from "./menus";
import { choose } from "./Dialog";

function Item({ icon, label, route, active, badge }: { icon: ReactNode; label: string; route: Route; active: boolean; badge?: ReactNode }) {
  const root = useNav((s) => s.root);
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={() => root(route)} title={label}>
      {icon}
      <span className="nav-label">{label}</span>
      {badge !== undefined && badge !== null && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

export function Sidebar() {
  const route = useNav((s) => s.stack[s.index]);
  const root = useNav((s) => s.root);
  const s = useSettings();
  const servers = useAccounts((a) => a.servers);
  const playlists = useLibrary((l) => l.playlists);
  const syncing = useLibrary((l) => Object.keys(l.syncing).length > 0);
  const jobs = useDownloads((d) => d.jobs.filter((j) => j.state !== "failed").length);
  const serverJobs = useAmplicon(() => activeJobs().length);
  const music = s.showMusic && servers.some((a) => hasMusic(a.kind) || a.kind === "amplicon");
  const books = (s.showBooks || s.showAudiobooks) && servers.some((a) => a.kind === "jellyfin" || a.kind === "audiobookshelf");
  const amplicons = servers.filter((a) => a.kind === "amplicon");
  const collapsed = s.sidebarCollapsed;
  const lib = (tab: LibraryTab) => route.name === "library" && (route.tab ?? "albums") === tab;
  const editable = servers.filter((a) => hasMusic(a.kind));

  const addPlaylist = async () => {
    if (editable.length === 1) return newPlaylist(editable[0].id);
    const id = await choose("New playlist on which server?", editable.map((a) => ({ value: a.id, label: a.name, detail: a.url })));
    if (id) void newPlaylist(id);
  };

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-top" data-tauri-drag-region>
        {platform !== "mac" && (
          <div className="brand">
            <img src="/logo.svg" alt="" />
            <span>Ampli</span>
          </div>
        )}
        <button className="icon-btn small collapse" onClick={() => s.set({ sidebarCollapsed: !collapsed })} aria-label="Toggle sidebar">
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </div>
      <nav className="sidebar-scroll">
        <div className="nav-group">
          <Item icon={<Search />} label="Search" route={{ name: "search" }} active={route.name === "search"} />
          <Item icon={<Home />} label="Home" route={{ name: "home" }} active={route.name === "home"} />
          {s.showRadio && <Item icon={<Radio />} label="Radio" route={{ name: "radio" }} active={route.name === "radio"} />}
          {books && <Item icon={<BookOpen />} label="Books" route={{ name: "books" }} active={route.name === "books" || route.name === "book"} />}
        </div>

        {music && (
          <div className="nav-group">
            <div className="nav-title">
              <span>Library</span>
              {syncing && <span className="sync-dot" title="Syncing" />}
            </div>
            <Item icon={<ListMusic />} label="Playlists" route={{ name: "library", tab: "playlists" }} active={lib("playlists")} />
            <Item icon={<Mic2 />} label="Artists" route={{ name: "library", tab: "artists" }} active={lib("artists") || route.name === "artist"} />
            <Item icon={<Disc3 />} label="Albums" route={{ name: "library", tab: "albums" }} active={lib("albums") || route.name === "album"} />
            <Item icon={<Music2 />} label="Songs" route={{ name: "library", tab: "songs" }} active={lib("songs")} />
            <Item icon={<Tags />} label="Genres" route={{ name: "library", tab: "genres" }} active={lib("genres") || route.name === "genre"} />
            <Item icon={<Heart />} label="Favourites" route={{ name: "library", tab: "favorites" }} active={lib("favorites")} />
            <Item
              icon={<ArrowDownToLine />}
              label="Downloads"
              route={{ name: "downloads" }}
              active={route.name === "downloads"}
              badge={jobs + serverJobs || undefined}
            />
          </div>
        )}
        {!music && (
          <div className="nav-group">
            <Item icon={<ArrowDownToLine />} label="Downloads" route={{ name: "downloads" }} active={route.name === "downloads"} badge={jobs || undefined} />
          </div>
        )}

        {amplicons.length > 0 && s.showMusic && (
          <div className="nav-group">
            <div className="nav-title">
              <span>Amplicon</span>
            </div>
            {amplicons.map((a) => (
              <Item
                key={a.id}
                icon={<Sparkles />}
                label={amplicons.length > 1 ? a.name : "For You"}
                route={{ name: "amplicon", serverId: a.id }}
                active={route.name === "amplicon" && route.serverId === a.id}
              />
            ))}
          </div>
        )}

        {music && !collapsed && (
          <div className="nav-group playlists">
            <div className="nav-title">
              <span>Playlists</span>
              {editable.length > 0 && (
                <button className="icon-btn tiny" onClick={addPlaylist} aria-label="New Playlist" title="New Playlist">
                  <Plus />
                </button>
              )}
            </div>
            {[...playlists]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <button
                  key={p.key}
                  className={`nav-item sub ${route.name === "playlist" && route.key === p.key ? "active" : ""}`}
                  onClick={() => root({ name: "playlist", key: p.key })}
                  title={p.name}
                >
                  <span className="nav-label">{p.name}</span>
                </button>
              ))}
          </div>
        )}
      </nav>
      <div className="sidebar-bottom">
        <Item icon={<Settings />} label="Settings" route={{ name: "settings" }} active={route.name === "settings"} />
        {!music && !collapsed && servers.length === 0 && (
          <button className="nav-item" onClick={() => root({ name: "settings", section: "servers" })}>
            <Library />
            <span className="nav-label">Add a Server</span>
          </button>
        )}
      </div>
    </aside>
  );
}
