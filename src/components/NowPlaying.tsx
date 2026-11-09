import { ChevronDown, Heart, ListMusic, Moon, MoreHorizontal, Repeat, Repeat1, RotateCcw, RotateCw, Shuffle, SkipBack, SkipForward, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { artworkURL, coverURL, dominantColor } from "../lib/artwork";
import { audiobook, chapterAt, useAudiobook } from "../lib/audiobook";
import { useSource } from "../lib/engine";
import { long, time } from "../lib/format";
import { index, setFavorite, useLibrary } from "../lib/library";
import { go, useNav } from "../lib/nav";
import { player, usePlayer } from "../lib/player";
import { displayName, radio, station, subtitle, useRadio } from "../lib/radio";
import { showMenu, showMenuAt } from "../lib/ui";
import { Artwork } from "./Artwork";
import { trackMenu } from "./menus";
import { PlayButton, rateMenu, sleepMenu, Volume } from "./PlayerBar";
import { Bars } from "./Shelf";
import { Progress } from "./Slider";
import { StationArt } from "./Tiles";

function useTint(url?: string, fallback = "#3a3a46") {
  const [color, setColor] = useState(fallback);
  useEffect(() => {
    let alive = true;
    void dominantColor(url).then((c) => alive && setColor(c ?? fallback));
    return () => {
      alive = false;
    };
  }, [url, fallback]);
  return color;
}

export function NowPlaying() {
  const source = useSource((s) => s.source);
  const close = () => useNav.setState({ overlay: null });
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return source === "audiobook" ? <AudiobookNow close={close} /> : source === "radio" ? <RadioNow close={close} /> : <MusicNow close={close} />;
}

function Shell({ tint, children, close }: { tint: string; children: React.ReactNode; close: () => void }) {
  return (
    <div className="now" style={{ "--tint": tint } as React.CSSProperties}>
      <div className="now-bg" />
      <div className="now-top" data-tauri-drag-region>
        <button className="icon-btn" onClick={close} aria-label="Close player">
          <ChevronDown />
        </button>
      </div>
      <div className="now-body">{children}</div>
    </div>
  );
}

function MusicNow({ close }: { close: () => void }) {
  const s = usePlayer();
  useLibrary((l) => l.version);
  const t = s.queue[s.index];
  const art = t ? artworkURL(t.serverId, t.artworkId, 600) : undefined;
  const tint = useTint(art);
  if (!t) return null;
  const song = index.song.get(t.key);
  const upcoming = s.queue.slice(s.index + 1, s.index + 60);
  return (
    <Shell tint={tint} close={close}>
      <div className="now-main">
        <Artwork src={art} seed={t.album || t.title} className={`now-art ${s.playing ? "playing" : ""}`} />
        <div className="now-meta">
          <div className="now-titles">
            <h1>{t.title}</h1>
            <p>
              {t.artistKey ? <a onClick={() => (close(), go({ name: "artist", key: t.artistKey! }))}>{t.artist}</a> : t.artist}
              {t.album && (
                <>
                  {" — "}
                  {t.albumKey ? <a onClick={() => (close(), go({ name: "album", key: t.albumKey! }))}>{t.album}</a> : t.album}
                </>
              )}
            </p>
          </div>
          <div className="now-actions">
            {song && (
              <button className={`icon-btn heart ${song.favorite ? "on" : ""}`} onClick={() => void setFavorite("song", song.key, !song.favorite)} aria-label="Favourite">
                <Heart fill={song.favorite ? "currentColor" : "none"} />
              </button>
            )}
            <button className="icon-btn" onClick={(e) => showMenu(e, trackMenu(t))} aria-label="More">
              <MoreHorizontal />
            </button>
          </div>
        </div>
        <Progress position={s.position} duration={s.duration || t.duration} onSeek={(x) => player.seek(x)} />
        <div className="now-controls">
          <button className={`icon-btn toggleable ${s.shuffle ? "on" : ""}`} onClick={() => player.setShuffle(!s.shuffle)} aria-label="Shuffle">
            <Shuffle />
          </button>
          <button className="icon-btn big" onClick={() => player.previous()} aria-label="Previous">
            <SkipBack fill="currentColor" />
          </button>
          <PlayButton big playing={s.playing} buffering={s.buffering && s.playing} onClick={() => player.toggle()} />
          <button className="icon-btn big" onClick={() => player.next()} aria-label="Next">
            <SkipForward fill="currentColor" />
          </button>
          <button className={`icon-btn toggleable ${s.repeat !== "off" ? "on" : ""}`} onClick={() => player.cycleRepeat()} aria-label="Repeat">
            {s.repeat === "one" ? <Repeat1 /> : <Repeat />}
          </button>
        </div>
        <div className="now-bottom">
          <button
            className={`icon-btn toggleable ${s.sleepAt || s.sleepEndOfTrack ? "on" : ""}`}
            onClick={(e) => showMenuAt(e.currentTarget, sleepMenu((m) => player.sleep(m), !!s.sleepAt || s.sleepEndOfTrack, { label: "End of Song", action: () => player.sleep("track") }))}
            aria-label="Sleep Timer"
          >
            <Moon />
          </button>
          <Volume />
        </div>
      </div>
      <aside className="now-side">
        <h3>Up Next</h3>
        {upcoming.length === 0 && <p className="muted">Nothing else in the queue.</p>}
        <div className="now-list">
          {upcoming.map((u, i) => (
            <button key={u.key + i} className="now-item" onClick={() => player.jump(s.index + 1 + i)} onContextMenu={(e) => showMenu(e, trackMenu(u))}>
              <Artwork src={artworkURL(u.serverId, u.artworkId, 48)} seed={u.album || u.title} className="tiny" />
              <span className="titles">
                <span className="t1">{u.title}</span>
                <span className="t2">{u.artist}</span>
              </span>
              <span className="time">{time(u.duration)}</span>
            </button>
          ))}
        </div>
      </aside>
    </Shell>
  );
}

function AudiobookNow({ close }: { close: () => void }) {
  const s = useAudiobook();
  const art = s.book ? coverURL(s.book.serverId, s.book.artworkId, 600) : undefined;
  const tint = useTint(art);
  if (!s.book) return null;
  const chapter = chapterAt(s.detail, s.position);
  const chapterIndex = chapter ? s.detail!.chapters.indexOf(chapter) : -1;
  const left = (s.duration - s.position) / s.rate;
  return (
    <Shell tint={tint} close={close}>
      <div className="now-main">
        <Artwork src={art} seed={s.book.title} className={`now-art ${s.playing ? "playing" : ""}`} />
        <div className="now-meta">
          <div className="now-titles">
            <h1>{s.book.title}</h1>
            <p>
              {s.book.author}
              {s.book.narrator ? ` · read by ${s.book.narrator}` : ""}
            </p>
          </div>
        </div>
        {chapter ? (
          <Progress position={s.position - chapter.start} duration={chapter.end - chapter.start} onSeek={(x) => audiobook.seek(chapter.start + x)} />
        ) : (
          <Progress position={s.position} duration={s.duration} onSeek={(x) => audiobook.seek(x)} />
        )}
        <p className="now-caption">
          {chapter ? `${chapter.title} · ` : ""}
          {long(left)} left in the book
        </p>
        <div className="now-controls">
          <button className="chip" onClick={(e) => showMenuAt(e.currentTarget, rateMenu(s.rate))}>
            {s.rate}×
          </button>
          <button className="icon-btn big skip" onClick={() => audiobook.skip(-15)} aria-label="Back 15 seconds">
            <RotateCcw />
            <span>15</span>
          </button>
          <PlayButton big playing={s.playing} buffering={s.buffering && s.playing} onClick={() => audiobook.toggle()} />
          <button className="icon-btn big skip" onClick={() => audiobook.skip(30)} aria-label="Forward 30 seconds">
            <RotateCw />
            <span>30</span>
          </button>
          <button
            className={`icon-btn toggleable ${s.sleepAt || s.sleepEndOfChapter ? "on" : ""}`}
            onClick={(e) =>
              showMenuAt(e.currentTarget, sleepMenu((m) => audiobook.sleep(m), !!s.sleepAt || s.sleepEndOfChapter, { label: "End of Chapter", action: () => audiobook.sleep("chapter") }))
            }
            aria-label="Sleep Timer"
          >
            <Moon />
          </button>
        </div>
        <div className="now-bottom">
          <Volume />
        </div>
      </div>
      <aside className="now-side">
        <h3>Chapters</h3>
        {!s.detail?.chapters.length && <p className="muted">This book has no chapters.</p>}
        <div className="now-list">
          {s.detail?.chapters.map((c, i) => (
            <button key={i} className={`now-item chapter ${i === chapterIndex ? "current" : ""}`} onClick={() => audiobook.seek(c.start, true)}>
              <span className="num">{i === chapterIndex ? <Bars playing={s.playing} /> : i + 1}</span>
              <span className="titles">
                <span className="t1">{c.title}</span>
              </span>
              <span className="time">{time(c.end - c.start)}</span>
            </button>
          ))}
        </div>
      </aside>
    </Shell>
  );
}

function RadioNow({ close }: { close: () => void }) {
  const s = useRadio();
  if (!s.current) return null;
  const fav = s.favorites.includes(s.current.id);
  const others = (s.favorites.length ? s.favorites : s.recents).map(station).filter((x) => !!x);
  return (
    <Shell tint={s.current.color} close={close}>
      <div className="now-main">
        <StationArt station={s.current} className={`now-art ${s.playing ? "playing" : ""}`} />
        <div className="now-meta">
          <div className="now-titles">
            <h1>{s.onAir?.title ?? displayName(s.current)}</h1>
            <p>{s.onAir ? `${s.onAir.artist ? s.onAir.artist + " · " : ""}${displayName(s.current)}` : subtitle(s.current)}</p>
          </div>
          <div className="now-actions">
            <button className={`icon-btn heart ${fav ? "on" : ""}`} onClick={() => radio.toggleFavorite(s.current!)} aria-label="Favourite">
              <Heart fill={fav ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
        <Progress position={0} duration={0} live />
        <div className="now-controls">
          <button className="icon-btn big" onClick={() => radio.step(-1)} aria-label="Previous station">
            <SkipBack fill="currentColor" />
          </button>
          <PlayButton big playing={s.playing || s.buffering} buffering={s.buffering} onClick={() => radio.toggle()} />
          <button className="icon-btn big" onClick={() => radio.step(1)} aria-label="Next station">
            <SkipForward fill="currentColor" />
          </button>
        </div>
        <div className="now-bottom">
          <button
            className={`icon-btn toggleable ${s.sleepAt ? "on" : ""}`}
            onClick={(e) => showMenuAt(e.currentTarget, sleepMenu((m) => radio.sleep(m), !!s.sleepAt))}
            aria-label="Sleep Timer"
          >
            <Moon />
          </button>
          <Volume />
        </div>
      </div>
      <aside className="now-side">
        <h3>{s.favorites.length ? "Favourite Stations" : "Recently Played"}</h3>
        <div className="now-list">
          {others.map((o) => (
            <button key={o!.id} className={`now-item ${o!.id === s.current!.id ? "current" : ""}`} onClick={() => radio.play(o!, others as never)}>
              <StationArt station={o!} className="tiny" />
              <span className="titles">
                <span className="t1">{displayName(o!)}</span>
                <span className="t2">{subtitle(o!)}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>
    </Shell>
  );
}

export function QueuePanel() {
  const s = usePlayer();
  const close = () => useNav.setState({ overlay: null });
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const t = s.queue[s.index];
  const upcoming = s.queue.slice(s.index + 1);
  return (
    <aside className="queue">
      <header>
        <h2>
          <ListMusic size={18} /> Queue
        </h2>
        <div className="row-gap">
          {upcoming.length > 0 && (
            <button className="btn small ghost" onClick={() => player.clearUpcoming()}>
              Clear
            </button>
          )}
          <button className="icon-btn small" onClick={close} aria-label="Close queue">
            <X />
          </button>
        </div>
      </header>
      <div className="queue-scroll scroll">
        {t && (
          <>
            <h4>Now Playing</h4>
            <div className="now-item current">
              <Artwork src={artworkURL(t.serverId, t.artworkId, 48)} seed={t.album || t.title} className="tiny" />
              <span className="titles">
                <span className="t1">{t.title}</span>
                <span className="t2">{t.artist}</span>
              </span>
              <Bars playing={s.playing} />
            </div>
          </>
        )}
        <h4>
          Up Next <span className="muted">· {upcoming.length}</span>
        </h4>
        {upcoming.length === 0 && <p className="muted small">Songs you add show up here.</p>}
        {upcoming.map((u, i) => {
          const at = s.index + 1 + i;
          return (
            <div
              key={u.key + at}
              className={`now-item ${drag?.over === at && drag.from !== at ? "drop" : ""}`}
              draggable
              onDragStart={() => setDrag({ from: at, over: at })}
              onDragOver={(e) => {
                e.preventDefault();
                if (drag && drag.over !== at) setDrag({ ...drag, over: at });
              }}
              onDrop={() => {
                if (drag && drag.from !== drag.over) player.move(drag.from, drag.over);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              onDoubleClick={() => player.jump(at)}
              onContextMenu={(e) => showMenu(e, trackMenu(u, [{ label: "Remove from Queue", icon: <Trash2 />, action: () => player.remove(at) }]))}
            >
              <Artwork src={artworkURL(u.serverId, u.artworkId, 48)} seed={u.album || u.title} className="tiny" />
              <span className="titles">
                <span className="t1">{u.title}</span>
                <span className="t2">{u.artist}</span>
              </span>
              <button className="icon-btn tiny ghost-x" onClick={() => player.remove(at)} aria-label="Remove">
                <X />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
