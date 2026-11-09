import { ArrowDownToLine, BookOpen, CloudDownload, Headphones, Music2, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import { Artwork } from "../components/Artwork";
import { confirm } from "../components/Dialog";
import { Empty, Segmented } from "../components/Shelf";
import { SongList } from "../components/SongList";
import { useAccounts } from "../lib/accounts";
import { coverURL } from "../lib/artwork";
import { cancelJob, removeAllDownloads, removeDownload, retryFailed, totalSize, useDownloads } from "../lib/downloads";
import { bytes, plural } from "../lib/format";
import { index, useLibrary } from "../lib/library";
import { go } from "../lib/nav";
import { player } from "../lib/player";
import { useSettings } from "../lib/settings";
import { ServerJobs } from "./Amplicon";
import { useState } from "react";
import type { Track } from "../lib/types";

export function Downloads() {
  const { records, jobs } = useDownloads();
  useLibrary((l) => l.version);
  const servers = useAccounts((a) => a.servers);
  const amplicons = servers.filter((a) => a.kind === "amplicon");
  const offline = useSettings((s) => s.offlineMode);
  const set = useSettings((s) => s.set);
  const [tab, setTab] = useState<string>("device");

  const songs = useMemo(
    () =>
      [...records.values()]
        .filter((r) => r.kind === "song" && r.track)
        .sort((a, b) => b.addedAt - a.addedAt)
        .map((r) => r.track as Track),
    [records],
  );
  const books = useMemo(() => {
    const keys = new Set([...records.values()].filter((r) => r.kind !== "song" && r.bookKey && (r.kind === "ebook" || r.key === `book:${r.bookKey}`)).map((r) => r.bookKey!));
    return [...keys].map((k) => index.book.get(k)).filter((b) => !!b);
  }, [records]);
  const failed = jobs.filter((j) => j.state === "failed");

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Downloads</h1>
          <p className="muted">
            {plural(songs.length, "song")} · {plural(books.length, "book")} · {bytes(totalSize())} on this computer
          </p>
        </div>
        <div className="page-tools">
          {amplicons.length > 0 && (
            <Segmented
              value={tab}
              onChange={setTab}
              options={[{ value: "device", label: "This Computer" }, ...amplicons.map((a) => ({ value: a.id, label: amplicons.length > 1 ? a.name : "On Amplicon" }))]}
            />
          )}
          {tab === "device" && (
            <button className={`btn ${offline ? "primary" : ""}`} onClick={() => set({ offlineMode: !offline })}>
              {offline ? "Offline Mode On" : "Go Offline"}
            </button>
          )}
        </div>
      </header>

      {tab !== "device" ? (
        <ServerJobs serverId={tab} />
      ) : (
        <>
          {jobs.length > 0 && (
            <section className="shelf">
              <header className="shelf-head">
                <h2>Downloading</h2>
                {failed.length > 0 && (
                  <button className="btn small" onClick={retryFailed}>
                    <RotateCcw size={14} /> Retry {failed.length} failed
                  </button>
                )}
              </header>
              <div className="jobs">
                {jobs.map((j) => (
                  <div key={j.key} className="job">
                    <div className="job-icon">
                      <ArrowDownToLine size={18} />
                    </div>
                    <div className="job-main">
                      <div className="t1">{j.title}</div>
                      <div className="t2">
                        {j.state === "failed" ? `Failed · ${j.error}` : j.state === "queued" ? "Waiting" : j.total ? `${bytes(j.received)} of ${bytes(j.total)}` : bytes(j.received)}
                      </div>
                      {j.state === "running" && (
                        <div className="bar">
                          <i style={{ width: j.total ? `${(j.received / j.total) * 100}%` : "30%" }} className={j.total ? "" : "indeterminate"} />
                        </div>
                      )}
                    </div>
                    <button className="icon-btn small" onClick={() => cancelJob(j.key)} aria-label="Cancel">
                      <X />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {books.length > 0 && (
            <section className="shelf">
              <header className="shelf-head">
                <h2>Books</h2>
              </header>
              <div className="jobs">
                {books.map((b) => (
                  <div key={b!.key} className="job clickable" onClick={() => go({ name: "book", key: b!.key })}>
                    <Artwork className="small book" src={coverURL(b!.serverId, b!.artworkId, 64)} seed={b!.title} icon={b!.hasAudio ? <Headphones /> : <BookOpen />} />
                    <div className="job-main">
                      <div className="t1">{b!.title}</div>
                      <div className="t2">
                        {b!.author}
                        {records.has(`book:${b!.key}`) && " · Audiobook"}
                        {records.has(`ebook:${b!.key}`) && ` · ${b!.ebookFormat?.toUpperCase()}`}
                      </div>
                    </div>
                    <button
                      className="icon-btn small"
                      aria-label="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeDownload(`book:${b!.key}`);
                        void removeDownload(`ebook:${b!.key}`);
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {songs.length > 0 ? (
            <section>
              <header className="shelf-head">
                <h2>Songs</h2>
                <button
                  className="btn small ghost danger-text"
                  onClick={async () => {
                    if (await confirm("Remove all downloads?", `${plural(songs.length, "song")} and ${plural(books.length, "book")} (${bytes(totalSize())}) are removed from this computer. They stay on the server.`, "Remove All"))
                      await removeAllDownloads();
                  }}
                >
                  <Trash2 size={14} /> Remove All
                </button>
              </header>
              <SongList tracks={songs} onPlay={(i) => player.play(songs, i)} menuExtra={(i) => [{ label: "Remove Download", icon: <Trash2 />, danger: true, action: () => void removeDownload(songs[i].key) }]} />
            </section>
          ) : (
            !books.length &&
            !jobs.length && (
              <Empty icon={<CloudDownload />} title="Nothing downloaded" text="Download songs, albums, playlists and books to listen and read without a connection.">
                <Music2 className="muted" />
              </Empty>
            )
          )}
        </>
      )}
    </div>
  );
}
