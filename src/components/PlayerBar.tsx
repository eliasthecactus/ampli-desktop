import {
  ChevronsUp,
  Heart,
  ListMusic,
  Moon,
  Pause,
  PictureInPicture2,
  Play,
  Radio as RadioIcon,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useState } from "react";
import { artworkURL, coverURL } from "../lib/artwork";
import { audiobook, chapterAt, useAudiobook } from "../lib/audiobook";
import { useSource } from "../lib/engine";
import { index, setFavorite, useLibrary } from "../lib/library";
import { setMiniPlayer } from "../lib/native";
import { go, useNav } from "../lib/nav";
import { player, usePlayer } from "../lib/player";
import { displayName, radio, subtitle, useRadio } from "../lib/radio";
import { useSettings } from "../lib/settings";
import { showMenuAt, type MenuEntry } from "../lib/ui";
import { Artwork } from "./Artwork";
import { Spinner } from "./Shelf";
import { Progress, Slider } from "./Slider";
import { StationArt } from "./Tiles";

export function PlayButton({ playing, buffering, onClick, big }: { playing: boolean; buffering?: boolean; onClick: () => void; big?: boolean }) {
  return (
    <button className={`play-btn ${big ? "big" : ""}`} onClick={onClick} aria-label={playing ? "Pause" : "Play"}>
      {buffering ? <Spinner size={big ? 26 : 18} /> : playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
    </button>
  );
}

export function Volume() {
  const volume = useSettings((s) => s.volume);
  const [before, setBefore] = useState(0.8);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="volume">
      <button
        className="icon-btn"
        aria-label={volume === 0 ? "Unmute" : "Mute"}
        onClick={() => {
          if (volume > 0) {
            setBefore(volume);
            player.setVolume(0);
          } else player.setVolume(before || 0.8);
        }}
      >
        <Icon />
      </button>
      <Slider label="Volume" value={volume} max={1} step={0.01} onLive={(v) => player.setVolume(v)} onChange={(v) => player.setVolume(v)} />
    </div>
  );
}

export function sleepMenu(set: (m: number | null) => void, active: boolean, extra?: MenuEntry): MenuEntry[] {
  return [
    { header: "Sleep Timer" },
    ...[5, 15, 30, 45, 60, 90].map((m) => ({ label: `${m} minutes`, action: () => set(m) })),
    ...(extra ? [extra] : []),
    ...(active ? ["separator" as const, { label: "Turn Off", action: () => set(null) }] : []),
  ];
}

