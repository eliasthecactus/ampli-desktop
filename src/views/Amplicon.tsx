import { CircleAlert, CloudDownload, Disc3, ListMusic, Mic2, Pencil, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Artwork } from "../components/Artwork";
import { addToServerMenu, CatalogAlbumTile, CatalogPlaylistTile, CatalogRow, catalogSongMenu } from "../components/Catalog";
import { DetailHeader } from "../components/DetailHeader";
import { confirm, prompt } from "../components/Dialog";
import { Empty, Grid, Segmented, Shelf, Spinner } from "../components/Shelf";
import { SongList } from "../components/SongList";
import { account, ampliconClient } from "../lib/accounts";
import { jobAction, jobStarted, loadForYou, refreshInfo, useAmplicon, watch } from "../lib/amplicon";
import { artworkURL } from "../lib/artwork";
import { long, plural } from "../lib/format";
import { errorText, go, toast } from "../lib/nav";
import { player } from "../lib/player";
import {
  catalogTrack,
  jobIsActive,
  jobNeedsReview,
  type AmpliconJob,
  type AmpliconReview,
  type CatalogAlbum,
  type CatalogArtist,
  type CatalogPlaylist,
  type CatalogPlaylistDetail,
  type ReviewDecision,
  type ReviewTags,
} from "../lib/servers/amplicon";
import { showMenu } from "../lib/ui";
import { Dialog } from "../components/Dialog";
import { openDialog } from "../lib/ui";

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    load()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e) => alive && setState({ error: errorText(e), loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function AmpliconHome({ serverId, tab = "foryou" }: { serverId: string; tab?: "foryou" | "playlists" | "jobs" }) {
  const [current, setCurrent] = useState(tab);
  const info = useAmplicon((a) => a.info[serverId]);
  const error = useAmplicon((a) => a.errors[serverId]);
  const a = account(serverId);
  useEffect(() => setCurrent(tab), [tab]);
  useEffect(() => void refreshInfo(serverId), [serverId]);
  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <p className="eyebrow">Amplicon · {a?.name}</p>
          <h1>{current === "foryou" ? "For You" : current === "playlists" ? "Your Playlists" : "On the Server"}</h1>
        </div>
        <div className="page-tools">
          <Segmented
            value={current}
            onChange={setCurrent}
            options={[
              { value: "foryou", label: "For You" },
              { value: "playlists", label: "Playlists" },
              { value: "jobs", label: "Downloads" },
            ]}
          />
        </div>
      </header>
      {error && (
        <div className="banner error">
          <CircleAlert size={18} /> <span>{error}</span>
        </div>
      )}
      {info && !info.youtube.connected && (
        <div className="banner">
          <Sparkles size={18} />
          <span>No YouTube Music account is connected to {info.name}. You get what's popular instead of your own mixes.</span>
        </div>
      )}
      {current === "foryou" && <ForYou serverId={serverId} />}
      {current === "playlists" && <AccountPlaylists serverId={serverId} />}
      {current === "jobs" && <ServerJobs serverId={serverId} />}
    </div>
  );
}

function ForYou({ serverId }: { serverId: string }) {
  const home = useAmplicon((a) => a.forYou[serverId]);
  const asked = useAmplicon((a) => a.forYouAsked[serverId]);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => void loadForYou(serverId), [serverId]);
  if (!home && !asked) return <div className="center-pad"><Spinner size={28} /></div>;
  if (!home?.sections.length) return <Empty icon={<Sparkles />} title="Nothing here yet" text="This Amplicon server has no recommendations. Use Search to find music." />;
  return (
    <>
      <div className="row-gap end">
        <button
          className="btn small ghost"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await loadForYou(serverId, true);
            setRefreshing(false);
          }}
        >
          {refreshing ? <Spinner size={14} /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>
      {home.sections.map((section) => (
        <CatalogRow key={section.title} serverId={serverId} section={section} />
      ))}
    </>
  );
}

