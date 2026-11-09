import { ArrowDownToLine, Check, Disc3, Heart, ListMusic, Mic2, Music2, Plus, Shuffle, Tags, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Artwork, placeholder } from "../components/Artwork";
import { DetailHeader } from "../components/DetailHeader";
import { newPlaylist, playlistMenu, songsMenu } from "../components/menus";
import { Empty, Grid, Segmented, Shelf } from "../components/Shelf";
import { SongList } from "../components/SongList";
import { AlbumTile, ArtistTile, PlaylistTile } from "../components/Tiles";
import { choose } from "../components/Dialog";
import { account, useAccounts } from "../lib/accounts";
import { artworkURL } from "../lib/artwork";
import { downloadSongs, removeDownload, useDownloads } from "../lib/downloads";
import { long, plural } from "../lib/format";
import { albumSongs, index, movePlaylistEntry, playlistSongs, removeFromPlaylist, setFavorite, useLibrary } from "../lib/library";
import { errorText, go, toast, type LibraryTab } from "../lib/nav";
import { player } from "../lib/player";
import { rank } from "../lib/search";
import { useSettings } from "../lib/settings";
import { showMenu } from "../lib/ui";
import { hasMusic, songToTrack, type Song } from "../lib/types";

function useOffline() {
  const offline = useSettings((s) => s.offlineMode);
  const records = useDownloads((d) => d.records);
  return (songs: Song[]) => (offline ? songs.filter((s) => records.has(s.key)) : songs);
}

type Sort = "name" | "artist" | "year" | "added";

