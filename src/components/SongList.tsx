import { ArrowDownToLine, Clock, GripVertical, Heart, MoreHorizontal, Play } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { artworkURL } from "../lib/artwork";
import { useDownloads } from "../lib/downloads";
import { time } from "../lib/format";
import { setFavorite } from "../lib/library";
import { go } from "../lib/nav";
import { usePlayer } from "../lib/player";
import { showMenu, type MenuEntry } from "../lib/ui";
import type { Track } from "../lib/types";
import { Artwork } from "./Artwork";
import { Bars } from "./Shelf";
import { trackMenu } from "./menus";

const ROW = 56;

/** Renders only the rows in view; the page (`.content`) scrolls. */
function useVirtual(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 40) });
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.closest(".content, .scroll") as HTMLElement | null;
    if (!el || !scroller) return setRange({ start: 0, end: count });
    const update = () => {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const start = Math.max(0, Math.floor(-top / ROW) - 10);
      const end = Math.min(count, Math.ceil((scroller.clientHeight - top) / ROW) + 10);
      setRange((r) => (r.start === start && r.end === end ? r : { start, end: Math.max(start, end) }));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [count]);
  return { ref, ...range };
}

export interface SongListProps {
  tracks: Track[];
  /** Plays the list from a row. */
  onPlay: (index: number) => void;
  showArtwork?: boolean;
  showAlbum?: boolean;
  /** Track numbers instead of positions (albums). */
  numbers?: (number | string | undefined)[];
  favorites?: Set<string>;
  menuExtra?: (index: number) => MenuEntry[];
  onMove?: (from: number, to: number) => void;
}

export function SongList({ tracks, onPlay, showArtwork = true, showAlbum = true, numbers, favorites, menuExtra, onMove }: SongListProps) {
  const { ref, start, end } = useVirtual(tracks.length);
  const currentKey = usePlayer((s) => s.queue[s.index]?.key);
  const playing = usePlayer((s) => s.playing);
  const records = useDownloads((s) => s.records);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);

  useEffect(() => setSelected(null), [tracks]);

  const rows = [];
  for (let i = start; i < end; i++) {
    const t = tracks[i];
    if (!t) continue;
    rows.push(
      <SongRow
        key={t.key + ":" + i}
        track={t}
        index={i}
        number={numbers ? numbers[i] : i + 1}
        top={i * ROW}
        isCurrent={t.key === currentKey}
        playing={playing}
        selected={selected === i}
        showArtwork={showArtwork}
        showAlbum={showAlbum}
        favorite={favorites?.has(t.key)}
        downloaded={records.has(t.key)}
        onSelect={() => setSelected(i)}
        onPlay={() => onPlay(i)}
        onMenu={(e) => showMenu(e, trackMenu(t, menuExtra?.(i)))}
        draggable={!!onMove}
        dropTarget={drag?.over === i && drag.from !== i}
        onDragStart={() => setDrag({ from: i, over: i })}
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          if (drag.over !== i) setDrag({ ...drag, over: i });
        }}
        onDrop={() => {
          if (drag && drag.from !== drag.over) onMove?.(drag.from, drag.over);
          setDrag(null);
        }}
        onDragEnd={() => setDrag(null)}
      />,
    );
  }

  return (
    <div
      className={`songlist ${showAlbum ? "with-album" : ""}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (selected === null) return;
        if (e.key === "ArrowDown") (e.preventDefault(), setSelected(Math.min(selected + 1, tracks.length - 1)));
        if (e.key === "ArrowUp") (e.preventDefault(), setSelected(Math.max(selected - 1, 0)));
        if (e.key === "Enter") onPlay(selected);
      }}
    >
      <div className="songlist-head">
        <span className="c-num">#</span>
        <span className="c-title">Title</span>
        {showAlbum && <span className="c-album">Album</span>}
        <span className="c-fav" />
        <span className="c-time">
          <Clock size={14} />
        </span>
        <span className="c-more" />
      </div>
      <div ref={ref} className="songlist-body" style={{ height: tracks.length * ROW }}>
        {rows}
      </div>
    </div>
  );
}

const SongRow = memo(function SongRow(p: {
  track: Track;
  index: number;
  number?: number | string;
  top: number;
  isCurrent: boolean;
  playing: boolean;
  selected: boolean;
  showArtwork: boolean;
  showAlbum: boolean;
  favorite?: boolean;
  downloaded: boolean;
  draggable: boolean;
  dropTarget: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onMenu: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const t = p.track;
  return (
    <div
      className={`song-row ${p.isCurrent ? "current" : ""} ${p.selected ? "selected" : ""} ${p.dropTarget ? "drop" : ""}`}
      style={{ transform: `translateY(${p.top}px)` }}
      onClick={p.onSelect}
      onDoubleClick={p.onPlay}
      onContextMenu={p.onMenu}
      draggable={p.draggable}
      onDragStart={p.onDragStart}
      onDragOver={p.onDragOver}
      onDrop={p.onDrop}
      onDragEnd={p.onDragEnd}
    >
      <span className="c-num">
        {p.draggable && <GripVertical className="grip" size={14} />}
        {p.isCurrent ? <Bars playing={p.playing} /> : <span className="num">{p.number ?? ""}</span>}
        <button className="row-play" onClick={(e) => (e.stopPropagation(), p.onPlay())} aria-label={`Play ${t.title}`}>
          <Play size={14} fill="currentColor" />
        </button>
      </span>
      <span className="c-title">
        {p.showArtwork && <Artwork src={artworkURL(t.serverId, t.artworkId, 48)} seed={t.album || t.title} className="tiny" />}
        <span className="titles">
          <span className="t1">{t.title}</span>
          <span className="t2">
            {p.downloaded && <ArrowDownToLine size={12} className="dl" />}
            {t.artistKey ? (
              <a onClick={(e) => (e.stopPropagation(), go({ name: "artist", key: t.artistKey! }))}>{t.artist}</a>
            ) : (
              t.artist
            )}
          </span>
        </span>
      </span>
      {p.showAlbum && (
        <span className="c-album">
          {t.albumKey ? <a onClick={(e) => (e.stopPropagation(), go({ name: "album", key: t.albumKey! }))}>{t.album}</a> : t.album}
        </span>
      )}
      <span className="c-fav">
        {!t.catalog && (
          <button
            className={`heart ${p.favorite ? "on" : ""}`}
            onClick={(e) => (e.stopPropagation(), void setFavorite("song", t.key, !p.favorite))}
            aria-label={p.favorite ? "Remove from Favourites" : "Favourite"}
          >
            <Heart size={15} fill={p.favorite ? "currentColor" : "none"} />
          </button>
        )}
      </span>
      <span className="c-time">{t.duration ? time(t.duration) : ""}</span>
      <span className="c-more">
        <button className="icon-btn small" onClick={(e) => (e.stopPropagation(), p.onMenu(e))} aria-label="More">
          <MoreHorizontal />
        </button>
      </span>
    </div>
  );
});
