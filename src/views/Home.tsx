import { CloudOff, Headphones, Play, Radio, Server, Shuffle, Sparkles } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Artwork } from "../components/Artwork";
import { CatalogRow } from "../components/Catalog";
import { Empty, Shelf } from "../components/Shelf";
import { AlbumTile, BookTile, PlaylistTile, StationTile } from "../components/Tiles";
import { useAccounts } from "../lib/accounts";
import { loadForYou, useAmplicon } from "../lib/amplicon";
import { artworkURL } from "../lib/artwork";
import { useDownloads } from "../lib/downloads";
import { greeting, plural } from "../lib/format";
import { index, useLibrary } from "../lib/library";
import { go } from "../lib/nav";
import { player } from "../lib/player";
import { station, useRadio } from "../lib/radio";
import { useSettings } from "../lib/settings";
import { showMenu } from "../lib/ui";
import { hasMusic, songToTrack, type Album, type Song } from "../lib/types";
import { songMenu } from "../components/menus";

/** Songs in columns of four, scrolling sideways. */
export function SongGrid({ songs }: { songs: Song[] }) {
  const columns: Song[][] = [];
  for (let i = 0; i < songs.length; i += 4) columns.push(songs.slice(i, i + 4));
  return (
    <>
      {columns.map((col, c) => (
        <div className="song-col" key={c}>
          {col.map((s, i) => (
            <button key={s.key} className="song-cell" onClick={() => player.play(songs.map(songToTrack), c * 4 + i)} onContextMenu={(e) => showMenu(e, songMenu(s))}>
              <Artwork src={artworkURL(s.serverId, s.artworkId, 48)} seed={s.albumName ?? s.title} className="tiny" />
              <span className="titles">
                <span className="t1">{s.title}</span>
                <span className="t2">{s.artistName}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

let randomSeed = Math.random();
const pick = <T,>(list: T[], n: number): T[] => {
  // The same "random" albums while the app runs, new ones after a restart or refresh.
  const scored = list.map((x, i) => [x, Math.sin(i * 9301 + randomSeed * 49297) % 1] as const);
  return scored.sort((a, b) => a[1] - b[1]).slice(0, n).map((x) => x[0]);
};

export function Home() {
  const lib = useLibrary();
  const s = useSettings();
  const servers = useAccounts((a) => a.servers);
  const records = useDownloads((d) => d.records);
  const favStations = useRadio((r) => r.favorites);
  const recentStations = useRadio((r) => r.recents);
  useRadio((r) => r.catalogLoaded);
  const amplicon = servers.find((a) => a.kind === "amplicon");
  const forYou = useAmplicon((a) => (amplicon ? a.forYou[amplicon.id] : undefined));

  useEffect(() => {
    if (amplicon && s.showMusic && !s.offlineMode) void loadForYou(amplicon.id);
  }, [amplicon, s.showMusic, s.offlineMode]);

  const offline = s.offlineMode;
  const songs = useMemo(() => (offline ? lib.songs.filter((x) => records.has(x.key)) : lib.songs), [lib.songs, offline, records]);
  const albums = useMemo(() => {
    if (!offline) return lib.albums;
    const keys = new Set(songs.map((x) => `${x.serverId}|${x.albumId}`));
    return lib.albums.filter((a) => keys.has(a.key));
  }, [lib.albums, offline, songs]);

  const recentlyPlayed = useMemo(() => {
    const seen = new Set<string>();
    const out: Album[] = [];
    for (const p of lib.plays) {
      if (!p.albumKey || seen.has(p.albumKey)) continue;
      seen.add(p.albumKey);
      const a = index.album.get(p.albumKey);
      if (a && (!offline || albums.includes(a))) out.push(a);
      if (out.length >= 20) break;
    }
    return out;
  }, [lib.plays, lib.version, offline, albums]);

  const recentlyAdded = useMemo(() => [...albums].sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0)).slice(0, 20), [albums]);
  const random = useMemo(() => pick(albums, 16), [albums]);
  const mostPlayed = useMemo(() => [...songs].filter((x) => x.playCount > 0).sort((a, b) => b.playCount - a.playCount).slice(0, 24), [songs]);
  const favSongs = useMemo(() => songs.filter((x) => x.favorite).sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0)).slice(0, 24), [songs]);
  const continueBooks = useMemo(
    () =>
      lib.books
        .filter((b) => b.progress && !b.progress.isFinished && (b.progress.progress > 0 || (b.progress.ebookProgress ?? 0) > 0))
        .filter((b) => (b.hasAudio ? s.showAudiobooks : s.showBooks))
        .sort((a, b) => (b.progress?.updatedAt ?? 0) - (a.progress?.updatedAt ?? 0))
        .slice(0, 12),
    [lib.books, s.showAudiobooks, s.showBooks],
  );
  const stations = (favStations.length ? favStations : recentStations).map(station).filter((x) => !!x);

  const music = s.showMusic && servers.some((a) => hasMusic(a.kind));
  const nothing = servers.length === 0;

  const shuffleAll = () => player.play(songs.map(songToTrack), 0, { shuffle: true });
  const hero = random[0] ?? recentlyAdded[0];

  return (
    <div className="page home">
      <header className="page-head">
        <p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1>{greeting()}</h1>
      </header>

      {offline && (
        <div className="banner">
          <CloudOff size={18} />
          <span>Offline mode: only what's downloaded is shown and played.</span>
          <button className="btn small" onClick={() => s.set({ offlineMode: false })}>
            Go Online
          </button>
        </div>
      )}

      {nothing && (
        <div className="welcome-cards">
          <button className="hero-card accent" onClick={() => go({ name: "settings", section: "servers" })}>
            <Server size={28} />
            <div>
              <h3>Connect your server</h3>
              <p>Jellyfin, Navidrome or any Subsonic server, Audiobookshelf, or Amplicon.</p>
            </div>
          </button>
          {s.showRadio && (
            <button className="hero-card" onClick={() => go({ name: "radio" })}>
              <Radio size={28} />
              <div>
                <h3>Listen to the radio</h3>
                <p>1000+ stations from 34 countries, no account needed.</p>
              </div>
            </button>
          )}
        </div>
      )}

      {music && songs.length > 0 && (
        <div className="hero-row">
          <button className="hero-card shuffle" onClick={shuffleAll}>
            <div className="hero-art">{hero && <Artwork src={artworkURL(hero.serverId, hero.artworkId, 300)} seed={hero.name} />}</div>
            <div className="hero-text">
              <span className="eyebrow">Your library</span>
              <h3>Shuffle All</h3>
              <p>{plural(songs.length, "song")}</p>
            </div>
            <span className="hero-play">
              <Shuffle size={20} />
            </span>
          </button>
          {mostPlayed.length > 0 && (
            <button className="hero-card" onClick={() => player.play(mostPlayed.map(songToTrack))}>
              <div className="hero-art">
                <Artwork src={artworkURL(mostPlayed[0].serverId, mostPlayed[0].artworkId, 300)} seed={mostPlayed[0].title} />
              </div>
              <div className="hero-text">
                <span className="eyebrow">On repeat</span>
                <h3>Most Played</h3>
                <p>{mostPlayed.slice(0, 3).map((x) => x.artistName).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</p>
              </div>
              <span className="hero-play">
                <Play size={20} fill="currentColor" />
              </span>
            </button>
          )}
          {favSongs.length > 0 && (
            <button className="hero-card" onClick={() => player.play(favSongs.map(songToTrack), 0, { shuffle: true })}>
              <div className="hero-art">
                <Artwork src={artworkURL(favSongs[0].serverId, favSongs[0].artworkId, 300)} seed={favSongs[0].title} />
              </div>
              <div className="hero-text">
                <span className="eyebrow">Loved</span>
                <h3>Favourite Songs</h3>
                <p>{plural(songs.filter((x) => x.favorite).length, "song")}</p>
              </div>
              <span className="hero-play">
                <Shuffle size={20} />
              </span>
            </button>
          )}
        </div>
      )}

      {continueBooks.length > 0 && (
        <Shelf title="Continue" subtitle="Books and audiobooks you started" action={{ label: "All Books", onClick: () => go({ name: "books" }) }}>
          {continueBooks.map((b) => (
            <BookTile key={b.key} book={b} />
          ))}
        </Shelf>
      )}

      {music && recentlyPlayed.length > 0 && (
        <Shelf title="Recently Played">
          {recentlyPlayed.map((a) => (
            <AlbumTile key={a.key} album={a} />
          ))}
        </Shelf>
      )}

      {s.showMusic && amplicon && forYou && !offline && (
        <>
          {forYou.sections.slice(0, 3).map((section) => (
            <CatalogRow
              key={section.title}
              serverId={amplicon.id}
              section={section}
              action={{ label: "For You", onClick: () => go({ name: "amplicon", serverId: amplicon.id }) }}
              icon={<Sparkles size={16} />}
            />
          ))}
        </>
      )}

      {music && recentlyAdded.length > 0 && (
        <Shelf title="Recently Added" action={{ label: "All Albums", onClick: () => go({ name: "library", tab: "albums" }) }}>
          {recentlyAdded.map((a) => (
            <AlbumTile key={a.key} album={a} />
          ))}
        </Shelf>
      )}

      {music && favSongs.length > 0 && (
        <Shelf title="Favourite Songs" action={{ label: "See All", onClick: () => go({ name: "library", tab: "favorites" }) }}>
          <SongGrid songs={favSongs} />
        </Shelf>
      )}

      {music && random.length > 0 && (
        <Shelf
          title="Discover"
          subtitle="Albums from your library"
          action={{
            label: "Shuffle",
            onClick: () => {
              randomSeed = Math.random();
              useLibrary.setState((l) => ({ version: l.version + 1, albums: [...l.albums] }));
            },
          }}
        >
          {random.map((a) => (
            <AlbumTile key={a.key} album={a} />
          ))}
        </Shelf>
      )}

      {music && lib.playlists.length > 0 && !offline && (
        <Shelf title="Playlists" action={{ label: "See All", onClick: () => go({ name: "library", tab: "playlists" }) }}>
          {lib.playlists.slice(0, 20).map((p) => (
            <PlaylistTile key={p.key} playlist={p} />
          ))}
        </Shelf>
      )}

      {music && mostPlayed.length > 0 && (
        <Shelf title="Most Played">
          <SongGrid songs={mostPlayed} />
        </Shelf>
      )}

      {s.showRadio && stations.length > 0 && (
        <section className="shelf">
          <header className="shelf-head">
            <h2>{favStations.length ? "Favourite Stations" : "Recently Played Stations"}</h2>
            <button className="link" onClick={() => go({ name: "radio" })}>
              All Stations
            </button>
          </header>
          <div className="station-grid">
            {stations.slice(0, 8).map((st) => (
              <StationTile key={st!.id} station={st!} context={stations as never} />
            ))}
          </div>
        </section>
      )}

      {!nothing && !music && !continueBooks.length && !stations.length && (
        <Empty icon={<Headphones />} title="Nothing here yet" text="Once your library is synced, your music and books show up here." />
      )}
    </div>
  );
}
