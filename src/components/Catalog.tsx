import { CloudDownload, Disc3, ListEnd, ListMusic, ListStart, Mic2, Music2 } from "lucide-react";
import type { ReactNode } from "react";
import { download, profiles } from "../lib/amplicon";
import { artworkURL } from "../lib/artwork";
import { go } from "../lib/nav";
import { player } from "../lib/player";
import { catalogTrack, type CatalogAlbumSummary, type CatalogArtistSummary, type CatalogItem, type CatalogPlaylist, type CatalogSong } from "../lib/servers/amplicon";
import { showMenu, type MenuEntry } from "../lib/ui";
import { Artwork } from "./Artwork";
import { Shelf } from "./Shelf";
import { Tile } from "./Tiles";

/** "Add to Server" with the server's profiles (where and in which format it lands). */
export function addToServerMenu(serverId: string, kind: "song" | "album" | "playlist", id: string, title: string, subtitle?: string, thumbnail?: string): MenuEntry {
  const list = profiles(serverId);
  if (list.length <= 1)
    return { label: "Add to Server", icon: <CloudDownload />, action: () => void download(serverId, kind, id, title, subtitle, thumbnail, list[0]) };
  return {
    label: "Add to Server",
    icon: <CloudDownload />,
    submenu: list.map((p) => ({
      label: `${p.name}${p.location ? ` → ${p.location}` : ""}${p.isDefault ? " (default)" : ""}`,
      action: () => void download(serverId, kind, id, title, subtitle, thumbnail, p),
    })),
  };
}

export function catalogSongMenu(serverId: string, song: CatalogSong): MenuEntry[] {
  const t = catalogTrack(song, serverId);
  return [
    { label: "Play Next", icon: <ListStart />, action: () => player.playNext([t]) },
    { label: "Add to Queue", icon: <ListEnd />, action: () => player.addToQueue([t]) },
    "separator",
    ...(song.albumId ? [{ label: "Go to Album", icon: <Disc3 />, action: () => go({ name: "catalog-album", serverId, id: song.albumId! }) }] : []),
    ...(song.artistId ? [{ label: "Go to Artist", icon: <Mic2 />, action: () => go({ name: "catalog-artist", serverId, id: song.artistId! }) }] : []),
    "separator",
    addToServerMenu(serverId, "song", song.id, song.title, song.artist, song.thumbnail),
  ];
}

const art = (serverId: string, url?: string, size = 200) => artworkURL(serverId, url, size);

export function CatalogTile({ serverId, item, songs }: { serverId: string; item: CatalogItem; songs?: CatalogSong[] }) {
  switch (item.type) {
    case "song": {
      const s = item.item;
      return (
        <Tile
          art={<Artwork src={art(serverId, s.thumbnail)} seed={s.title} icon={<Music2 />} />}
          title={s.title}
          subtitle={s.artist}
          onOpen={() => {
            const list = songs ?? [s];
            player.play(list.map((x) => catalogTrack(x, serverId)), Math.max(0, list.indexOf(s)));
          }}
          onPlay={() => player.play([catalogTrack(s, serverId)])}
          onMenu={(e) => showMenu(e, catalogSongMenu(serverId, s))}
        />
      );
    }
    case "album":
      return <CatalogAlbumTile serverId={serverId} album={item.item} />;
    case "playlist":
      return <CatalogPlaylistTile serverId={serverId} playlist={item.item} />;
    case "artist":
      return <CatalogArtistTile serverId={serverId} artist={item.item} />;
  }
}

export function CatalogAlbumTile({ serverId, album }: { serverId: string; album: CatalogAlbumSummary }) {
  return (
    <Tile
      art={<Artwork src={art(serverId, album.thumbnail)} seed={album.title} icon={<Disc3 />} />}
      title={album.title}
      subtitle={[album.type, album.artist, album.year].filter(Boolean).join(" · ")}
      onOpen={() => go({ name: "catalog-album", serverId, id: album.id })}
      onMenu={(e) => showMenu(e, [addToServerMenu(serverId, "album", album.id, album.title, album.artist, album.thumbnail)])}
    />
  );
}

export function CatalogPlaylistTile({ serverId, playlist }: { serverId: string; playlist: CatalogPlaylist }) {
  return (
    <Tile
      art={<Artwork src={art(serverId, playlist.thumbnail)} seed={playlist.title} icon={<ListMusic />} />}
      title={playlist.title}
      subtitle={playlist.author ?? (playlist.trackCount ? `${playlist.trackCount} songs` : "Playlist")}
      onOpen={() => go({ name: "catalog-playlist", serverId, id: playlist.id })}
      onMenu={(e) => showMenu(e, [addToServerMenu(serverId, "playlist", playlist.id, playlist.title, playlist.author, playlist.thumbnail)])}
    />
  );
}

export function CatalogArtistTile({ serverId, artist }: { serverId: string; artist: CatalogArtistSummary }) {
  return (
    <Tile
      round
      art={<Artwork round src={art(serverId, artist.thumbnail)} seed={artist.name} icon={<Mic2 />} />}
      title={artist.name}
      subtitle="Artist"
      onOpen={() => go({ name: "catalog-artist", serverId, id: artist.id })}
    />
  );
}

export function CatalogRow({
  serverId,
  section,
  action,
  icon,
}: {
  serverId: string;
  section: { title: string; items: CatalogItem[] };
  action?: { label: string; onClick: () => void };
  icon?: ReactNode;
}) {
  const songs = section.items.filter((i) => i.type === "song").map((i) => i.item as CatalogSong);
  return (
    <Shelf
      title={
        <>
          {icon}
          {section.title}
        </>
      }
      action={action}
    >
      {section.items.map((item) => (
        <CatalogTile key={item.type + item.item.id} serverId={serverId} item={item} songs={songs} />
      ))}
    </Shelf>
  );
}
