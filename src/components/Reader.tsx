// The reader: EPUB (epub.js, pages or scrolling, book scripts off), PDF (pdf.js) and CBZ comics.
// Themes, fonts, text size, line spacing, margins, justification, bookmarks, highlights in five colours with
// notes, search, table of contents and a progress slider. The position is saved locally and sent to the server
// (Audiobookshelf ebook progress, Jellyfin played percentage).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, List, Minus, Plus, Search, Type, X, ZoomIn, ZoomOut, ArrowLeftRight, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { account, bookClient } from "../lib/accounts";
import { db, type Annotation } from "../lib/db";
import { downloadedURL } from "../lib/downloads";
import { connectionOf, request } from "../lib/http";
import { index, setBookProgress } from "../lib/library";
import { errorText, useNav } from "../lib/nav";
import { readerFonts, readerThemes, useSettings, type ReaderSettings } from "../lib/settings";
import type { Book } from "../lib/types";
import { Segmented, Spinner, Toggle } from "./Shelf";
import { prompt } from "./Dialog";

const highlightColors = { yellow: "#ffd60a", green: "#30d158", blue: "#64d2ff", pink: "#ff6482", purple: "#bf5af2" };

async function loadFile(book: Book): Promise<ArrayBuffer> {
  const local = downloadedURL(`ebook:${book.key}`);
  if (local) return (await fetch(local)).arrayBuffer();
  const client = bookClient(book.serverId);
  const a = account(book.serverId);
  if (!client || !a) throw new Error("Sign in to this server again.");
  const res = await request(connectionOf(a), client.ebookURL(book.id), { headers: { ...client.headers, Accept: "*/*" }, timeout: 120_000 });
  return res.arrayBuffer();
}

interface Nav {
  next: () => void;
  prev: () => void;
  goTo: (location: string) => void;
  goToFraction: (f: number) => void;
}

interface TocItem {
  label: string;
  location: string;
  depth: number;
}

export function Reader() {
  const bookKey = useNav((n) => n.reader);
  const close = useNav((n) => n.openReader);
  const book = bookKey ? index.book.get(bookKey) : undefined;
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!book) return;
    loadFile(book).then(setData, (e) => setError(errorText(e)));
  }, [bookKey]);

  if (!bookKey || !book) return null;
  const format = book.ebookFormat ?? "epub";
  return (
    <ReaderShell book={book} close={() => close(null)} format={format} data={data} error={error} />
  );
}