function AccountPlaylists({ serverId }: { serverId: string }) {
  const { data, loading, error, reload } = useLoad(() => ampliconClient(serverId)!.libraryPlaylists(), [serverId]);
  return (
    <>
      <div className="row-gap end">
        <button
          className="btn small"
          onClick={async () => {
            const name = await prompt("New Playlist", "Name", "", "Create");
            if (!name) return;
            try {
              const id = await ampliconClient(serverId)!.createPlaylist(name, []);
              go({ name: "catalog-playlist", serverId, id });
            } catch (e) {
              toast(errorText(e), "error");
            }
          }}
        >
          <Plus size={14} /> New Playlist
        </button>
      </div>
      {loading && !data && <div className="center-pad"><Spinner size={28} /></div>}
      {error && <Empty icon={<ListMusic />} title="Playlists couldn't be loaded" text={error}><button className="btn" onClick={reload}>Try Again</button></Empty>}
      {data && !data.length && <Empty icon={<ListMusic />} title="No playlists" text="Playlists of the connected YouTube Music account show up here." />}
      {data && data.length > 0 && (
        <Grid>
          {data.map((p: CatalogPlaylist) => (
            <CatalogPlaylistTile key={p.id} serverId={serverId} playlist={p} />
          ))}
        </Grid>
      )}
    </>
  );
}

