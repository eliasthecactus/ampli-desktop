import { BookOpen, Disc3, Headphones, Heart, ListMusic, Mic2, MoreHorizontal, Pause, Play, Radio as RadioIcon } from "lucide-react";
import type { ReactNode } from "react";
import { artworkURL, coverURL } from "../lib/artwork";
import { audiobook } from "../lib/audiobook";
import { plural } from "../lib/format";
import { albumSongs, playlistSongs } from "../lib/library";
import { go } from "../lib/nav";
import { player } from "../lib/player";
import { displayName, monogram, radio, subtitle, useRadio, type RadioStation } from "../lib/radio";
import { showMenu } from "../lib/ui";
import { songToTrack, type Album, type Artist, type Book, type Playlist } from "../lib/types";
import { Artwork } from "./Artwork";
import { songsMenu, playlistMenu } from "./menus";

export function Tile({
  art,
  title,
  subtitle,
  onOpen,
  onPlay,
  onMenu,
  round,
  badge,
  wide,
  progress,
}: {
  art: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  onOpen?: () => void;
  onPlay?: () => void;
  onMenu?: (e: React.MouseEvent) => void;
  round?: boolean;
  badge?: ReactNode;
  wide?: boolean;
  progress?: number;
}) {
  return (
    <div className={`tile ${round ? "round" : ""} ${wide ? "wide" : ""}`} onClick={onOpen} onContextMenu={onMenu} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen?.()}>
      <div className="tile-art">
        {art}
        {badge && <span className="tile-badge">{badge}</span>}
        {progress !== undefined && progress > 0 && (
          <span className="tile-progress">
            <i style={{ width: `${Math.min(progress, 1) * 100}%` }} />
          </span>
        )}
        {onPlay && (
          <button
            className="tile-play"
            aria-label="Play"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
          >
            <Play size={18} fill="currentColor" />
          </button>
        )}
        {onMenu && !round && (
          <button className="tile-more" aria-label="More" onClick={(e) => (e.stopPropagation(), onMenu(e))}>
            <MoreHorizontal size={16} />
          </button>
        )}
      </div>
      <div className="tile-text">
        <div className="tile-title">{title}</div>
        {subtitle && <div className="tile-sub">{subtitle}</div>}
      </div>
    </div>
  );
}

export function AlbumTile({ album, sub }: { album: Album; sub?: ReactNode }) {
  const play = (shuffle = false) => player.play(albumSongs(album.key).map(songToTrack), 0, { shuffle });
  return (
    <Tile
      art={<Artwork src={artworkURL(album.serverId, album.artworkId, 200)} seed={album.name} icon={<Disc3 />} />}
      title={album.name}
      subtitle={sub ?? album.artistName}
      onOpen={() => go({ name: "album", key: album.key })}
      onPlay={() => play()}
      onMenu={(e) => showMenu(e, songsMenu(albumSongs(album.key), album.name))}
      badge={album.favorite ? <Heart size={12} fill="currentColor" /> : undefined}
    />
  );
}

export function PlaylistTile({ playlist }: { playlist: Playlist }) {
  return (
    <Tile
      art={<Artwork src={artworkURL(playlist.serverId, playlist.artworkId, 200)} seed={playlist.name} icon={<ListMusic />} />}
      title={playlist.name}
      subtitle={plural(playlist.songCount, "song")}
      onOpen={() => go({ name: "playlist", key: playlist.key })}
      onPlay={() => player.play(playlistSongs(playlist).map(songToTrack))}
      onMenu={(e) => showMenu(e, playlistMenu(playlist, playlistSongs(playlist)))}
    />
  );
}

export function ArtistTile({ artist }: { artist: Artist }) {
  return (
    <Tile
      round
      art={<Artwork round src={artworkURL(artist.serverId, artist.artworkId, 200)} seed={artist.name} icon={<Mic2 />} />}
      title={artist.name}
      subtitle={artist.albumCount ? `${artist.albumCount} albums` : "Artist"}
      onOpen={() => go({ name: "artist", key: artist.key })}
    />
  );
}

export function BookTile({ book }: { book: Book }) {
  const progress = book.progress?.isFinished ? undefined : book.hasAudio ? book.progress?.progress : (book.progress?.ebookProgress ?? book.progress?.progress);
  return (
    <Tile
      art={<Artwork className={book.hasAudio ? "" : "book"} src={coverURL(book.serverId, book.artworkId, 220)} seed={book.title} icon={book.hasAudio ? <Headphones /> : <BookOpen />} />}
      title={book.title}
      subtitle={book.author || (book.hasAudio ? "Audiobook" : "Book")}
      onOpen={() => go({ name: "book", key: book.key })}
      onPlay={book.hasAudio ? () => void audiobook.open(book) : undefined}
      badge={book.hasAudio ? <Headphones size={12} /> : undefined}
      progress={progress}
    />
  );
}

export function StationArt({ station, className = "" }: { station: RadioStation; className?: string }) {
  return <Artwork className={`station ${className}`} label={monogram(station)} color={`linear-gradient(140deg, ${station.color}, color-mix(in srgb, ${station.color} 55%, black))`} />;
}

export function StationTile({ station, context }: { station: RadioStation; context?: RadioStation[] }) {
  const current = useRadio((s) => s.current?.id === station.id);
  const playing = useRadio((s) => s.playing || s.buffering);
  const favorite = useRadio((s) => s.favorites.includes(station.id));
  return (
    <div className={`station-tile ${current ? "current" : ""}`} onClick={() => (current && playing ? radio.stop() : radio.play(station, context))} role="button" tabIndex={0}>
      <StationArt station={station} />
      <div className="station-text">
        <div className="tile-title">{displayName(station)}</div>
        <div className="tile-sub">{subtitle(station)}</div>
      </div>
      <button
        className={`heart ${favorite ? "on" : ""}`}
        aria-label={favorite ? "Remove from Favourites" : "Favourite"}
        onClick={(e) => (e.stopPropagation(), radio.toggleFavorite(station))}
      >
        <Heart size={15} fill={favorite ? "currentColor" : "none"} />
      </button>
      <span className="station-state">{current && playing ? <Pause size={16} fill="currentColor" /> : <RadioIcon size={16} />}</span>
    </div>
  );
}
