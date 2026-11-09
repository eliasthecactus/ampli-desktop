import { Disc3, Download, Heart, HeartOff, ListEnd, ListPlus, ListStart, Pencil, Plus, Trash2, User } from "lucide-react";
import { account, musicClient } from "../lib/accounts";
import { downloadSongs, downloadTracks, isDownloaded, removeDownload } from "../lib/downloads";
import { addToPlaylist, createPlaylist, deletePlaylist, index, renamePlaylist, setFavorite, useLibrary } from "../lib/library";
import { errorText, go, toast } from "../lib/nav";
import { player } from "../lib/player";
import type { MenuEntry, MenuItem } from "../lib/ui";
import { songToTrack, type Playlist, type Song, type Track } from "../lib/types";
import { confirm, prompt } from "./Dialog";

/** "Add to Playlist" lists only playlists of the songs' own server. */
export function playlistSubmenu(serverId: string, songIds: string[]): MenuItem {
  const client = musicClient(serverId);
  const lists = useLibrary
    .getState()
    .playlists.filter((p) => p.serverId === serverId)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    label: "Add to Playlist",
    icon: <ListPlus />,
    disabled: !client?.canEditPlaylists || account(serverId)?.kind === "amplicon",
    submenu: [
      { label: "New Playlist…", icon: <Plus />, action: () => void newPlaylist(serverId, songIds) },
      ...lists.map((p) => ({
        label: p.name,
        action: async () => {
          try {
            await addToPlaylist(p, songIds);
            toast(`Added to ${p.name}`, "ok");
          } catch (e) {
            toast(errorText(e), "error");
          }
        },
      })),
    ],
  };
}

export async function newPlaylist(serverId: string, songIds: string[] = []) {
  const name = await prompt("New Playlist", "Name", "", "Create");
  if (!name) return;
  try {
    const id = await createPlaylist(serverId, name, songIds);
    toast(`Created ${name}`, "ok");
    go({ name: "playlist", key: `${serverId}|${id}` });
  } catch (e) {
    toast(errorText(e), "error");
  }
}

export function trackMenu(track: Track, extra: MenuEntry[] = []): MenuEntry[] {
  const song = index.song.get(track.key);
  const items: MenuEntry[] = [
    { label: "Play Next", icon: <ListStart />, action: () => player.playNext([track]) },
    { label: "Add to Queue", icon: <ListEnd />, action: () => player.addToQueue([track]) },
  ];
  if (song) {
    items.push(playlistSubmenu(song.serverId, [song.id]));
    items.push("separator");
    if (song.albumId) items.push({ label: "Go to Album", icon: <Disc3 />, action: () => go({ name: "album", key: `${song.serverId}|${song.albumId}` }) });
    if (song.artistId) items.push({ label: "Go to Artist", icon: <User />, action: () => go({ name: "artist", key: `${song.serverId}|${song.artistId}` }) });
    items.push("separator");
    items.push({
      label: song.favorite ? "Remove from Favourites" : "Favourite",
      icon: song.favorite ? <HeartOff /> : <Heart />,
      action: () => void setFavorite("song", song.key, !song.favorite),
    });
    items.push(
      isDownloaded(song.key)
        ? { label: "Remove Download", icon: <Trash2 />, action: () => void removeDownload(song.key) }
        : { label: "Download", icon: <Download />, action: () => downloadTracks([songToTrack(song)]) },
    );
  }
  if (extra.length) items.push("separator", ...extra);
  return items;
}

export const songMenu = (song: Song, extra: MenuEntry[] = []) => trackMenu(songToTrack(song), extra);

export function songsMenu(songs: Song[], label: string): MenuEntry[] {
  const tracks = songs.map(songToTrack);
  const serverId = songs[0]?.serverId;
  const all = songs.length > 0 && songs.every((s) => isDownloaded(s.key));
  return [
    { header: label },
    { label: "Play Next", icon: <ListStart />, action: () => player.playNext(tracks) },
    { label: "Add to Queue", icon: <ListEnd />, action: () => player.addToQueue(tracks) },
    ...(serverId && songs.every((s) => s.serverId === serverId) ? [playlistSubmenu(serverId, songs.map((s) => s.id))] : []),
    "separator" as const,
    all
      ? { label: "Remove Downloads", icon: <Trash2 />, action: () => songs.forEach((s) => void removeDownload(s.key)) }
      : { label: "Download", icon: <Download />, action: () => downloadSongs(songs) },
  ];
}

export function playlistMenu(p: Playlist, songs: Song[]): MenuEntry[] {
  const editable = musicClient(p.serverId)?.canEditPlaylists;
  return [
    ...songsMenu(songs, p.name),
    "separator",
    {
      label: "Rename…",
      icon: <Pencil />,
      disabled: !editable,
      action: async () => {
        const name = await prompt("Rename Playlist", "Name", p.name);
        if (name && name !== p.name) await renamePlaylist(p, name).catch((e) => toast(errorText(e), "error"));
      },
    },
    {
      label: "Delete Playlist…",
      icon: <Trash2 />,
      danger: true,
      disabled: !editable,
      action: async () => {
        if (await confirm(`Delete “${p.name}”?`, "The playlist is deleted on the server. The songs stay in your library.")) {
          await deletePlaylist(p)
            .then(() => go({ name: "library", tab: "playlists" }))
            .catch((e) => toast(errorText(e), "error"));
        }
      },
    },
  ];
}