const statusText: Record<string, string> = {
  preparing: "Preparing",
  review: "Waiting for review",
  queued: "Queued",
  running: "Downloading",
  done: "Added",
  partial: "Partly added",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function JobRow({ serverId, job }: { serverId: string; job: AmpliconJob }) {
  const active = jobIsActive(job);
  return (
    <div className="job">
      <Artwork src={artworkURL(serverId, job.thumbnail, 64)} seed={job.title} className="small" icon={<CloudDownload />} />
      <div className="job-main">
        <div className="t1">{job.title}</div>
        <div className="t2">
          {statusText[job.status] ?? job.status}
          {job.total > 1 && ` · ${job.done}/${job.total}`}
          {job.failed > 0 && ` · ${job.failed} failed`}
          {job.locationName && ` · ${job.locationName}`}
          {job.error && ` · ${job.error}`}
        </div>
        {active && !jobNeedsReview(job) && (
          <div className="bar">
            <i style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
        )}
        {job.current.length > 0 && <div className="t3">{job.current.map((c) => c.title).join(", ")}</div>}
      </div>
      <div className="row-gap">
        {jobNeedsReview(job) && (
          <button className="btn small primary" onClick={() => useAmplicon.setState({ reviewing: { serverId, job: job.id } })}>
            <Pencil size={14} /> Review
          </button>
        )}
        {active && (
          <button className="icon-btn small" title="Cancel" onClick={() => void jobAction(serverId, job, "cancel")} aria-label="Cancel">
            <X />
          </button>
        )}
        {(job.status === "failed" || job.status === "partial") && (
          <button className="icon-btn small" title="Try Again" onClick={() => void jobAction(serverId, job, "retry")} aria-label="Retry">
            <RotateCcw />
          </button>
        )}
        {!active && (
          <button className="icon-btn small" title="Remove" onClick={() => void jobAction(serverId, job, "remove")} aria-label="Remove">
            <Trash2 />
          </button>
        )}
      </div>
    </div>
  );
}

export function ServerJobs({ serverId }: { serverId: string }) {
  const jobs = useAmplicon((a) => a.jobs[serverId]);
  useEffect(() => watch(), []);
  if (!jobs) return <div className="center-pad"><Spinner size={28} /></div>;
  if (!jobs.length) return <Empty icon={<CloudDownload />} title="Nothing added yet" text="Songs, albums and playlists you add to the server show up here with their progress." />;
  return (
    <div className="jobs">
      {jobs.map((j) => (
        <JobRow key={j.id} serverId={serverId} job={j} />
      ))}
    </div>
  );
}

export function CatalogAlbumView({ serverId, id }: { serverId: string; id: string }) {
  const { data, loading, error } = useLoad<CatalogAlbum>(() => ampliconClient(serverId)!.album(id), [serverId, id]);
  if (loading && !data) return <div className="center-pad"><Spinner size={28} /></div>;
  if (error || !data) return <Empty icon={<Disc3 />} title="Album couldn't be loaded" text={error} />;
  const tracks = data.tracks.map((t) => catalogTrack(t, serverId));
  const art = artworkURL(serverId, data.thumbnail, 600);
  return (
    <div className="page detail">
      <DetailHeader
        art={<Artwork src={art} seed={data.title} icon={<Disc3 />} />}
        artURL={art}
        kind={data.type ?? "Album"}
        title={data.title}
        meta={
          <>
            {data.artistId ? <a onClick={() => go({ name: "catalog-artist", serverId, id: data.artistId! })}>{data.artist}</a> : data.artist}
            {data.year ? ` · ${data.year}` : ""} · {plural(data.trackCount, "song")} · {long(data.duration)}
          </>
        }
        onPlay={() => player.play(tracks)}
        onShuffle={() => player.play(tracks, 0, { shuffle: true })}
        onMenu={(e) => showMenu(e, [addToServerMenu(serverId, "album", data.id, data.title, data.artist, data.thumbnail)])}
        actions={
          <button className="btn" onClick={(e) => showMenu(e, [addToServerMenu(serverId, "album", data.id, data.title, data.artist, data.thumbnail)])}>
            <CloudDownload size={16} /> Add to Server
          </button>
        }
      />
      <SongList tracks={tracks} showArtwork={false} showAlbum={false} numbers={data.tracks.map((t, i) => t.track ?? i + 1)} onPlay={(i) => player.play(tracks, i)} menuExtra={(i) => catalogSongMenu(serverId, data.tracks[i]).slice(-1)} />
    </div>
  );
}

export function CatalogPlaylistView({ serverId, id }: { serverId: string; id: string }) {
  const { data, loading, error, reload } = useLoad<CatalogPlaylistDetail>(() => ampliconClient(serverId)!.playlist(id), [serverId, id]);
  const entries = useMemo(() => data?.tracks.map((t) => ({ songId: t.id, entryId: t.setVideoId })) ?? [], [data]);
  if (loading && !data) return <div className="center-pad"><Spinner size={28} /></div>;
  if (error || !data) return <Empty icon={<ListMusic />} title="Playlist couldn't be loaded" text={error} />;
  const tracks = data.tracks.map((t) => catalogTrack(t, serverId));
  const art = artworkURL(serverId, data.thumbnail, 600);
  const client = ampliconClient(serverId)!;
  const act = (f: () => Promise<unknown>) => f().then(reload).catch((e) => toast(errorText(e), "error"));
  return (
    <div className="page detail">
      <DetailHeader
        art={<Artwork src={art} seed={data.title} icon={<ListMusic />} />}
        artURL={art}
        kind="Playlist"
        title={data.title}
        meta={`${data.author ? data.author + " · " : ""}${plural(data.tracks.length, "song")} · ${long(data.duration)}`}
        onPlay={() => player.play(tracks)}
        onShuffle={() => player.play(tracks, 0, { shuffle: true })}
        onMenu={(e) =>
          showMenu(e, [
            addToServerMenu(serverId, "playlist", data.id, data.title, data.author, data.thumbnail),
            ...(data.editable
              ? [
                  "separator" as const,
                  {
                    label: "Rename…",
                    icon: <Pencil />,
                    action: async () => {
                      const name = await prompt("Rename Playlist", "Name", data.title);
                      if (name) act(() => client.renamePlaylist(data.id, name));
                    },
                  },
                  {
                    label: "Delete Playlist…",
                    icon: <Trash2 />,
                    danger: true,
                    action: async () => {
                      if (await confirm(`Delete “${data.title}”?`, "The playlist is deleted from the YouTube Music account."))
                        await client.deletePlaylist(data.id).then(() => go({ name: "amplicon", serverId, tab: "playlists" })).catch((e) => toast(errorText(e), "error"));
                    },
                  },
                ]
              : []),
          ])
        }
        actions={
          <button className="btn" onClick={(e) => showMenu(e, [addToServerMenu(serverId, "playlist", data.id, data.title, data.author, data.thumbnail)])}>
            <CloudDownload size={16} /> Add to Server
          </button>
        }
      />
      <SongList
        tracks={tracks}
        onPlay={(i) => player.play(tracks, i)}
        onMove={data.editable ? (from, to) => act(() => client.movePlaylistEntry(data.id, entries, from, to)) : undefined}
        menuExtra={(i) => [
          ...catalogSongMenu(serverId, data.tracks[i]).slice(-1),
          ...(data.editable ? [{ label: "Remove from Playlist", icon: <Trash2 />, danger: true, action: () => act(() => client.removeFromPlaylist(data.id, entries, [i])) }] : []),
        ]}
      />
    </div>
  );
}

export function CatalogArtistView({ serverId, id }: { serverId: string; id: string }) {
  const { data, loading, error } = useLoad<CatalogArtist>(() => ampliconClient(serverId)!.artist(id), [serverId, id]);
  if (loading && !data) return <div className="center-pad"><Spinner size={28} /></div>;
  if (error || !data) return <Empty icon={<Mic2 />} title="Artist couldn't be loaded" text={error} />;
  const tracks = data.songs.map((t) => catalogTrack(t, serverId));
  const art = artworkURL(serverId, data.thumbnail, 600);
  return (
    <div className="page detail">
      <DetailHeader
        round
        art={<Artwork round src={art} seed={data.name} icon={<Mic2 />} />}
        artURL={art}
        kind="Artist"
        title={data.name}
        onPlay={tracks.length ? () => player.play(tracks) : undefined}
        onShuffle={tracks.length ? () => player.play(tracks, 0, { shuffle: true }) : undefined}
      />
      {tracks.length > 0 && (
        <section>
          <header className="shelf-head">
            <h2>Top Songs</h2>
          </header>
          <SongList tracks={tracks} onPlay={(i) => player.play(tracks, i)} menuExtra={(i) => catalogSongMenu(serverId, data.songs[i]).slice(-1)} />
        </section>
      )}
      {data.albums.length > 0 && (
        <Shelf title="Albums">
          {data.albums.map((a) => (
            <CatalogAlbumTile key={a.id} serverId={serverId} album={a} />
          ))}
        </Shelf>
      )}
      {data.singles.length > 0 && (
        <Shelf title="Singles & EPs">
          {data.singles.map((a) => (
            <CatalogAlbumTile key={a.id} serverId={serverId} album={a} />
          ))}
        </Shelf>
      )}
    </div>
  );
}

// MARK: Review before a download

const tagFields: { key: keyof ReviewTags; label: string; number?: boolean }[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "albumartist", label: "Album Artist" },
  { key: "track", label: "Track", number: true },
  { key: "disc", label: "Disc", number: true },
  { key: "year", label: "Year" },
  { key: "genre", label: "Genre" },
];

