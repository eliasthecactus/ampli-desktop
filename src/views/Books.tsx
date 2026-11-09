import { ArrowDownToLine, BookOpen, Check, CheckCircle2, Circle, Headphones, Play, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Artwork } from "../components/Artwork";
import { DetailHeader } from "../components/DetailHeader";
import { Empty, Grid, Segmented, Shelf } from "../components/Shelf";
import { BookTile } from "../components/Tiles";
import { account } from "../lib/accounts";
import { coverURL } from "../lib/artwork";
import { audiobook, useAudiobook } from "../lib/audiobook";
import { downloadAudiobook, downloadEbook, removeDownload, useDownloads } from "../lib/downloads";
import { long } from "../lib/format";
import { index, useLibrary } from "../lib/library";
import { useNav } from "../lib/nav";
import { rank } from "../lib/search";
import { useSettings } from "../lib/settings";
import type { Book } from "../lib/types";

type Tab = "all" | "books" | "audiobooks" | "finished";

export function Books({ initialTab }: { initialTab?: string }) {
  const lib = useLibrary();
  const s = useSettings();
  const records = useDownloads((d) => d.records);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? "all");
  const [filter, setFilter] = useState("");

  const wanted = useMemo(
    () =>
      lib.books.filter(
        (b) =>
          ((s.showBooks && b.ebookFormat) || (s.showAudiobooks && b.hasAudio)) &&
          (!s.offlineMode || records.has(`ebook:${b.key}`) || records.has(`book:${b.key}`)),
      ),
    [lib.books, s.showBooks, s.showAudiobooks, s.offlineMode, records],
  );
  const going = wanted
    .filter((b) => b.progress && !b.progress.isFinished && (b.progress.progress > 0 || (b.progress.ebookProgress ?? 0) > 0))
    .sort((a, b) => (b.progress?.updatedAt ?? 0) - (a.progress?.updatedAt ?? 0));
  const recent = [...wanted].sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0)).slice(0, 20);

  let list = wanted;
  if (tab === "books") list = wanted.filter((b) => b.ebookFormat);
  if (tab === "audiobooks") list = wanted.filter((b) => b.hasAudio);
  if (tab === "finished") list = wanted.filter((b) => b.progress?.isFinished);
  list = filter ? rank(filter, list, (b) => b.title, (b) => `${b.author} ${b.series ?? ""} ${b.narrator ?? ""}`, 5000) : [...list].sort((a, b) => a.title.localeCompare(b.title));

  // Series stay together, in order.
  if (!filter)
    list.sort((a, b) =>
      a.series && a.series === b.series ? parseFloat(a.seriesSequence ?? "0") - parseFloat(b.seriesSequence ?? "0") : (a.series ?? a.title).localeCompare(b.series ?? b.title),
    );

  return (
    <div className="page">
      <header className="page-head row">
        <h1>Books</h1>
        <div className="page-tools">
          <input className="filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title, author, series" />
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: "All" },
              ...(s.showBooks ? [{ value: "books" as Tab, label: "Books" }] : []),
              ...(s.showAudiobooks ? [{ value: "audiobooks" as Tab, label: "Audiobooks" }] : []),
              { value: "finished", label: "Finished" },
            ]}
          />
        </div>
      </header>
      {!wanted.length && (
        <Empty
          icon={<BookOpen />}
          title={Object.keys(lib.syncing).length ? "Syncing your books…" : "No books yet"}
          text="Ebooks (EPUB, PDF, comics) and audiobooks from Audiobookshelf and Jellyfin book libraries show up here."
        />
      )}
      {tab === "all" && !filter && going.length > 0 && (
        <Shelf title="Continue">
          {going.map((b) => (
            <BookTile key={b.key} book={b} />
          ))}
        </Shelf>
      )}
      {tab === "all" && !filter && recent.length > 0 && wanted.length > 12 && (
        <Shelf title="Recently Added">
          {recent.map((b) => (
            <BookTile key={b.key} book={b} />
          ))}
        </Shelf>
      )}
      {list.length > 0 && (
        <section>
          {tab === "all" && !filter && (
            <header className="shelf-head">
              <h2>All Books</h2>
            </header>
          )}
          <Grid min={150}>
            {list.map((b) => (
              <BookTile key={b.key} book={b} />
            ))}
          </Grid>
        </section>
      )}
    </div>
  );
}