function Filter({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input className="filter" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

export function Library({ tab = "albums" }: { tab?: LibraryTab }) {
  const lib = useLibrary();
  const visible = useOffline();
  const offline = useSettings((s) => s.offlineMode);
  const servers = useAccounts((a) => a.servers);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("name");

  const songs = useMemo(() => visible(lib.songs), [lib.songs, visible]);
  const albumKeys = useMemo(() => new Set(songs.map((s) => `${s.serverId}|${s.albumId}`)), [songs]);
  const albums = useMemo(() => {
    let list = offline ? lib.albums.filter((a) => albumKeys.has(a.key)) : lib.albums;
    if (filter) list = rank(filter, list, (a) => a.name, (a) => a.artistName, 5000);
    else
      list = [...list].sort((a, b) =>
        sort === "artist"
          ? a.artistName.localeCompare(b.artistName) || a.name.localeCompare(b.name)
          : sort === "year"
            ? (b.year ?? 0) - (a.year ?? 0)
            : sort === "added"
              ? (b.dateAdded ?? 0) - (a.dateAdded ?? 0)
              : a.name.localeCompare(b.name),
      );
    return list;
  }, [lib.albums, offline, albumKeys, filter, sort]);

  const titles: Record<LibraryTab, string> = { playlists: "Playlists", artists: "Artists", albums: "Albums", songs: "Songs", genres: "Genres", favorites: "Favourites" };

  return (
    <div className="page">
      <header className="page-head row">
        <h1>{titles[tab]}</h1>
        <div className="page-tools">
          {tab !== "genres" && <Filter value={filter} onChange={setFilter} placeholder={`Filter ${titles[tab].toLowerCase()}`} />}
          {tab === "albums" && !filter && (
            <Segmented<Sort>
              value={sort}
              onChange={setSort}
              options={[
                { value: "name", label: "A–Z" },
                { value: "artist", label: "Artist" },
                { value: "year", label: "Year" },
                { value: "added", label: "Added" },
              ]}
            />
          )}
          {tab === "playlists" && servers.some((a) => hasMusic(a.kind)) && (
            <button
              className="btn"
              onClick={async () => {
                const editable = servers.filter((a) => hasMusic(a.kind));
                const id = editable.length === 1 ? editable[0].id : await choose("New playlist on which server?", editable.map((a) => ({ value: a.id, label: a.name, detail: a.url })));
                if (id) void newPlaylist(id);
              }}
            >
              <Plus size={16} /> New Playlist
            </button>
          )}
          {tab === "songs" && songs.length > 0 && (
            <button className="btn primary" onClick={() => player.play(songs.map(songToTrack), 0, { shuffle: true })}>
              <Shuffle size={16} /> Shuffle All
            </button>
          )}
        </div>
      </header>

      {tab === "albums" &&
        (albums.length ? (
          <Grid>
            {albums.map((a) => (
              <AlbumTile key={a.key} album={a} sub={sort === "year" && a.year ? `${a.artistName} · ${a.year}` : undefined} />
            ))}
          </Grid>
        ) : (
          <LibraryEmpty icon={<Disc3 />} what="albums" />
        ))}

      {tab === "artists" && <ArtistsTab filter={filter} albumKeys={offline ? albumKeys : null} />}

      {tab === "songs" && <SongsTab songs={filter ? rank(filter, songs, (s) => s.title, (s) => `${s.artistName} ${s.albumName ?? ""}`, 5000) : songs} />}

      {tab === "playlists" && (
        <>
          {servers.some((a) => a.kind === "amplicon") && (
            <p className="hint">Playlists of your Amplicon account are on its page in the sidebar.</p>
          )}
          {lib.playlists.length ? (
            <Grid>
              {(filter ? rank(filter, lib.playlists, (p) => p.name, undefined, 1000) : [...lib.playlists].sort((a, b) => a.name.localeCompare(b.name))).map((p) => (
                <PlaylistTile key={p.key} playlist={p} />
              ))}
            </Grid>
          ) : (
            <LibraryEmpty icon={<ListMusic />} what="playlists" />
          )}
        </>
      )}

      {tab === "genres" && <GenresTab songs={songs} />}

      {tab === "favorites" && <FavoritesTab filter={filter} songs={songs} />}
    </div>
  );
}

function LibraryEmpty({ icon, what }: { icon: React.ReactNode; what: string }) {
  const syncing = useLibrary((l) => Object.keys(l.syncing).length > 0);
  const offline = useSettings((s) => s.offlineMode);
  return (
    <Empty
      icon={icon}
      title={syncing ? "Syncing your library…" : `No ${what}`}
      text={syncing ? "This takes a moment the first time." : offline ? `No downloaded ${what}. Turn off offline mode to see everything.` : `Your ${what} show up here after the library is synced.`}
    />
  );
}

function ArtistsTab({ filter, albumKeys }: { filter: string; albumKeys: Set<string> | null }) {
  const artists = useLibrary((l) => l.artists);
  const list = useMemo(() => {
    let out = albumKeys ? artists.filter((a) => (index.artistAlbums.get(a.key) ?? []).some((al) => albumKeys.has(al.key))) : artists;
    out = filter ? rank(filter, out, (a) => a.name, undefined, 5000) : [...out].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [artists, filter, albumKeys]);
  if (!list.length) return <LibraryEmpty icon={<Mic2 />} what="artists" />;
  return (
    <Grid min={150}>
      {list.map((a) => (
        <ArtistTile key={a.key} artist={a} />
      ))}
    </Grid>
  );
}

function SongsTab({ songs }: { songs: Song[] }) {
  const sorted = useMemo(() => [...songs].sort((a, b) => a.title.localeCompare(b.title)), [songs]);
  const tracks = useMemo(() => sorted.map(songToTrack), [sorted]);
  const favorites = useMemo(() => new Set(sorted.filter((s) => s.favorite).map((s) => s.key)), [sorted]);
  if (!songs.length) return <LibraryEmpty icon={<Music2 />} what="songs" />;
  return <SongList tracks={tracks} favorites={favorites} onPlay={(i) => player.play(tracks, i)} />;
}

function GenresTab({ songs }: { songs: Song[] }) {
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of songs) if (s.genre) counts.set(s.genre, (counts.get(s.genre) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [songs]);
  if (!genres.length) return <LibraryEmpty icon={<Tags />} what="genres" />;
  return (
    <div className="genre-grid">
      {genres.map(([g, n]) => (
        <button key={g} className="genre-card" style={{ background: placeholder(g) }} onClick={() => go({ name: "genre", genre: g })}>
          <strong>{g}</strong>
          <span>{plural(n, "song")}</span>
        </button>
      ))}
    </div>
  );
}

function FavoritesTab({ filter, songs }: { filter: string; songs: Song[] }) {
  const lib = useLibrary();
  const fav = useMemo(() => songs.filter((s) => s.favorite), [songs]);
  const shown = filter ? rank(filter, fav, (s) => s.title, (s) => `${s.artistName} ${s.albumName ?? ""}`, 5000) : fav;
  const tracks = useMemo(() => shown.map(songToTrack), [shown]);
  const albums = lib.albums.filter((a) => a.favorite);
  const artists = lib.artists.filter((a) => a.favorite);
  if (!fav.length && !albums.length && !artists.length)
    return <Empty icon={<Heart />} title="No favourites yet" text="Tap the heart on songs, albums and artists to find them here." />;
  return (
    <>
      {artists.length > 0 && !filter && (
        <Shelf title="Artists">
          {artists.map((a) => (
            <ArtistTile key={a.key} artist={a} />
          ))}
        </Shelf>
      )}
      {albums.length > 0 && !filter && (
        <Shelf title="Albums">
          {albums.map((a) => (
            <AlbumTile key={a.key} album={a} />
          ))}
        </Shelf>
      )}
      {fav.length > 0 && (
        <section>
          <header className="shelf-head">
            <h2>Songs</h2>
            <div className="row-gap">
              <button className="btn small" onClick={() => player.play(tracks, 0, { shuffle: true })}>
                <Shuffle size={14} /> Shuffle
              </button>
            </div>
          </header>
          <SongList tracks={tracks} favorites={new Set(fav.map((s) => s.key))} onPlay={(i) => player.play(tracks, i)} />
        </section>
      )}
    </>
  );
}

function DownloadButton({ songs }: { songs: Song[] }) {
  const records = useDownloads((d) => d.records);
  const jobs = useDownloads((d) => d.jobs);
  if (!songs.length) return null;
  const done = songs.filter((s) => records.has(s.key)).length;
  const running = songs.some((s) => jobs.some((j) => j.key === s.key));
  if (done === songs.length)
    return (
      <button className="btn" onClick={() => songs.forEach((s) => void removeDownload(s.key))} title="Remove the downloads">
        <Check size={16} /> Downloaded
      </button>
    );
  return (
    <button className="btn" onClick={() => downloadSongs(songs)} disabled={running}>
      <ArrowDownToLine size={16} /> {running ? `Downloading ${done}/${songs.length}` : "Download"}
    </button>
  );
}

export function AlbumView({ albumKey }: { albumKey: string }) {
  useLibrary((l) => l.version);
  const visible = useOffline();
  const album = index.album.get(albumKey);
  const songs = visible(albumSongs(albumKey));
  const tracks = useMemo(() => songs.map(songToTrack), [songs]);
  const multiDisc = new Set(songs.map((s) => s.disc ?? 1)).size > 1;
  if (!album) return <Empty icon={<Disc3 />} title="Album not found" text="It may have been removed from the server." />;
  const art = artworkURL(album.serverId, album.artworkId, 600);
  const more = index.artistAlbums.get(`${album.serverId}|${album.artistId}`)?.filter((a) => a.key !== album.key) ?? [];
  const duration = songs.reduce((s, x) => s + x.duration, 0);
  const musicServers = useAccounts.getState().servers.filter((a) => hasMusic(a.kind));
  const from = musicServers.length > 1 ? ` · ${account(album.serverId)?.name ?? ""}` : "";
  return (
    <div className="page detail">
      <DetailHeader
        art={<Artwork src={art} seed={album.name} icon={<Disc3 />} />}
        artURL={art}
        kind={album.genre ? `Album · ${album.genre}` : "Album"}
        title={album.name}
        meta={
          <>
            {album.artistId ? <a onClick={() => go({ name: "artist", key: `${album.serverId}|${album.artistId}` })}>{album.artistName}</a> : album.artistName}
            {album.year ? ` · ${album.year}` : ""} · {plural(songs.length, "song")} · {long(duration)}
            {from}
          </>
        }
        onPlay={() => player.play(tracks)}
        onShuffle={() => player.play(tracks, 0, { shuffle: true })}
        onMenu={(e) => showMenu(e, songsMenu(songs, album.name))}
        actions={
          <>
            <button className={`icon-btn heart ${album.favorite ? "on" : ""}`} onClick={() => void setFavorite("album", album.key, !album.favorite)} aria-label="Favourite">
              <Heart fill={album.favorite ? "currentColor" : "none"} />
            </button>
            <DownloadButton songs={albumSongs(albumKey)} />
          </>
        }
      />
      <SongList
        tracks={tracks}
        showArtwork={false}
        showAlbum={false}
        numbers={songs.map((s) => (multiDisc ? `${s.disc ?? 1}·${s.track ?? ""}` : s.track))}
        favorites={new Set(songs.filter((s) => s.favorite).map((s) => s.key))}
        onPlay={(i) => player.play(tracks, i)}
      />
      {more.length > 0 && (
        <Shelf title={`More by ${album.artistName}`}>
          {more.map((a) => (
            <AlbumTile key={a.key} album={a} sub={a.year ? String(a.year) : undefined} />
          ))}
        </Shelf>
      )}
    </div>
  );
}

export function ArtistView({ artistKey }: { artistKey: string }) {
  useLibrary((l) => l.version);
  const visible = useOffline();
  const artist = index.artist.get(artistKey);
  const songs = visible(index.artistSongs.get(artistKey) ?? []);
  const albums = index.artistAlbums.get(artistKey) ?? [];
  const name = artist?.name ?? songs[0]?.artistName ?? "Artist";
  const top = useMemo(() => [...songs].sort((a, b) => b.playCount - a.playCount || Number(b.favorite) - Number(a.favorite)).slice(0, 10), [songs]);
  const all = useMemo(() => albums.flatMap((a) => visible(albumSongs(a.key))), [albums, visible]);
  const tracks = top.map(songToTrack);
  if (!artist && !songs.length) return <Empty icon={<Mic2 />} title="Artist not found" />;
  const art = artist ? artworkURL(artist.serverId, artist.artworkId, 600) : undefined;
  return (
    <div className="page detail">
      <DetailHeader
        round
        art={<Artwork round src={art} seed={name} icon={<Mic2 />} />}
        artURL={art}
        kind="Artist"
        title={name}
        meta={`${plural(albums.length, "album")} · ${plural(all.length || songs.length, "song")}`}
        onPlay={() => player.play((all.length ? all : songs).map(songToTrack))}
        onShuffle={() => player.play((all.length ? all : songs).map(songToTrack), 0, { shuffle: true })}
        onMenu={(e) => showMenu(e, songsMenu(all.length ? all : songs, name))}
        actions={
          artist && (
            <button className={`icon-btn heart ${artist.favorite ? "on" : ""}`} onClick={() => void setFavorite("artist", artist.key, !artist.favorite)} aria-label="Favourite">
              <Heart fill={artist.favorite ? "currentColor" : "none"} />
            </button>
          )
        }
      />
      {top.length > 0 && (
        <section>
          <header className="shelf-head">
            <h2>Top Songs</h2>
          </header>
          <SongList tracks={tracks} favorites={new Set(top.filter((s) => s.favorite).map((s) => s.key))} onPlay={(i) => player.play(tracks, i)} />
        </section>
      )}
      {albums.length > 0 && (
        <section>
          <header className="shelf-head">
            <h2>Albums</h2>
          </header>
          <Grid>
            {albums.map((a) => (
              <AlbumTile key={a.key} album={a} sub={[a.year, a.artistName !== name ? a.artistName : null].filter(Boolean).join(" · ") || " "} />
            ))}
          </Grid>
        </section>
      )}
    </div>
  );
}

export function PlaylistView({ playlistKey }: { playlistKey: string }) {
  useLibrary((l) => l.version);
  const playlist = index.playlist.get(playlistKey);
  const visible = useOffline();
  const all = playlist ? playlistSongs(playlist) : [];
  const songs = visible(all);
  const tracks = useMemo(() => songs.map(songToTrack), [songs]);
  if (!playlist) return <Empty icon={<ListMusic />} title="Playlist not found" />;
  const editable = account(playlist.serverId)?.kind !== "amplicon";
  const art = artworkURL(playlist.serverId, playlist.artworkId, 600) ?? (songs[0] ? artworkURL(songs[0].serverId, songs[0].artworkId, 600) : undefined);
  const duration = songs.reduce((s, x) => s + x.duration, 0);
  const filtered = songs.length !== all.length;
  return (
    <div className="page detail">
      <DetailHeader
        art={<Mosaic songs={all} fallback={art} seed={playlist.name} />}
        artURL={art}
        kind="Playlist"
        title={playlist.name}
        meta={`${account(playlist.serverId)?.name ?? ""} · ${plural(songs.length, "song")} · ${long(duration)}`}
        onPlay={() => player.play(tracks)}
        onShuffle={() => player.play(tracks, 0, { shuffle: true })}
        onMenu={(e) => showMenu(e, playlistMenu(playlist, all))}
        actions={<DownloadButton songs={all} />}
      />
      {songs.length ? (
        <SongList
          tracks={tracks}
          favorites={new Set(songs.filter((s) => s.favorite).map((s) => s.key))}
          onPlay={(i) => player.play(tracks, i)}
          onMove={
            editable && !filtered
              ? (from, to) => void movePlaylistEntry(playlist, from, to).catch((e) => toast(errorText(e), "error"))
              : undefined
          }
          menuExtra={
            editable && !filtered
              ? (i) => [{ label: "Remove from Playlist", icon: <Trash2 />, danger: true, action: () => void removeFromPlaylist(playlist, [i]).catch((e) => toast(errorText(e), "error")) }]
              : undefined
          }
        />
      ) : (
        <Empty icon={<ListMusic />} title="This playlist is empty" text="Add songs with “Add to Playlist” in any song's menu." />
      )}
    </div>
  );
}

/** Four covers of a playlist when it has no own artwork. */
function Mosaic({ songs, fallback, seed }: { songs: Song[]; fallback?: string; seed: string }) {
  const covers: string[] = [];
  const seen = new Set<string>();
  for (const s of songs) {
    if (!s.artworkId || seen.has(s.artworkId)) continue;
    seen.add(s.artworkId);
    const u = artworkURL(s.serverId, s.artworkId, 300);
    if (u) covers.push(u);
    if (covers.length === 4) break;
  }
  if (fallback && covers.length < 4) return <Artwork src={fallback} seed={seed} icon={<ListMusic />} />;
  if (covers.length < 4) return <Artwork seed={seed} icon={<ListMusic />} />;
  return (
    <div className="artwork mosaic">
      {covers.map((c) => (
        <img key={c} src={c} alt="" crossOrigin="anonymous" />
      ))}
    </div>
  );
}

export function GenreView({ genre }: { genre: string }) {
  useLibrary((l) => l.version);
  const visible = useOffline();
  const songs = visible(index.genres.get(genre) ?? []);
  const tracks = useMemo(() => songs.map(songToTrack), [songs]);
  const albums = useMemo(() => {
    const keys = [...new Set(songs.map((s) => `${s.serverId}|${s.albumId}`))];
    return keys.map((k) => index.album.get(k)).filter((a) => !!a);
  }, [songs]);
  return (
    <div className="page detail">
      <DetailHeader
        art={<div className="artwork genre-art" style={{ background: placeholder(genre) }}><Tags /></div>}
        kind="Genre"
        title={genre}
        meta={`${plural(albums.length, "album")} · ${plural(songs.length, "song")}`}
        onPlay={() => player.play(tracks)}
        onShuffle={() => player.play(tracks, 0, { shuffle: true })}
        onMenu={(e) => showMenu(e, songsMenu(songs, genre))}
      />
      {albums.length > 0 && (
        <Shelf title="Albums">
          {albums.map((a) => (
            <AlbumTile key={a!.key} album={a!} />
          ))}
        </Shelf>
      )}
      <SongList tracks={tracks} favorites={new Set(songs.filter((s) => s.favorite).map((s) => s.key))} onPlay={(i) => player.play(tracks, i)} />
    </div>
  );
}
