import { BookOpen, Check, ChevronRight, CircleAlert, CircleCheck, Disc3, ListMusic, Mic2, Music2, Radio, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { artworkURL, coverURL } from "../lib/artwork";
import { audiobook } from "../lib/audiobook";
import { useAccounts } from "../lib/accounts";
import { useLibrary } from "../lib/library";
import { go, useNav } from "../lib/nav";
import { player } from "../lib/player";
import { displayName, radio, searchStations, subtitle } from "../lib/radio";
import { rank } from "../lib/search";
import { useSettings } from "../lib/settings";
import { songToTrack } from "../lib/types";
import { closeMenu, useUI, type MenuEntry, type MenuItem } from "../lib/ui";
import { Artwork } from "./Artwork";
import { StationArt } from "./Tiles";

function MenuList({ items, x, y, nested }: { items: MenuEntry[]; x: number; y: number; nested?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [open, setOpen] = useState<{ index: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 8) nx = nested ? x - r.width - (r.width + 4) + 4 : window.innerWidth - r.width - 8;
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, nx), y: ny });
  }, [x, y, nested]);

  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => {
        if (item === "separator") return <div key={i} className="menu-sep" />;
        if ("header" in item) return <div key={i} className="menu-header">{item.header}</div>;
        const it = item as MenuItem;
        return (
          <button
            key={i}
            className={`menu-item ${it.danger ? "danger" : ""} ${open?.index === i ? "open" : ""}`}
            disabled={it.disabled}
            onMouseEnter={(e) => {
              if (it.submenu) {
                const r = e.currentTarget.getBoundingClientRect();
                setOpen({ index: i, x: r.right + 2, y: r.top - 6 });
              } else setOpen(null);
            }}
            onClick={(e) => {
              if (it.submenu) {
                const r = e.currentTarget.getBoundingClientRect();
                setOpen({ index: i, x: r.right + 2, y: r.top - 6 });
                return;
              }
              closeMenu();
              it.action?.();
            }}
          >
            <span className="menu-icon">{it.checked ? <Check /> : it.icon}</span>
            <span className="menu-label">{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
            {it.submenu && <ChevronRight className="menu-chev" />}
          </button>
        );
      })}
      {open && (items[open.index] as MenuItem).submenu && <MenuList items={(items[open.index] as MenuItem).submenu!} x={open.x} y={open.y} nested />}
    </div>
  );
}

export function ContextMenu() {
  const menu = useUI((s) => s.menu);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof MouseEvent && (e.target as Element).closest?.(".menu")) return;
      closeMenu();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    window.addEventListener("mousedown", close, true);
    window.addEventListener("wheel", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);
  if (!menu) return null;
  return <MenuList key={`${menu.x},${menu.y}`} items={menu.items} x={menu.x} y={menu.y} />;
}

export function Dialogs() {
  const dialogs = useUI((s) => s.dialogs);
  return (
    <>
      {dialogs.map((d) => (
        <div key={d.id}>{d.render(() => useUI.setState((s) => ({ dialogs: s.dialogs.filter((x) => x.id !== d.id) })))}</div>
      ))}
    </>
  );
}

export function Toast() {
  const toast = useNav((s) => s.toast);
  if (!toast) return null;
  return (
    <div key={toast.id} className={`toast ${toast.tone ?? ""}`} role="status">
      {toast.tone === "error" ? <CircleAlert size={16} /> : toast.tone === "ok" ? <CircleCheck size={16} /> : null}
      <span>{toast.text}</span>
    </div>
  );
}

interface Hit {
  id: string;
  kind: string;
  icon: React.ReactNode;
  art?: React.ReactNode;
  title: string;
  sub: string;
  run: () => void;
}