function MusicBar() {
  const s = usePlayer();
  const t = s.queue[s.index];
  useLibrary((l) => l.version);
  const song = t ? index.song.get(t.key) : undefined;
  const overlay = useNav((n) => n.overlay);
  const setOverlay = useNav((n) => n.setOverlay);
  if (!t) return <EmptyBar />;
  const sleeping = !!s.sleepAt || s.sleepEndOfTrack;
  return (
    <>
      <div className="pb-now">
        <button className="pb-art" onClick={() => setOverlay(overlay === "player" ? null : "player")} aria-label="Show player">
          <Artwork src={artworkURL(t.serverId, t.artworkId, 64)} seed={t.album || t.title} />
          <span className="pb-expand">
            <ChevronsUp size={16} />
          </span>
        </button>
        <div className="pb-titles">
          <div className="pb-title" title={t.title}>
            {t.title}
          </div>
          <div className="pb-sub">
            {t.artistKey ? <a onClick={() => go({ name: "artist", key: t.artistKey! })}>{t.artist}</a> : t.artist}
            {t.album && (
              <>
                {" · "}
                {t.albumKey ? <a onClick={() => go({ name: "album", key: t.albumKey! })}>{t.album}</a> : t.album}
              </>
            )}
          </div>
        </div>
        {song && (
          <button className={`heart ${song.favorite ? "on" : ""}`} onClick={() => void setFavorite("song", song.key, !song.favorite)} aria-label="Favourite">
            <Heart size={17} fill={song.favorite ? "currentColor" : "none"} />
          </button>
        )}
      </div>
      <div className="pb-center">
        <div className="pb-controls">
          <button className={`icon-btn toggleable ${s.shuffle ? "on" : ""}`} onClick={() => player.setShuffle(!s.shuffle)} aria-label="Shuffle" title="Shuffle">
            <Shuffle />
          </button>
          <button className="icon-btn" onClick={() => player.previous()} aria-label="Previous">
            <SkipBack fill="currentColor" />
          </button>
          <PlayButton playing={s.playing} buffering={s.buffering && s.playing} onClick={() => player.toggle()} />
          <button className="icon-btn" onClick={() => player.next()} aria-label="Next">
            <SkipForward fill="currentColor" />
          </button>
          <button className={`icon-btn toggleable ${s.repeat !== "off" ? "on" : ""}`} onClick={() => player.cycleRepeat()} aria-label="Repeat" title="Repeat">
            {s.repeat === "one" ? <Repeat1 /> : <Repeat />}
          </button>
        </div>
        <Progress position={s.position} duration={s.duration || t.duration} onSeek={(x) => player.seek(x)} />
      </div>
      <div className="pb-tools">
        <button
          className={`icon-btn toggleable ${sleeping ? "on" : ""}`}
          title="Sleep Timer"
          aria-label="Sleep Timer"
          onClick={(e) => showMenuAt(e.currentTarget, sleepMenu((m) => player.sleep(m), sleeping, { label: "End of Song", action: () => player.sleep("track") }))}
        >
          <Moon />
        </button>
        <button className="icon-btn" title="Equalizer" aria-label="Equalizer" onClick={() => go({ name: "settings", section: "sound" })}>
          <SlidersHorizontal />
        </button>
        <button className={`icon-btn toggleable ${overlay === "queue" ? "on" : ""}`} title="Queue" aria-label="Queue" onClick={() => setOverlay(overlay === "queue" ? null : "queue")}>
          <ListMusic />
        </button>
        <Volume />
        <MiniButton />
      </div>
    </>
  );
}

function MiniButton() {
  return (
    <button className="icon-btn" title="Mini Player (⌥⌘M)" aria-label="Mini Player" onClick={() => void enterMini()}>
      <PictureInPicture2 />
    </button>
  );
}

export async function enterMini() {
  useNav.setState({ overlay: null });
  document.documentElement.classList.add("mini");
  await setMiniPlayer(true);
}

export async function leaveMini() {
  document.documentElement.classList.remove("mini");
  await setMiniPlayer(false);
}

