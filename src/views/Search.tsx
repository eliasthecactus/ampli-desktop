import { Search as SearchIcon, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CatalogAlbumTile, CatalogArtistTile, CatalogPlaylistTile, CatalogRow, catalogSongMenu } from "../components/Catalog";
import { Empty, Grid, Segmented, Shelf, Spinner } from "../components/Shelf";
import { SongList } from "../components/SongList";
import { AlbumTile, ArtistTile, BookTile, PlaylistTile, StationTile } from "../components/Tiles";
import { ampliconClient, useAccounts } from "../lib/accounts";
import { loadForYou, useAmplicon } from "../lib/amplicon";
import { useDownloads } from "../lib/downloads";
import { useLibrary } from "../lib/library";
import { errorText } from "../lib/nav";
import { player } from "../lib/player";
import { loadCatalog, searchStations } from "../lib/radio";
import { rank } from "../lib/search";
import { catalogTrack, type CatalogSearch } from "../lib/servers/amplicon";
import { useSettings } from "../lib/settings";
import { songToTrack } from "../lib/types";

export function Search({ initial = "" }: { initial?: string }) {
  const [q, setQ] = useState(initial);
  const servers = useAccounts((a) => a.servers);
  const amplicon = servers.find((a) => a.kind === "amplicon");
  const s = useSettings();
  const [scope, setScope] = useState<"library" | "amplicon">("library");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setQ(initial), [initial]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Search</h1>
        <div className="search-big">
          <SearchIcon size={20} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={scope === "amplicon" ? "Search YouTube Music through Amplicon" : "Songs, albums, artists, books, stations"} />
          {amplicon && s.showMusic && (
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { value: "library", label: "Library" },
                { value: "amplicon", label: "Amplicon" },
              ]}
            />
          )}
        </div>
      </header>
      {scope === "amplicon" && amplicon ? <AmpliconSearch serverId={amplicon.id} q={q} /> : <LibrarySearch q={q} />}
    </div>
  );
}

function LibrarySearch({ q }: { q: string }) {
  const lib = useLibrary();
  const s = useSettings();
  const records = useDownloads((d) => d.records);
  useEffect(() => void loadCatalog(), []);

  const results = useMemo(() => {
    if (!q.trim()) return null;
    const songs = s.offlineMode ? lib.songs.filter((x) => records.has(x.key)) : lib.songs;
    return {
      artists: s.showMusic ? rank(q, lib.artists, (x) => x.name, undefined, 12) : [],
      albums: s.showMusic ? rank(q, lib.albums, (x) => x.name, (x) => `${x.artistName} ${x.year ?? ""}`, 24) : [],
      songs: s.showMusic ? rank(q, songs, (x) => x.title, (x) => `${x.artistName} ${x.albumName ?? ""}`, 100) : [],
      playlists: s.showMusic ? rank(q, lib.playlists, (x) => x.name, undefined, 12) : [],
      books: rank(q, lib.books.filter((b) => (b.hasAudio && s.showAudiobooks) || (b.ebookFormat && s.showBooks)), (x) => x.title, (x) => `${x.author} ${x.narrator ?? ""} ${x.series ?? ""}`, 24),
      stations: s.showRadio ? searchStations(q, 12) : [],
    };
  }, [q, lib, s, records]);

  if (!results) return <Empty icon={<SearchIcon />} title="Find anything" text="Search works offline and ignores accents: “zuerich” finds “Zürich”, “bjork” finds “Björk”." />;
  const total = Object.values(results).reduce((n, list) => n + list.length, 0);
  if (!total) return <Empty icon={<SearchIcon />} title={`No results for “${q}”`} text="Check the spelling, or search for something else." />;
  const tracks = results.songs.map(songToTrack);
  return (
    <>
      {results.songs.length > 0 && (
        <section>
          <header className="shelf-head">
            <h2>Songs</h2>
          </header>
          <SongList tracks={tracks.slice(0, 50)} favorites={new Set(results.songs.filter((x) => x.favorite).map((x) => x.key))} onPlay={(i) => player.play(tracks, i)} />
        </section>
      )}
      {results.artists.length > 0 && (
        <Shelf title="Artists">
          {results.artists.map((a) => (
            <ArtistTile key={a.key} artist={a} />
          ))}
        </Shelf>
      )}
      {results.albums.length > 0 && (
        <Shelf title="Albums">
          {results.albums.map((a) => (
            <AlbumTile key={a.key} album={a} />
          ))}
        </Shelf>
      )}
      {results.playlists.length > 0 && (
        <Shelf title="Playlists">
          {results.playlists.map((p) => (
            <PlaylistTile key={p.key} playlist={p} />
          ))}
        </Shelf>
      )}
      {results.books.length > 0 && (
        <Shelf title="Books">
          {results.books.map((b) => (
            <BookTile key={b.key} book={b} />
          ))}
        </Shelf>
      )}
      {results.stations.length > 0 && (
        <section className="shelf">
          <header className="shelf-head">
            <h2>Stations</h2>
          </header>
          <div className="station-grid">
            {results.stations.map((st) => (
              <StationTile key={st.id} station={st} context={results.stations} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function AmpliconSearch({ serverId, q }: { serverId: string; q: string }) {
  const [results, setResults] = useState<CatalogSearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forYou = useAmplicon((a) => a.forYou[serverId]);

  useEffect(() => {
    if (!forYou) void loadForYou(serverId);
  }, [serverId, forYou]);

  useEffect(() => {
    const query = q.trim();
    if (!query) return setResults(null);
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        setResults(await ampliconClient(serverId)!.search(query));
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [q, serverId]);

  if (!q.trim())
    return forYou?.sections.length ? (
      <>
        {forYou.sections.map((section) => (
          <CatalogRow key={section.title} serverId={serverId} section={section} icon={<Sparkles size={16} />} />
        ))}
      </>
    ) : (
      <Empty icon={<Sparkles />} title="Search YouTube Music" text="Songs play through your Amplicon server. Add what you like to your library with one click." />
    );
  if (loading && !results) return <div className="center-pad"><Spinner size={28} /></div>;
  if (error) return <Empty icon={<SearchIcon />} title="Search didn't work" text={error} />;
  if (!results) return null;
  const tracks = results.songs.map((x) => catalogTrack(x, serverId));
  return (
    <>
      {results.songs.length > 0 && (
        <section>
          <header className="shelf-head">
            <h2>Songs {loading && <Spinner size={14} />}</h2>
          </header>
          <SongList tracks={tracks} onPlay={(i) => player.play(tracks, i)} menuExtra={(i) => catalogSongMenu(serverId, results.songs[i]).slice(-1)} />
        </section>
      )}
      {results.artists.length > 0 && (
        <Shelf title="Artists">
          {results.artists.map((a) => (
            <CatalogArtistTile key={a.id} serverId={serverId} artist={a} />
          ))}
        </Shelf>
      )}
      {results.albums.length > 0 && (
        <Shelf title="Albums">
          {results.albums.map((a) => (
            <CatalogAlbumTile key={a.id} serverId={serverId} album={a} />
          ))}
        </Shelf>
      )}
      {results.playlists.length > 0 && (
        <section>
          <header className="shelf-head">
            <h2>Playlists</h2>
          </header>
          <Grid>
            {results.playlists.map((p) => (
              <CatalogPlaylistTile key={p.id} serverId={serverId} playlist={p} />
            ))}
          </Grid>
        </section>
      )}
    </>
  );
}
