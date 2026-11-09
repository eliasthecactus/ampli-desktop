import { Maximize2, SkipBack, SkipForward } from "lucide-react";
import { artworkURL, coverURL } from "../lib/artwork";
import { audiobook, chapterAt, useAudiobook } from "../lib/audiobook";
import { useSource } from "../lib/engine";
import { player, usePlayer } from "../lib/player";
import { displayName, radio, useRadio } from "../lib/radio";
import { Artwork } from "./Artwork";
import { leaveMini, PlayButton } from "./PlayerBar";
import { StationArt } from "./Tiles";

/** The small window that stays on top (⌥⌘M). */
export function MiniPlayer() {
  const source = useSource((s) => s.source);
  const music = usePlayer();
  const book = useAudiobook();
  const r = useRadio();

  let art = <Artwork seed="" />;
  let title = "Not Playing";
  let sub = "";
  let playing = false;
  let buffering = false;
  let progress = 0;
  let toggle = () => {};
  let prev = () => {};
  let next = () => {};

  if (source === "audiobook" && book.book) {
    art = <Artwork src={coverURL(book.book.serverId, book.book.artworkId, 120)} seed={book.book.title} />;
    title = book.book.title;
    sub = chapterAt(book.detail, book.position)?.title ?? book.book.author;
    playing = book.playing;
    buffering = book.buffering;
    progress = book.duration ? book.position / book.duration : 0;
    toggle = () => audiobook.toggle();
    prev = () => audiobook.skip(-15);
    next = () => audiobook.skip(30);
  } else if (source === "radio" && r.current) {
    art = <StationArt station={r.current} />;
    title = r.onAir?.title ?? displayName(r.current);
    sub = r.onAir?.artist ?? displayName(r.current);
    playing = r.playing || r.buffering;
    buffering = r.buffering;
    toggle = () => radio.toggle();
    prev = () => radio.step(-1);
    next = () => radio.step(1);
  } else {
    const t = music.queue[music.index];
    if (t) {
      art = <Artwork src={artworkURL(t.serverId, t.artworkId, 120)} seed={t.album || t.title} />;
      title = t.title;
      sub = t.artist;
      playing = music.playing;
      buffering = music.buffering;
      progress = (music.duration || t.duration) ? music.position / (music.duration || t.duration) : 0;
      toggle = () => player.toggle();
      prev = () => player.previous();
      next = () => player.next();
    }
  }

  return (
    <div className="mini-player" data-tauri-drag-region>
      <div className="mini-art" data-tauri-drag-region>
        {art}
      </div>
      <div className="mini-main" data-tauri-drag-region>
        <div className="mini-titles" data-tauri-drag-region>
          <div className="pb-title">{title}</div>
          <div className="pb-sub">{sub}</div>
        </div>
        <div className="mini-controls">
          <button className="icon-btn" onClick={prev} aria-label="Previous">
            <SkipBack fill="currentColor" />
          </button>
          <PlayButton playing={playing} buffering={buffering && playing} onClick={toggle} />
          <button className="icon-btn" onClick={next} aria-label="Next">
            <SkipForward fill="currentColor" />
          </button>
          <span className="spacer" />
          <button className="icon-btn small" onClick={() => void leaveMini()} aria-label="Back to the full window" title="Full Window">
            <Maximize2 />
          </button>
        </div>
        <div className="mini-progress">
          <i style={{ width: `${Math.min(progress, 1) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