function ReaderShell({ book, close, format, data, error }: { book: Book; close: () => void; format: string; data: ArrayBuffer | null; error: string | null }) {
  const settings = useSettings((s) => s.reader);
  const setSettings = (patch: Partial<ReaderSettings>) => useSettings.getState().set({ reader: { ...settings, ...patch } });
  const theme = readerThemes[settings.theme];
  const [progress, setProgress] = useState(0);
  const [location, setLocation] = useState("");
  const [label, setLabel] = useState("");
  const [toc, setToc] = useState<TocItem[]>([]);
  const [panel, setPanel] = useState<"toc" | "search" | "settings" | "notes" | null>(null);
  const [chrome, setChrome] = useState(true);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const nav = useRef<Nav | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [start, setStart] = useState<string | null | undefined>(undefined);
  const [rtl, setRtl] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [searchApi, setSearchApi] = useState<((q: string) => Promise<{ location: string; excerpt: string }[]>) | null>(null);

  useEffect(() => {
    void db.positions.get(book.key).then((p) => {
      // The server's percentage wins when it's newer (read on another device).
      const server = book.progress?.ebookProgress;
      if (p && (!server || !book.progress?.updatedAt || p.updatedAt >= book.progress.updatedAt - 1000)) setStart(p.location);
      else if (server && server > 0 && server < 1) setStart(`fraction:${server}`);
      else setStart(null);
    });
    void db.annotations.where("bookKey").equals(book.key).toArray().then(setAnnotations);
  }, [book.key]);

  const onLocation = useCallback(
    (loc: string, fraction: number, text: string) => {
      setLocation(loc);
      setProgress(fraction);
      setLabel(text);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await db.positions.put({ bookKey: book.key, location: loc, progress: fraction, updatedAt: Date.now() });
        const finished = fraction >= 0.995;
        await setBookProgress(book.key, { ebookProgress: fraction, ...(book.hasAudio ? {} : { progress: fraction }), ...(finished ? { isFinished: true } : {}) });
        try {
          await bookClient(book.serverId)?.saveEbookProgress(book.id, fraction, finished);
        } catch {
          /* offline: saved locally */
        }
      }, 2500);
    },
    [book],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === "Escape") return panel ? setPanel(null) : close();
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const back = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === forward || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) (e.preventDefault(), nav.current?.next());
      if (e.key === back || e.key === "PageUp" || (e.key === " " && e.shiftKey)) (e.preventDefault(), nav.current?.prev());
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [panel, close, rtl]);

  const bookmarks = annotations.filter((a) => a.kind === "bookmark").sort((a, b) => a.progress - b.progress);
  const highlights = annotations.filter((a) => a.kind === "highlight").sort((a, b) => a.progress - b.progress);
  const here = bookmarks.find((b) => b.location === location);

  const toggleBookmark = async () => {
    if (here) {
      await db.annotations.delete(here.id);
      setAnnotations((a) => a.filter((x) => x.id !== here.id));
    } else {
      const mark: Annotation = { id: crypto.randomUUID(), bookKey: book.key, kind: "bookmark", location, text: label, progress, createdAt: Date.now() };
      await db.annotations.put(mark);
      setAnnotations((a) => [...a, mark]);
    }
  };

  const addHighlight = async (h: Omit<Annotation, "id" | "bookKey" | "createdAt" | "kind">) => {
    const mark: Annotation = { ...h, id: crypto.randomUUID(), bookKey: book.key, kind: "highlight", createdAt: Date.now() };
    await db.annotations.put(mark);
    setAnnotations((a) => [...a, mark]);
    return mark;
  };

  const removeAnnotation = async (id: string) => {
    await db.annotations.delete(id);
    setAnnotations((a) => a.filter((x) => x.id !== id));
  };

  const isEpub = format === "epub";
  const style = { "--r-bg": theme.bg, "--r-fg": theme.fg } as React.CSSProperties;

  return (
    <div className={`reader ${chrome ? "" : "immersive"} ${settings.theme}`} style={style}>
      <header className="reader-top" data-tauri-drag-region>
        <button className="icon-btn" onClick={close} aria-label="Close book">
          <X />
        </button>
        <button className={`icon-btn ${panel === "toc" ? "on" : ""}`} onClick={() => setPanel(panel === "toc" ? null : "toc")} aria-label="Contents" title="Contents and bookmarks">
          <List />
        </button>
        <div className="reader-title" data-tauri-drag-region>
          <strong>{book.title}</strong>
          <span>{book.author}</span>
        </div>
        {searchApi && (
          <button className={`icon-btn ${panel === "search" ? "on" : ""}`} onClick={() => setPanel(panel === "search" ? null : "search")} aria-label="Search in book" title="Search">
            <Search />
          </button>
        )}
        {format === "pdf" && (
          <>
            <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out">
              <ZoomOut />
            </button>
            <button className="icon-btn" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in">
              <ZoomIn />
            </button>
          </>
        )}
        {format === "cbz" && (
          <button className={`icon-btn ${rtl ? "on" : ""}`} onClick={() => setRtl(!rtl)} aria-label="Right to left (manga)" title="Right to left (manga)">
            <ArrowLeftRight />
          </button>
        )}
        <button className={`icon-btn ${panel === "settings" ? "on" : ""}`} onClick={() => setPanel(panel === "settings" ? null : "settings")} aria-label="Appearance" title="Appearance">
          <Type />
        </button>
        <button className={`icon-btn ${here ? "on" : ""}`} onClick={toggleBookmark} aria-label={here ? "Remove bookmark" : "Add bookmark"} title="Bookmark">
          {here ? <BookmarkCheck /> : <Bookmark />}
        </button>
      </header>

      <div className="reader-stage">
        <button className="page-zone left" onClick={() => (rtl ? nav.current?.next() : nav.current?.prev())} aria-label="Previous page">
          <ChevronLeft />
        </button>
        <div className="reader-page" onClick={() => setChrome((c) => !c)}>
          {error ? (
            <div className="reader-msg">
              <p>This book can't be opened.</p>
              <p className="muted small">{error}</p>
            </div>
          ) : !data || start === undefined ? (
            <div className="reader-msg">
              <Spinner size={28} />
            </div>
          ) : isEpub ? (
            <EpubView
              data={data}
              start={start}
              settings={settings}
              highlights={highlights}
              onLocation={onLocation}
              onToc={setToc}
              onNav={(n) => (nav.current = n)}
              onSearch={(f) => setSearchApi(() => f)}
              onRtl={setRtl}
              onHighlight={addHighlight}
              onError={(e) => console.error(e)}
            />
          ) : format === "pdf" ? (
            <PdfView data={data} start={start} zoom={zoom} onLocation={onLocation} onToc={setToc} onNav={(n) => (nav.current = n)} onSearch={(f) => setSearchApi(() => f)} />
          ) : (
            <ComicView data={data} start={start} rtl={rtl} onLocation={onLocation} onNav={(n) => (nav.current = n)} />
          )}
        </div>
        <button className="page-zone right" onClick={() => (rtl ? nav.current?.prev() : nav.current?.next())} aria-label="Next page">
          <ChevronRight />
        </button>

        {panel === "toc" && (
          <aside className="reader-panel">
            <Segmented
              value="toc"
              onChange={() => {}}
              options={[{ value: "toc", label: "Contents" }]}
            />
            <div className="reader-panel-scroll scroll">
              {toc.length === 0 && <p className="muted small">No table of contents.</p>}
              {toc.map((t, i) => (
                <button key={i} className="toc-item" style={{ paddingLeft: 12 + t.depth * 14 }} onClick={() => (nav.current?.goTo(t.location), setPanel(null))}>
                  {t.label}
                </button>
              ))}
              {bookmarks.length > 0 && <h4>Bookmarks</h4>}
              {bookmarks.map((b) => (
                <div key={b.id} className="toc-item mark">
                  <button onClick={() => (nav.current?.goTo(b.location), setPanel(null))}>
                    <Bookmark size={13} /> {b.text || `${Math.round(b.progress * 100)}%`}
                  </button>
                  <button className="icon-btn tiny" onClick={() => void removeAnnotation(b.id)} aria-label="Remove bookmark">
                    <Trash2 />
                  </button>
                </div>
              ))}
              {highlights.length > 0 && <h4>Highlights</h4>}
              {highlights.map((h) => (
                <div key={h.id} className="toc-item mark">
                  <button onClick={() => (nav.current?.goTo(h.location), setPanel(null))}>
                    <span className="hl-dot" style={{ background: highlightColors[h.color as keyof typeof highlightColors] ?? h.color }} />
                    <span className="hl-text">
                      “{h.text}”{h.note && <em>{h.note}</em>}
                    </span>
                  </button>
                  <button
                    className="icon-btn tiny"
                    onClick={async () => {
                      const note = await prompt("Note", "Your note", h.note ?? "");
                      if (note === null) return;
                      const updated = { ...h, note };
                      await db.annotations.put(updated);
                      setAnnotations((a) => a.map((x) => (x.id === h.id ? updated : x)));
                    }}
                    aria-label="Edit note"
                  >
                    <Type />
                  </button>
                  <button className="icon-btn tiny" onClick={() => void removeAnnotation(h.id)} aria-label="Remove highlight">
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          </aside>
        )}

        {panel === "search" && searchApi && <SearchPanel search={searchApi} goTo={(l) => nav.current?.goTo(l)} />}

        {panel === "settings" && (
          <aside className="reader-panel settings-panel">
            <div className="themes">
              {(Object.keys(readerThemes) as (keyof typeof readerThemes)[]).map((k) => (
                <button key={k} className={`theme-swatch ${settings.theme === k ? "on" : ""}`} style={{ background: readerThemes[k].bg, color: readerThemes[k].fg }} onClick={() => setSettings({ theme: k })}>
                  Aa
                  <span>{readerThemes[k].name}</span>
                </button>
              ))}
            </div>
            {isEpub && (
              <>
                <div className="reader-row">
                  <span>Text Size</span>
                  <div className="stepper">
                    <button className="icon-btn small" onClick={() => setSettings({ textSize: Math.max(60, settings.textSize - 10) })} aria-label="Smaller">
                      <Minus />
                    </button>
                    <span>{settings.textSize}%</span>
                    <button className="icon-btn small" onClick={() => setSettings({ textSize: Math.min(250, settings.textSize + 10) })} aria-label="Bigger">
                      <Plus />
                    </button>
                  </div>
                </div>
                <div className="reader-row">
                  <span>Font</span>
                  <select className="select" value={settings.font} onChange={(e) => setSettings({ font: e.target.value })}>
                    {readerFonts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="reader-row">
                  <span>Line Spacing</span>
                  <Segmented
                    value={String(settings.lineHeight)}
                    onChange={(v) => setSettings({ lineHeight: Number(v) })}
                    options={[
                      { value: "0", label: "Book" },
                      { value: "1.4", label: "Tight" },
                      { value: "1.7", label: "Normal" },
                      { value: "2", label: "Loose" },
                    ]}
                  />
                </div>
                <div className="reader-row">
                  <span>Margins</span>
                  <Segmented
                    value={String(settings.margin)}
                    onChange={(v) => setSettings({ margin: Number(v) })}
                    options={[
                      { value: "16", label: "S" },
                      { value: "48", label: "M" },
                      { value: "96", label: "L" },
                    ]}
                  />
                </div>
                <div className="reader-row">
                  <span>Justify Text</span>
                  <Toggle checked={settings.justify} onChange={(v) => setSettings({ justify: v })} />
                </div>
                <div className="reader-row">
                  <span>Scroll Instead of Pages</span>
                  <Toggle checked={settings.scrolling} onChange={(v) => setSettings({ scrolling: v })} />
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      <footer className="reader-bottom">
        <input
          type="range"
          className="slider"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          style={{ "--pct": `${progress * 100}%` } as React.CSSProperties}
          onChange={(e) => setProgress(Number(e.target.value) / 1000)}
          onPointerUp={(e) => nav.current?.goToFraction(Number((e.target as HTMLInputElement).value) / 1000)}
          aria-label="Position in book"
        />
        <span className="reader-label">
          {label && <span>{label} · </span>}
          {Math.round(progress * 100)}%
        </span>
      </footer>
    </div>
  );
}

function SearchPanel({ search, goTo }: { search: (q: string) => Promise<{ location: string; excerpt: string }[]>; goTo: (l: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ location: string; excerpt: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <aside className="reader-panel">
      <form
        className="reader-search"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!q.trim()) return;
          setBusy(true);
          setResults(await search(q.trim()).catch(() => []));
          setBusy(false);
        }}
      >
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in the book" />
        {busy && <Spinner size={14} />}
      </form>
      <div className="reader-panel-scroll scroll">
        {results?.length === 0 && <p className="muted small">Nothing found.</p>}
        {results?.map((r, i) => (
          <button key={i} className="toc-item result" onClick={() => goTo(r.location)}>
            {r.excerpt}
          </button>
        ))}
      </div>
    </aside>
  );
}

// MARK: EPUB

function EpubView(p: {
  data: ArrayBuffer;
  start: string | null;
  settings: ReaderSettings;
  highlights: Annotation[];
  onLocation: (loc: string, fraction: number, label: string) => void;
  onToc: (toc: TocItem[]) => void;
  onNav: (n: Nav) => void;
  onSearch: (f: (q: string) => Promise<{ location: string; excerpt: string }[]>) => void;
  onRtl: (rtl: boolean) => void;
  onHighlight: (h: Omit<Annotation, "id" | "bookKey" | "createdAt" | "kind">) => Promise<Annotation>;
  onError: (e: unknown) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<any>(null);
  const bookRef = useRef<any>(null);
  const shown = useRef(new Map<string, string>());
  const [selection, setSelection] = useState<{ cfi: string; text: string; x: number; y: number } | null>(null);
  const themeCount = useRef(0);
  const located = useRef(false);
  const callbacks = useRef(p);
  callbacks.current = p;

  const css = useMemo(() => {
    const t = readerThemes[p.settings.theme];
    const font = readerFonts.find((f) => f.id === p.settings.font)?.css;
    const body: Record<string, string> = {
      color: `${t.fg} !important`,
      background: `${t.bg} !important`,
      "font-size": `${p.settings.textSize}% !important`,
      "text-align": p.settings.justify ? "justify !important" : "inherit",
    };
    const inner: Record<string, string> = { color: "inherit !important", background: "transparent !important" };
    if (font) inner["font-family"] = `${font} !important`;
    if (p.settings.lineHeight) inner["line-height"] = `${p.settings.lineHeight} !important`;
    if (p.settings.justify) inner["text-align"] = "justify !important";
    return {
      body,
      "p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6, td, a": inner,
      a: { color: "inherit !important", "text-decoration": "underline" },
      "::selection": { background: "rgba(255, 146, 64, 0.35)" },
    };
  }, [p.settings.theme, p.settings.font, p.settings.textSize, p.settings.lineHeight, p.settings.justify]);

  // Open the book once; layout changes re-render it at the same place.
  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    (async () => {
      const { default: ePub } = await import("epubjs");
      const book = ePub(p.data as any);
      bookRef.current = book;
      await book.ready;
      if (!alive) return;
      const dir = (book as any).packaging?.metadata?.direction ?? (book as any).package?.metadata?.direction;
      callbacks.current.onRtl(dir === "rtl");
      const make = (location?: string) => {
        rendition.current?.destroy();
        shown.current.clear();
        const r = book.renderTo(host.current!, {
          width: "100%",
          height: "100%",
          flow: callbacks.current.settings.scrolling ? "scrolled-doc" : "paginated",
          spread: "auto",
          minSpreadWidth: 900,
          allowScriptedContent: false,
        } as any);
        rendition.current = r;
        applyTheme();
        r.on("relocated", (loc: any) => {
          located.current = true;
          const cfi = loc.start.cfi;
          const fraction = book.locations.length() ? book.locations.percentageFromCfi(cfi) : (loc.start.percentage ?? 0);
          const item = (book.navigation as any)?.get?.(loc.start.href);
          callbacks.current.onLocation(cfi, fraction ?? 0, item?.label?.trim() ?? "");
        });
        r.on("selected", (cfiRange: string, contents: any) => {
          const range = contents.window.getSelection()?.getRangeAt(0);
          const text = range?.toString().trim();
          if (!text) return;
          const rect = range.getBoundingClientRect();
          const frame = contents.document.defaultView.frameElement.getBoundingClientRect();
          setSelection({ cfi: cfiRange, text, x: frame.left + rect.left + rect.width / 2, y: frame.top + rect.top });
        });
        r.on("click", () => setSelection(null));
        r.on("keydown", (e: KeyboardEvent) => window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, shiftKey: e.shiftKey })));
        showHighlights();
        void r.display(location);
      };
      (window as any).__ampliRemake = make;

      const startAt = p.start?.startsWith("fraction:") ? undefined : (p.start ?? undefined);
      make(startAt);

      const toc: TocItem[] = [];
      const walk = (items: any[], depth: number) =>
        items.forEach((i) => {
          toc.push({ label: i.label.trim(), location: i.href, depth });
          if (i.subitems?.length) walk(i.subitems, depth + 1);
        });
      walk(book.navigation?.toc ?? [], 0);
      callbacks.current.onToc(toc);

      callbacks.current.onNav({
        next: () => rendition.current?.next(),
        prev: () => rendition.current?.prev(),
        goTo: (l) => void rendition.current?.display(l),
        goToFraction: (f) => {
          if (book.locations.length()) void rendition.current?.display(book.locations.cfiFromPercentage(f));
        },
      });

      callbacks.current.onSearch(async (q: string) => {
        const results: { location: string; excerpt: string }[] = [];
        for (const item of (book.spine as any).spineItems) {
          await item.load(book.load.bind(book));
          for (const r of item.find(q)) results.push({ location: r.cfi, excerpt: r.excerpt });
          item.unload();
          if (results.length > 200) break;
        }
        return results;
      });

      // Percentages need the book's locations, which take a moment for long books.
      await book.locations.generate(1200);
      if (!alive) return;
      if (p.start?.startsWith("fraction:")) {
        void rendition.current?.display(book.locations.cfiFromPercentage(Number(p.start.slice(9))));
      } else if (located.current) {
        const loc = rendition.current?.currentLocation?.();
        if (loc?.start) callbacks.current.onLocation(loc.start.cfi, book.locations.percentageFromCfi(loc.start.cfi) ?? 0, "");
      }
      ro = new ResizeObserver(() => rendition.current?.resize?.());
      ro.observe(host.current!);
    })().catch((e) => callbacks.current.onError(e));
    return () => {
      alive = false;
      ro?.disconnect();
      rendition.current?.destroy();
      bookRef.current?.destroy();
      rendition.current = null;
    };
  }, [p.data]);

  function applyTheme() {
    const r = rendition.current;
    if (!r) return;
    const name = `ampli${++themeCount.current}`;
    r.themes.register(name, css);
    r.themes.select(name);
    const m = callbacks.current.settings.margin;
    host.current?.style.setProperty("--reader-margin", `${m}px`);
  }

  function showHighlights() {
    const r = rendition.current;
    if (!r) return;
    for (const h of callbacks.current.highlights) {
      if (shown.current.has(h.id)) continue;
      shown.current.set(h.id, h.location);
      r.annotations.highlight(h.location, { id: h.id }, undefined, "ampli-hl", {
        fill: highlightColors[h.color as keyof typeof highlightColors] ?? h.color ?? "#ffd60a",
        "fill-opacity": "0.35",
        "mix-blend-mode": "multiply",
      });
    }
    // Removed highlights.
    for (const [id, cfi] of [...shown.current]) {
      if (callbacks.current.highlights.some((h) => h.id === id)) continue;
      shown.current.delete(id);
      r.annotations.remove(cfi, "highlight");
    }
  }

  useEffect(applyTheme, [css, p.settings.margin]);
  useEffect(showHighlights, [p.highlights]);

  // Pages or scrolling: render again at the same place.
  const firstFlow = useRef(true);
  useEffect(() => {
    if (firstFlow.current) {
      firstFlow.current = false;
      return;
    }
    const loc = rendition.current?.currentLocation?.();
    (window as any).__ampliRemake?.(loc?.start?.cfi);
  }, [p.settings.scrolling]);

  return (
    <>
      <div className="epub-host" ref={host} style={{ padding: `0 ${p.settings.margin}px` }} onClick={(e) => e.stopPropagation()} />
      {selection && (
        <div className="hl-pop" style={{ left: selection.x, top: Math.max(60, selection.y - 52) }} onClick={(e) => e.stopPropagation()}>
          {Object.entries(highlightColors).map(([name, color]) => (
            <button
              key={name}
              className="hl-color"
              style={{ background: color }}
              aria-label={`Highlight ${name}`}
              onClick={async () => {
                const book = bookRef.current;
                const progress = book?.locations?.length() ? book.locations.percentageFromCfi(selection.cfi) : 0;
                await p.onHighlight({ location: selection.cfi, text: selection.text.slice(0, 500), color: name, progress });
                rendition.current?.getContents?.().forEach((c: any) => c.window.getSelection()?.removeAllRanges());
                setSelection(null);
              }}
            />
          ))}
          <button
            className="btn small ghost"
            onClick={async () => {
              const note = await prompt("Add Note", "Note", "");
              if (note === null) return;
              const book = bookRef.current;
              const progress = book?.locations?.length() ? book.locations.percentageFromCfi(selection.cfi) : 0;
              await p.onHighlight({ location: selection.cfi, text: selection.text.slice(0, 500), color: "yellow", note, progress });
              setSelection(null);
            }}
          >
            Note
          </button>
          <button className="btn small ghost" onClick={() => (navigator.clipboard.writeText(selection.text), setSelection(null))}>
            Copy
          </button>
        </div>
      )}
    </>
  );
}

// MARK: PDF

function PdfView(p: {
  data: ArrayBuffer;
  start: string | null;
  zoom: number;
  onLocation: (loc: string, fraction: number, label: string) => void;
  onToc: (toc: TocItem[]) => void;
  onNav: (n: Nav) => void;
  onSearch: (f: (q: string) => Promise<{ location: string; excerpt: string }[]>) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const task = useRef<any>(null);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    let alive = true;
    let loading: any;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      loading = pdfjs.getDocument({ data: new Uint8Array(p.data.slice(0)) });
      const loaded = await loading.promise;
      if (!alive) return;
      setDoc(loaded);
      const startPage = p.start?.startsWith("page:")
        ? Number(p.start.slice(5))
        : p.start?.startsWith("fraction:")
          ? Math.max(1, Math.round(Number(p.start.slice(9)) * loaded.numPages))
          : 1;
      setPage(Math.min(Math.max(1, startPage), loaded.numPages));
      const outline = (await loaded.getOutline()) ?? [];
      const toc: TocItem[] = [];
      const walk = async (items: any[], depth: number) => {
        for (const i of items) {
          let target = 1;
          try {
            const dest = typeof i.dest === "string" ? await loaded.getDestination(i.dest) : i.dest;
            if (dest) target = (await loaded.getPageIndex(dest[0])) + 1;
          } catch {
            /* unresolved */
          }
          toc.push({ label: i.title, location: `page:${target}`, depth });
          if (i.items?.length) await walk(i.items, depth + 1);
        }
      };
      await walk(outline, 0);
      cb.current.onToc(toc);
      cb.current.onSearch(async (q: string) => {
        const out: { location: string; excerpt: string }[] = [];
        const needle = q.toLowerCase();
        for (let n = 1; n <= loaded.numPages && out.length < 200; n++) {
          const text = (await (await loaded.getPage(n)).getTextContent()).items.map((x: any) => x.str).join(" ");
          const at = text.toLowerCase().indexOf(needle);
          if (at >= 0) out.push({ location: `page:${n}`, excerpt: `p. ${n} · …${text.slice(Math.max(0, at - 40), at + 60)}…` });
        }
        return out;
      });
    })();
    return () => {
      alive = false;
      void loading?.destroy?.();
    };
  }, [p.data]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!doc) return;
    const total = doc.numPages;
    cb.current.onNav({
      next: () => setPage((n) => Math.min(n + 1, total)),
      prev: () => setPage((n) => Math.max(n - 1, 1)),
      goTo: (l) => l.startsWith("page:") && setPage(Math.min(Math.max(1, Number(l.slice(5))), total)),
      goToFraction: (f) => setPage(Math.min(Math.max(1, Math.round(f * total) || 1), total)),
    });
  }, [doc]);

  useEffect(() => {
    if (!doc || !size.w || !canvas.current) return;
    let cancelled = false;
    (async () => {
      const pg = await doc.getPage(page);
      if (cancelled) return;
      const base = pg.getViewport({ scale: 1 });
      const fit = Math.min(size.w / base.width, size.h / base.height) * p.zoom;
      const dpr = window.devicePixelRatio || 1;
      const viewport = pg.getViewport({ scale: fit * dpr });
      const c = canvas.current!;
      c.width = viewport.width;
      c.height = viewport.height;
      c.style.width = `${viewport.width / dpr}px`;
      c.style.height = `${viewport.height / dpr}px`;
      task.current?.cancel?.();
      task.current = pg.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport });
      await task.current.promise.catch(() => {});
      cb.current.onLocation(`page:${page}`, doc.numPages > 1 ? (page - 1) / (doc.numPages - 1) : 1, `Page ${page} of ${doc.numPages}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page, size, p.zoom]);

  return (
    <div className={`pdf-box ${p.zoom > 1 ? "zoomed" : ""}`} ref={box}>
      <canvas ref={canvas} className="pdf-page" />
    </div>
  );
}

// MARK: Comics (CBZ)

function ComicView(p: { data: ArrayBuffer; start: string | null; rtl: boolean; onLocation: (loc: string, fraction: number, label: string) => void; onNav: (n: Nav) => void }) {
  const [pages, setPages] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    let urls: string[] = [];
    (async () => {
      const { unzipSync } = await import("fflate");
      const files = unzipSync(new Uint8Array(p.data));
      const names = Object.keys(files)
        .filter((n) => /\.(jpe?g|png|gif|webp|avif)$/i.test(n) && !n.startsWith("__MACOSX"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      urls = names.map((n) => {
        const ext = n.split(".").pop()!.toLowerCase();
        return URL.createObjectURL(new Blob([files[n] as BlobPart], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }));
      });
      setPages(urls);
      const start = p.start?.startsWith("page:") ? Number(p.start.slice(5)) : p.start?.startsWith("fraction:") ? Math.round(Number(p.start.slice(9)) * names.length) : 1;
      setPage(Math.min(Math.max(1, start || 1), Math.max(1, names.length)));
    })();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [p.data]);

  useEffect(() => {
    const total = pages.length;
    if (!total) return;
    cb.current.onNav({
      next: () => setPage((n) => Math.min(n + 1, total)),
      prev: () => setPage((n) => Math.max(n - 1, 1)),
      goTo: (l) => l.startsWith("page:") && setPage(Number(l.slice(5))),
      goToFraction: (f) => setPage(Math.min(Math.max(1, Math.round(f * total) || 1), total)),
    });
    cb.current.onLocation(`page:${page}`, total > 1 ? (page - 1) / (total - 1) : 1, `Page ${page} of ${total}`);
  }, [pages, page]);

  if (!pages.length) return <div className="reader-msg"><Spinner size={28} /></div>;
  return (
    <div className="comic">
      <img src={pages[page - 1]} alt={`Page ${page}`} />
    </div>
  );
}