/** ⌘K: jump to anything. Enter plays songs and stations, opens everything else. */
export function Palette() {
  const open = useNav((s) => s.palette);
  const setPalette = useNav((s) => s.setPalette);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const lib = useLibrary();
  const s = useSettings();
  const input = useRef<HTMLInputElement>(null);
  const servers = useAccounts((a) => a.servers);
  // With more than one server, results say where they're from.
  const from = (serverId: string) => (servers.length > 1 ? ` · ${servers.find((a) => a.id === serverId)?.name ?? ""}` : "");

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    if (!q.trim()) return [];
    const out: Hit[] = [];
    const close = () => setPalette(false);
    if (s.showMusic) {
      for (const a of rank(q, lib.artists, (x) => x.name, undefined, 4))
        out.push({ id: a.key, kind: "Artist", icon: <Mic2 />, art: <Artwork round className="tiny" src={artworkURL(a.serverId, a.artworkId, 48)} seed={a.name} />, title: a.name, sub: `Artist${from(a.serverId)}`, run: () => (close(), go({ name: "artist", key: a.key })) });
      for (const a of rank(q, lib.albums, (x) => x.name, (x) => x.artistName, 5))
        out.push({ id: a.key, kind: "Album", icon: <Disc3 />, art: <Artwork className="tiny" src={artworkURL(a.serverId, a.artworkId, 48)} seed={a.name} />, title: a.name, sub: `Album · ${a.artistName}${from(a.serverId)}`, run: () => (close(), go({ name: "album", key: a.key })) });
      const songs = rank(q, lib.songs, (x) => x.title, (x) => `${x.artistName} ${x.albumName ?? ""}`, 8);
      for (const song of songs)
        out.push({
          id: song.key,
          kind: "Song",
          icon: <Music2 />,
          art: <Artwork className="tiny" src={artworkURL(song.serverId, song.artworkId, 48)} seed={song.albumName ?? song.title} />,
          title: song.title,
          sub: `Song · ${song.artistName}${from(song.serverId)}`,
          run: () => (close(), player.play([songToTrack(song)])),
        });
      for (const p of rank(q, lib.playlists, (x) => x.name, undefined, 4))
        out.push({ id: p.key, kind: "Playlist", icon: <ListMusic />, art: <Artwork className="tiny" src={artworkURL(p.serverId, p.artworkId, 48)} seed={p.name} icon={<ListMusic />} />, title: p.name, sub: `Playlist${from(p.serverId)}`, run: () => (close(), go({ name: "playlist", key: p.key })) });
    }
    if (s.showBooks || s.showAudiobooks)
      for (const b of rank(q, lib.books, (x) => x.title, (x) => `${x.author} ${x.series ?? ""} ${x.narrator ?? ""}`, 5))
        out.push({
          id: b.key,
          kind: "Book",
          icon: <BookOpen />,
          art: <Artwork className="tiny book" src={coverURL(b.serverId, b.artworkId, 48)} seed={b.title} />,
          title: b.title,
          sub: `${b.hasAudio ? "Audiobook" : "Book"} · ${b.author}${from(b.serverId)}`,
          run: () => (close(), b.hasAudio ? void audiobook.open(b) : go({ name: "book", key: b.key })),
        });
    if (s.showRadio)
      for (const st of searchStations(q, 5))
        out.push({ id: st.id, kind: "Station", icon: <Radio />, art: <StationArt station={st} className="tiny" />, title: displayName(st), sub: `Station · ${subtitle(st)}`, run: () => (close(), radio.play(st)) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, lib, s.showMusic, s.showBooks, s.showAudiobooks, s.showRadio, setPalette, servers]);

  if (!open) return null;
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
      <div className="palette">
        <div className="palette-input">
          <Search size={18} />
          <input
            ref={input}
            value={q}
            placeholder="Search music, books and stations"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPalette(false);
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((v) => Math.min(v + 1, hits.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setSel((v) => Math.max(v - 1, 0)));
              if (e.key === "Enter") {
                if (hits[sel]) hits[sel].run();
                else if (q.trim()) {
                  setPalette(false);
                  go({ name: "search", query: q });
                }
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        {hits.length > 0 && (
          <div className="palette-hits">
            {hits.map((h, i) => (
              <button key={h.kind + h.id} className={`palette-hit ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={h.run}>
                {h.art ?? h.icon}
                <span className="titles">
                  <span className="t1">{h.title}</span>
                  <span className="t2">{h.sub}</span>
                </span>
                <span className="palette-kind">{h.kind}</span>
              </button>
            ))}
          </div>
        )}
        {q.trim() && hits.length === 0 && <div className="palette-empty">No results for “{q}”. Press Enter to search everywhere.</div>}
        {!q.trim() && <div className="palette-empty">Type to find songs, albums, artists, playlists, books and stations. Works offline.</div>}
      </div>
    </div>
  );
}