const rates = [0.5, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function rateMenu(rate: number): MenuEntry[] {
  return [{ header: "Speed" }, ...rates.map((r) => ({ label: `${r}×`, checked: r === rate, action: () => audiobook.setRate(r) }))];
}

function AudiobookBar() {
  const s = useAudiobook();
  const overlay = useNav((n) => n.overlay);
  const setOverlay = useNav((n) => n.setOverlay);
  if (!s.book) return <EmptyBar />;
  const chapter = chapterAt(s.detail, s.position);
  const sleeping = !!s.sleepAt || s.sleepEndOfChapter;
  return (
    <>
      <div className="pb-now">
        <button className="pb-art" onClick={() => setOverlay(overlay === "player" ? null : "player")} aria-label="Show player">
          <Artwork src={coverURL(s.book.serverId, s.book.artworkId, 64)} seed={s.book.title} />
          <span className="pb-expand">
            <ChevronsUp size={16} />
          </span>
        </button>
        <div className="pb-titles">
          <div className="pb-title">{s.book.title}</div>
          <div className="pb-sub">{chapter?.title ?? s.book.author}</div>
        </div>
      </div>
      <div className="pb-center">
        <div className="pb-controls">
          <button className="icon-btn" onClick={() => audiobook.chapter(-1)} aria-label="Previous chapter">
            <SkipBack fill="currentColor" />
          </button>
          <button className="icon-btn skip" onClick={() => audiobook.skip(-15)} aria-label="Back 15 seconds">
            <RotateCcw />
            <span>15</span>
          </button>
          <PlayButton playing={s.playing} buffering={s.buffering && s.playing} onClick={() => audiobook.toggle()} />
          <button className="icon-btn skip" onClick={() => audiobook.skip(30)} aria-label="Forward 30 seconds">
            <RotateCw />
            <span>30</span>
          </button>
          <button className="icon-btn" onClick={() => audiobook.chapter(1)} aria-label="Next chapter">
            <SkipForward fill="currentColor" />
          </button>
        </div>
        <Progress position={s.position} duration={s.duration} onSeek={(x) => audiobook.seek(x)} />
      </div>
      <div className="pb-tools">
        <button className="chip" onClick={(e) => showMenuAt(e.currentTarget, rateMenu(s.rate))} title="Speed">
          {s.rate}×
        </button>
        <button
          className={`icon-btn toggleable ${sleeping ? "on" : ""}`}
          title="Sleep Timer"
          aria-label="Sleep Timer"
          onClick={(e) => showMenuAt(e.currentTarget, sleepMenu((m) => audiobook.sleep(m), sleeping, { label: "End of Chapter", action: () => audiobook.sleep("chapter") }))}
        >
          <Moon />
        </button>
        <Volume />
        <MiniButton />
      </div>
    </>
  );
}

function RadioBar() {
  const s = useRadio();
  const overlay = useNav((n) => n.overlay);
  const setOverlay = useNav((n) => n.setOverlay);
  if (!s.current) return <EmptyBar />;
  const fav = s.favorites.includes(s.current.id);
  return (
    <>
      <div className="pb-now">
        <button className="pb-art" onClick={() => setOverlay(overlay === "player" ? null : "player")} aria-label="Show player">
          <StationArt station={s.current} />
          <span className="pb-expand">
            <ChevronsUp size={16} />
          </span>
        </button>
        <div className="pb-titles">
          <div className="pb-title">{s.onAir ? s.onAir.title : displayName(s.current)}</div>
          <div className="pb-sub">{s.onAir ? `${s.onAir.artist ? s.onAir.artist + " · " : ""}${displayName(s.current)}` : subtitle(s.current)}</div>
        </div>
        <button className={`heart ${fav ? "on" : ""}`} onClick={() => radio.toggleFavorite(s.current!)} aria-label="Favourite">
          <Heart size={17} fill={fav ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="pb-center">
        <div className="pb-controls">
          <button className="icon-btn" onClick={() => radio.step(-1)} aria-label="Previous station">
            <SkipBack fill="currentColor" />
          </button>
          <PlayButton playing={s.playing || s.buffering} buffering={s.buffering} onClick={() => radio.toggle()} />
          <button className="icon-btn" onClick={() => radio.step(1)} aria-label="Next station">
            <SkipForward fill="currentColor" />
          </button>
        </div>
        <Progress position={0} duration={0} live />
      </div>
      <div className="pb-tools">
        <button
          className={`icon-btn toggleable ${s.sleepAt ? "on" : ""}`}
          title="Sleep Timer"
          aria-label="Sleep Timer"
          onClick={(e) => showMenuAt(e.currentTarget, sleepMenu((m) => radio.sleep(m), !!s.sleepAt))}
        >
          <Moon />
        </button>
        <button className="icon-btn" title="Radio" aria-label="Radio" onClick={() => go({ name: "radio" })}>
          <RadioIcon />
        </button>
        <Volume />
        <MiniButton />
      </div>
    </>
  );
}

function EmptyBar() {
  return (
    <>
      <div className="pb-now">
        <div className="pb-art idle">
          <Artwork seed="" />
        </div>
        <div className="pb-titles">
          <div className="pb-title muted">Not Playing</div>
        </div>
      </div>
      <div className="pb-center">
        <div className="pb-controls">
          <button className="icon-btn" disabled aria-label="Previous">
            <SkipBack fill="currentColor" />
          </button>
          <PlayButton playing={false} onClick={() => {}} />
          <button className="icon-btn" disabled aria-label="Next">
            <SkipForward fill="currentColor" />
          </button>
        </div>
        <Progress position={0} duration={0} />
      </div>
      <div className="pb-tools">
        <Volume />
      </div>
    </>
  );
}

export function PlayerBar() {
  const source = useSource((s) => s.source);
  return (
    <footer className="playerbar">
      {source === "audiobook" ? <AudiobookBar /> : source === "radio" ? <RadioBar /> : <MusicBar />}
    </footer>
  );
}