export function BookView({ bookKey }: { bookKey: string }) {
  useLibrary((l) => l.version);
  const book = index.book.get(bookKey);
  const records = useDownloads((d) => d.records);
  const jobs = useDownloads((d) => d.jobs);
  const playingKey = useAudiobook((a) => a.book?.key);
  const openReader = useNav((n) => n.openReader);
  if (!book) return <Empty icon={<BookOpen />} title="Book not found" />;
  const art = coverURL(book.serverId, book.artworkId, 600);
  const p = book.progress;
  const audioDone = records.has(`book:${book.key}`);
  const ebookDone = records.has(`ebook:${book.key}`);
  const busy = (k: string) => jobs.some((j) => j.key === k && j.state !== "failed");
  const percent = (v?: number) => `${Math.round((v ?? 0) * 100)}%`;
  const series = book.series ? `${book.series}${book.seriesSequence ? ` #${book.seriesSequence}` : ""}` : null;
  const others = book.series ? useLibrary.getState().books.filter((b) => b.series === book.series && b.key !== book.key) : [];

  return (
    <div className="page detail">
      <DetailHeader
        art={<Artwork className="book" src={art} seed={book.title} icon={book.hasAudio ? <Headphones /> : <BookOpen />} />}
        artURL={art}
        kind={[book.hasAudio && "Audiobook", book.ebookFormat && book.ebookFormat.toUpperCase()].filter(Boolean).join(" · ") || "Book"}
        title={book.title}
        meta={
          <>
            {book.author}
            {book.narrator && ` · read by ${book.narrator}`}
            {series && ` · ${series}`}
            {book.year && ` · ${book.year}`}
            {book.hasAudio && book.duration > 0 && ` · ${long(book.duration)}`}
          </>
        }
        description={book.overview}
        actions={
          <>
            {book.hasAudio && (
              <button className="btn primary" onClick={() => void audiobook.open(book)}>
                <Play size={16} fill="currentColor" /> {playingKey === book.key ? "Resume" : p?.currentTime && !p.isFinished ? `Continue · ${percent(p.progress)}` : "Listen"}
              </button>
            )}
            {book.ebookFormat && (
              <button className={`btn ${book.hasAudio ? "" : "primary"}`} onClick={() => openReader(book.key)}>
                <BookOpen size={16} /> {p?.ebookProgress && !p.isFinished ? `Continue Reading · ${percent(p.ebookProgress)}` : "Read"}
              </button>
            )}
            {book.hasAudio &&
              (audioDone ? (
                <button className="btn" onClick={() => void removeDownload(`book:${book.key}`)} title="Remove the download">
                  <Check size={16} /> Downloaded
                </button>
              ) : (
                <button className="btn" disabled={busy(`book:${book.key}`)} onClick={() => downloadAudiobook(book)}>
                  <ArrowDownToLine size={16} /> {busy(`book:${book.key}`) ? "Downloading…" : "Download"}
                </button>
              ))}
            {book.ebookFormat &&
              (ebookDone ? (
                <button className="btn" onClick={() => void removeDownload(`ebook:${book.key}`)} title="Remove the download">
                  <Trash2 size={16} /> Remove {book.ebookFormat.toUpperCase()}
                </button>
              ) : (
                <button className="btn" disabled={busy(`ebook:${book.key}`)} onClick={() => downloadEbook(book)}>
                  <ArrowDownToLine size={16} /> {book.hasAudio ? `Download ${book.ebookFormat.toUpperCase()}` : busy(`ebook:${book.key}`) ? "Downloading…" : "Download"}
                </button>
              ))}
            <button className="btn ghost" onClick={() => void audiobook.markFinished(book, !p?.isFinished)}>
              {p?.isFinished ? <CheckCircle2 size={16} /> : <Circle size={16} />} {p?.isFinished ? "Finished" : "Mark as Finished"}
            </button>
          </>
        }
      />
      <div className="book-facts">
        <span>{account(book.serverId)?.name}</span>
        {p && !p.isFinished && (p.progress > 0 || (p.ebookProgress ?? 0) > 0) && (
          <span>
            {book.hasAudio ? `${percent(p.progress)} listened` : ""}
            {book.hasAudio && p.ebookProgress ? " · " : ""}
            {p.ebookProgress ? `${percent(p.ebookProgress)} read` : ""}
          </span>
        )}
      </div>
      {others.length > 0 && (
        <Shelf title={`More in ${book.series}`}>
          {others
            .sort((a, b) => parseFloat(a.seriesSequence ?? "0") - parseFloat(b.seriesSequence ?? "0"))
            .map((b: Book) => (
              <BookTile key={b.key} book={b} />
            ))}
        </Shelf>
      )}
    </div>
  );
}