function ReviewBody({ serverId, jobId, close }: { serverId: string; jobId: number; close: () => void }) {
  const [review, setReview] = useState<AmpliconReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<Record<number, ReviewTags>>({});
  const [skip, setSkip] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const client = ampliconClient(serverId)!;

  useEffect(() => {
    client
      .review(jobId)
      .then((r) => {
        setReview(r);
        setTags(Object.fromEntries(r.songs.map((s) => [s.itemId, { ...s.suggested }])));
        setSkip(Object.fromEntries(r.songs.map((s) => [s.itemId, !!s.inLibrary])));
      })
      .catch((e) => setError(errorText(e)));
  }, [client, jobId]);

  if (error) return <p className="dialog-text">{error}</p>;
  if (!review) return <div className="center-pad"><Spinner size={28} /></div>;

  const applyAlbum = (albumIndex: number) => {
    const album = review.albums[albumIndex];
    setTags((t) => {
      const out = { ...t };
      for (const [item, values] of Object.entries(album.songs)) {
        const id = Number(item);
        const merged = { ...out[id] };
        for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined && v !== "") (merged as Record<string, unknown>)[k] = v;
        out[id] = merged;
      }
      return out;
    });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const decisions: ReviewDecision[] = review.songs.map((s) => {
        const { cover, ...fields } = tags[s.itemId] ?? {};
        return { itemId: s.itemId, fields, skip: !!skip[s.itemId], cover: cover ? { url: cover } : undefined };
      });
      const job = await client.confirm(jobId, decisions);
      jobStarted(serverId, job);
      toast(`Adding ${job.title}`);
      close();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review">
      {review.albums.length > 0 && (
        <div className="review-albums">
          <span className="muted small">Matches:</span>
          {review.albums.map((a, i) => (
            <button key={a.source + a.id} className="chip" onClick={() => applyAlbum(i)} title={`Use the tags of ${a.title} (${a.source})`}>
              {a.title} · {a.artist}
              {a.year ? ` · ${a.year}` : ""} <span className="muted">{a.source}</span>
            </button>
          ))}
        </div>
      )}
      <div className="review-songs scroll">
        {review.songs.map((s) => {
          const t = tags[s.itemId] ?? {};
          return (
            <div key={s.itemId} className={`review-song ${skip[s.itemId] ? "skipped" : ""}`}>
              <div className="review-song-head">
                <strong>
                  {s.position}. {s.original.title}
                </strong>
                {!s.confident && <span className="chip warn">Check</span>}
                {s.inLibrary && <span className="chip">Already in {s.inLibrary.location}</span>}
                <label className="check">
                  <input type="checkbox" checked={!skip[s.itemId]} onChange={(e) => setSkip({ ...skip, [s.itemId]: !e.target.checked })} /> Add
                </label>
              </div>
              {!skip[s.itemId] && (
                <>
                  <div className="review-fields">
                    {tagFields.map((f) => (
                      <label key={f.key} className="field compact">
                        <span>{f.label}</span>
                        <input
                          value={(t[f.key] as string | number | null | undefined) ?? ""}
                          inputMode={f.number ? "numeric" : undefined}
                          onChange={(e) => {
                            const v = e.target.value;
                            setTags({ ...tags, [s.itemId]: { ...t, [f.key]: f.number ? (v ? Number(v) || null : null) : v || null } });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  {s.candidates.length > 0 && (
                    <div className="review-candidates">
                      {s.candidates.slice(0, 4).map((c) => (
                        <button
                          key={c.source + c.id}
                          className="chip"
                          onClick={() => {
                            const merged = { ...t };
                            for (const f of [...tagFields.map((x) => x.key), "cover" as const]) {
                              const v = c[f];
                              if (v !== null && v !== undefined && v !== "") (merged as Record<string, unknown>)[f] = v;
                            }
                            setTags({ ...tags, [s.itemId]: merged });
                          }}
                        >
                          {c.title} · {c.artist} · {c.album} <span className="muted">{c.source}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {s.path && <div className="muted small mono">{s.path}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="dialog-actions">
        <button className="btn ghost" onClick={close}>
          Later
        </button>
        <button className="btn primary" disabled={busy} onClick={submit}>
          {busy ? <Spinner size={14} /> : <CloudDownload size={16} />} Add {plural(review.songs.filter((s) => !skip[s.itemId]).length, "song")}
        </button>
      </div>
    </div>
  );
}

/** Opens the review when Amplicon asks for one. */
export function ReviewWatcher() {
  const reviewing = useAmplicon((a) => a.reviewing);
  useEffect(() => {
    if (!reviewing) return;
    const close = openDialog((c) => (
      <Dialog
        wide
        title="Check the tags"
        onClose={() => {
          c();
          useAmplicon.setState({ reviewing: null });
        }}
      >
        <ReviewBody
          serverId={reviewing.serverId}
          jobId={reviewing.job}
          close={() => {
            c();
            useAmplicon.setState({ reviewing: null });
          }}
        />
      </Dialog>
    ));
    return () => void close;
  }, [reviewing]);
  return null;
}
