import { BookOpen, CircleAlert, FolderOpen, Headphones, Info, KeyRound, Monitor, Moon, Music, Palette, Plus, Radio, RefreshCw, Server, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { addServer, signInAgain } from "../components/AddServer";
import { confirm, prompt } from "../components/Dialog";
import { Segmented, Spinner, Toggle } from "../components/Shelf";
import { Slider } from "../components/Slider";
import { removeServer, useAccounts } from "../lib/accounts";
import { useAmplicon } from "../lib/amplicon";
import { autoDownloadFavorites, removeAllDownloads, totalSize, useDownloads } from "../lib/downloads";
import { ago, bytes, plural } from "../lib/format";
import { appVersion } from "../lib/http";
import { forgetServer, syncAll, syncServer, useLibrary } from "../lib/library";
import { downloadsFolder, isTauri, openExternal } from "../lib/native";
import { go } from "../lib/nav";
import { player } from "../lib/player";
import {
  accents,
  defaultEqualizer,
  eqFrequencies,
  eqPresets,
  qualities,
  qualityName,
  useSettings,
  type Accent,
  type Appearance,
  type EqualizerSettings,
} from "../lib/settings";
import { hasBooks, hasMusic, kindName, type ServerAccount } from "../lib/types";

type Section = "servers" | "content" | "sound" | "storage" | "appearance" | "about";

const sections: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "servers", label: "Servers", icon: <Server /> },
  { id: "content", label: "Content", icon: <Headphones /> },
  { id: "sound", label: "Playback & Sound", icon: <SlidersHorizontal /> },
  { id: "storage", label: "Downloads & Storage", icon: <FolderOpen /> },
  { id: "appearance", label: "Appearance", icon: <Palette /> },
  { id: "about", label: "About", icon: <Info /> },
];

export function Settings({ section = "servers" }: { section?: string }) {
  const [current, setCurrent] = useState<Section>(section as Section);
  useEffect(() => setCurrent(section as Section), [section]);
  return (
    <div className="page settings">
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav">
          {sections.map((s) => (
            <button key={s.id} className={`nav-item ${current === s.id ? "active" : ""}`} onClick={() => setCurrent(s.id)}>
              {s.icon}
              <span className="nav-label">{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {current === "servers" && <Servers />}
          {current === "content" && <Content />}
          {current === "sound" && <Sound />}
          {current === "storage" && <Storage />}
          {current === "appearance" && <AppearanceSection />}
          {current === "about" && <About />}
        </div>
      </div>
    </div>
  );
}

function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="group">
      {title && <h3 className="group-title">{title}</h3>}
      <div className="group-body">{children}</div>
      {footer && <p className="group-foot">{footer}</p>}
    </section>
  );
}

function Row({ label, detail, children, icon }: { label: ReactNode; detail?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="setting-row">
      {icon && <span className="setting-icon">{icon}</span>}
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {detail && <div className="setting-detail">{detail}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Select<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select className="select" value={String(value)} onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// MARK: Servers

function Servers() {
  const servers = useAccounts((a) => a.servers);
  const [open, setOpen] = useState<string | null>(servers.length === 1 ? servers[0].id : null);
  return (
    <>
      <Group
        title="Your Servers"
        footer="Ampli talks to your servers directly. Passwords aren't stored: only the sign-in tokens, in your system's keychain."
      >
        {servers.length === 0 && <Row label="No servers yet" detail="Add Jellyfin, Navidrome or another Subsonic server, Audiobookshelf or Amplicon." />}
        {servers.map((a) => (
          <ServerRow key={a.id} account={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />
        ))}
        <div className="setting-row">
          <button className="btn primary" onClick={() => addServer((a) => setOpen(a.id))}>
            <Plus size={16} /> Add a Server
          </button>
          <span className="spacer" />
          {servers.length > 0 && (
            <button className="btn ghost" onClick={() => void syncAll()}>
              <RefreshCw size={14} /> Sync All
            </button>
          )}
        </div>
      </Group>
      <SyncSettings />
    </>
  );
}

function SyncSettings() {
  const s = useSettings();
  return (
    <Group title="Sync">
      <Row label="Sync when Ampli starts">
        <Toggle checked={s.syncOnLaunch} onChange={(v) => s.set({ syncOnLaunch: v })} />
      </Row>
      <Row label="Sync in the background" detail="Picks up new music and books while Ampli is open.">
        <Select
          value={s.syncInterval}
          onChange={(v) => s.set({ syncInterval: v })}
          options={[
            { value: 0, label: "Off" },
            { value: 30, label: "Every 30 minutes" },
            { value: 60, label: "Every hour" },
            { value: 360, label: "Every 6 hours" },
          ]}
        />
      </Row>
      <Row label="Report plays to the server" detail="Play counts, Now Playing and scrobbling (e.g. to Last.fm through Navidrome).">
        <Toggle checked={s.reportPlays} onChange={(v) => s.set({ reportPlays: v })} />
      </Row>
    </Group>
  );
}

function ServerRow({ account: a, open, onToggle }: { account: ServerAccount; open: boolean; onToggle: () => void }) {
  const update = useAccounts((x) => x.update);
  const status = useLibrary((l) => l.syncing[a.id]);
  const info = useAmplicon((x) => x.info[a.id]);
  const icon = a.kind === "amplicon" ? <Sparkles /> : a.kind === "audiobookshelf" ? <BookOpen /> : <Music />;
  const counts =
    a.kind === "amplicon"
      ? info
        ? `${info.name} ${info.version}${info.youtube.connected ? ` · ${info.youtube.name ?? "YouTube Music"}` : " · no YouTube Music account"}`
        : "Amplicon"
      : [hasMusic(a.kind) && plural(a.songCount, "song"), hasBooks(a.kind) && plural(a.bookCount, "book")].filter(Boolean).join(" · ");
  const selected = new Set(a.selectedLibraryIds);
  const toggleLibrary = (id: string, on: boolean) => {
    let ids = a.selectedLibraryIds.length ? [...a.selectedLibraryIds] : a.libraries.map((l) => l.id);
    ids = on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id);
    // All selected = sync everything (also libraries added later).
    update(a.id, { selectedLibraryIds: ids.length === a.libraries.length ? [] : ids });
  };

  return (
    <div className={`server ${open ? "open" : ""}`}>
      <button className="setting-row server-head" onClick={onToggle}>
        <span className="setting-icon">{icon}</span>
        <div className="setting-text">
          <div className="setting-label">{a.name}</div>
          <div className="setting-detail">
            {kindName(a.kind)} · {counts}
          </div>
        </div>
        <div className="setting-control">
          {status ? (
            <span className="chip">
              <Spinner size={12} /> {status.phase}
            </span>
          ) : a.lastSyncError ? (
            <span className="chip warn">
              <CircleAlert size={12} /> Problem
            </span>
          ) : null}
        </div>
      </button>
      {open && (
        <div className="server-body">
          <Row label="Address" detail={a.url}>
            <span className="muted small">{a.username}</span>
          </Row>
          {a.lastSyncError && (
            <div className="notice warn">
              <CircleAlert size={16} />
              <div>
                <strong>Last sync didn't work</strong>
                <p>{a.lastSyncError}</p>
              </div>
            </div>
          )}
          {a.kind !== "amplicon" && (
            <Row label="Last Sync" detail={ago(a.lastSync)}>
              <button className="btn small" disabled={!!status} onClick={() => void syncServer(a.id)}>
                <RefreshCw size={14} /> Sync Now
              </button>
            </Row>
          )}
          {a.libraries.length > 0 && (
            <div className="libraries">
              <div className="setting-label">Libraries</div>
              <p className="setting-detail">Choose what Ampli syncs from this server.</p>
              {a.libraries.map((l) => (
                <label key={l.id} className="check-row">
                  <input type="checkbox" checked={!a.selectedLibraryIds.length || selected.has(l.id)} onChange={(e) => toggleLibrary(l.id, e.target.checked)} />
                  {l.kind === "books" ? <BookOpen size={15} /> : <Music size={15} />} {l.name}
                </label>
              ))}
            </div>
          )}
          {a.url.startsWith("http://") && (
            <Row label="Allow Unencrypted Connection" detail="Plain http: only for servers at home.">
              <Toggle checked={a.allowsUnencrypted} onChange={(v) => update(a.id, { allowsUnencrypted: v })} />
            </Row>
          )}
          {a.pinnedCertificate && (
            <Row icon={<ShieldCheck />} label="Trusted Certificate" detail={<code className="fingerprint small">{a.pinnedCertificate.toUpperCase().match(/.{2}/g)!.slice(0, 16).join(":")}…</code>}>
              <button className="btn small ghost" onClick={() => update(a.id, { pinnedCertificate: undefined })}>
                Forget
              </button>
            </Row>
          )}
          <div className="setting-row actions">
            <button
              className="btn small"
              onClick={async () => {
                const name = await prompt("Rename Server", "Name", a.name);
                if (name) update(a.id, { name });
              }}
            >
              Rename
            </button>
            <button className="btn small" onClick={() => signInAgain(a)}>
              <KeyRound size={14} /> Sign In Again
            </button>
            <span className="spacer" />
            <button
              className="btn small danger"
              onClick={async () => {
                if (await confirm(`Remove ${a.name}?`, "Its library and sign-in are removed from Ampli. Nothing changes on the server.", "Remove")) {
                  await forgetServer(a.id);
                  await removeServer(a.id);
                }
              }}
            >
              <Trash2 size={14} /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// MARK: Content

function Content() {
  const s = useSettings();
  const enabled = [s.showMusic, s.showBooks, s.showAudiobooks, s.showRadio].filter(Boolean).length;
  const toggle = (key: "showMusic" | "showBooks" | "showAudiobooks" | "showRadio", v: boolean) => {
    // At least one stays on.
    if (!v && enabled <= 1) return;
    s.set({ [key]: v });
  };
  return (
    <Group title="What Ampli Shows" footer="The sidebar, Home, search and sync follow these. Radio alone needs no server.">
      <Row icon={<Music />} label="Music">
        <Toggle checked={s.showMusic} onChange={(v) => toggle("showMusic", v)} />
      </Row>
      <Row icon={<BookOpen />} label="Books" detail="EPUB, PDF and comics">
        <Toggle checked={s.showBooks} onChange={(v) => toggle("showBooks", v)} />
      </Row>
      <Row icon={<Headphones />} label="Audiobooks">
        <Toggle checked={s.showAudiobooks} onChange={(v) => toggle("showAudiobooks", v)} />
      </Row>
      <Row icon={<Radio />} label="Radio" detail="1000+ live stations from 34 countries">
        <Toggle checked={s.showRadio} onChange={(v) => toggle("showRadio", v)} />
      </Row>
    </Group>
  );
}

// MARK: Sound

function Sound() {
  const s = useSettings();
  return (
    <>
      <Group title="Streaming">
        <Row label="Streaming Quality" detail="Original sends the file as it is; lower qualities are converted by the server.">
          <Select value={s.quality} onChange={(v) => s.set({ quality: v })} options={qualities.map((q) => ({ value: q, label: qualityName(q) }))} />
        </Row>
        <Row label="Volume Normalization" detail="Evens out loud and quiet songs (ReplayGain or Jellyfin's normalization).">
          <Toggle
            checked={s.normalizeVolume}
            onChange={(v) => {
              s.set({ normalizeVolume: v });
              player.refreshSound();
            }}
          />
        </Row>
      </Group>
      <Equalizer />
    </>
  );
}

function Equalizer() {
  const s = useSettings();
  const servers = useAccounts((a) => a.servers).filter((a) => hasMusic(a.kind));
  const [scope, setScope] = useState("all");
  const eq: EqualizerSettings = scope === "all" ? s.equalizer : (s.equalizerProfiles[scope] ?? (scope.startsWith("library:") ? s.equalizerProfiles[`server:${scope.split(":")[1]}`] : undefined) ?? s.equalizer);
  const own = scope === "all" || !!s.equalizerProfiles[scope];
  const save = (next: EqualizerSettings) => {
    if (scope === "all") s.set({ equalizer: next });
    else s.set({ equalizerProfiles: { ...s.equalizerProfiles, [scope]: next } });
    player.refreshSound();
  };
  const scopes = [
    { value: "all", label: "All Music" },
    ...servers.flatMap((a) => [
      { value: `server:${a.id}`, label: a.name },
      ...a.libraries.filter((l) => l.kind === "music").map((l) => ({ value: `library:${a.id}:${l.id}`, label: `${a.name} › ${l.name}` })),
    ]),
  ];

  return (
    <Group title="Equalizer" footer="Applies to music and radio. A server or library can have its own; songs remember where they came from.">
      <Row label="Equalizer">
        <Toggle checked={eq.enabled} onChange={(v) => save({ ...eq, enabled: v })} />
      </Row>
      {scopes.length > 1 && (
        <Row label="For" detail={own ? undefined : "Uses the settings above it until you change something."}>
          <Select value={scope} onChange={setScope} options={scopes} />
        </Row>
      )}
      <Row label="Preset">
        <Select
          value={eq.preset}
          onChange={(p) => save({ ...eq, enabled: true, preset: p, gains: p === "Custom" ? eq.gains : [...eqPresets[p]] })}
          options={[...Object.keys(eqPresets), "Custom"].map((p) => ({ value: p, label: p }))}
        />
      </Row>
      <div className={`eq ${eq.enabled ? "" : "off"}`}>
        <div className="eq-band preamp">
          <span className="eq-value">{eq.preamp > 0 ? "+" : ""}{eq.preamp.toFixed(0)}</span>
          <Slider vertical label="Preamp" value={eq.preamp} min={-12} max={12} step={0.5} onLive={(v) => save({ ...eq, preamp: v })} onChange={(v) => save({ ...eq, preamp: v })} />
          <span className="eq-label">Pre</span>
        </div>
        {eqFrequencies.map((f, i) => (
          <div key={f} className="eq-band">
            <span className="eq-value">{eq.gains[i] > 0 ? "+" : ""}{eq.gains[i].toFixed(1).replace(".0", "")}</span>
            <Slider
              vertical
              label={`${f} Hz`}
              value={eq.gains[i]}
              min={-12}
              max={12}
              step={0.5}
              onLive={(v) => save({ ...eq, enabled: true, preset: "Custom", gains: eq.gains.map((g, j) => (j === i ? v : g)) })}
              onChange={(v) => save({ ...eq, enabled: true, preset: "Custom", gains: eq.gains.map((g, j) => (j === i ? v : g)) })}
            />
            <span className="eq-label">{f >= 1000 ? `${f / 1000}k` : f}</span>
          </div>
        ))}
      </div>
      <div className="setting-row">
        <button className="btn small ghost" onClick={() => save(defaultEqualizer())}>
          Reset
        </button>
        {scope !== "all" && own && (
          <button
            className="btn small ghost"
            onClick={() => {
              const next = { ...s.equalizerProfiles };
              delete next[scope];
              s.set({ equalizerProfiles: next });
              player.refreshSound();
            }}
          >
            Use the General Settings
          </button>
        )}
      </div>
    </Group>
  );
}

// MARK: Storage

function Storage() {
  const s = useSettings();
  const records = useDownloads((d) => d.records);
  const [folder, setFolder] = useState("");
  useEffect(() => void downloadsFolder().then(setFolder), []);
  const songs = [...records.values()].filter((r) => r.kind === "song").length;
  return (
    <>
      <Group title="Downloads">
        <Row label="Download Quality">
          <Select value={s.downloadQuality} onChange={(v) => s.set({ downloadQuality: v })} options={qualities.map((q) => ({ value: q, label: qualityName(q) }))} />
        </Row>
        <Row label="Download Favourites" detail="Keeps every song you favourite on this computer.">
          <Toggle
            checked={s.downloadFavorites}
            onChange={(v) => {
              s.set({ downloadFavorites: v });
              if (v) autoDownloadFavorites();
            }}
          />
        </Row>
        <Row label="Offline Mode" detail="Shows and plays only what's downloaded. Nothing is loaded from the servers.">
          <Toggle checked={s.offlineMode} onChange={(v) => s.set({ offlineMode: v })} />
        </Row>
      </Group>
      <Group title="Storage">
        <Row label="Downloads" detail={`${plural(songs, "song")} · ${bytes(totalSize())}`}>
          <button className="btn small" onClick={() => go({ name: "downloads" })}>
            Show
          </button>
        </Row>
        {isTauri && folder && (
          <Row label="Folder" detail={<span className="mono small">{folder}</span>} />
        )}
        <div className="setting-row">
          <button
            className="btn small danger"
            disabled={!records.size}
            onClick={async () => {
              if (await confirm("Remove all downloads?", "Everything downloaded is removed from this computer. It stays on your servers.", "Remove All")) await removeAllDownloads();
            }}
          >
            <Trash2 size={14} /> Remove All Downloads
          </button>
          <button
            className="btn small ghost"
            onClick={async () => {
              if (await confirm("Clear the library cache?", "The synced library is loaded again from your servers. Downloads stay.", "Clear and Sync", false)) {
                for (const a of useAccounts.getState().servers) await forgetServer(a.id);
                await syncAll();
              }
            }}
          >
            Clear Library Cache
          </button>
        </div>
      </Group>
    </>
  );
}

// MARK: Appearance

function AppearanceSection() {
  const s = useSettings();
  return (
    <Group title="Appearance">
      <Row label="Theme">
        <Segmented<Appearance>
          value={s.appearance}
          onChange={(v) => s.set({ appearance: v })}
          options={[
            { value: "system", label: <><Monitor size={14} /> System</> },
            { value: "light", label: <><Sun size={14} /> Light</> },
            { value: "dark", label: <><Moon size={14} /> Dark</> },
          ]}
        />
      </Row>
      <Row label="Accent Colour">
        <div className="swatches">
          {(Object.keys(accents) as Accent[]).map((k) => (
            <button
              key={k}
              className={`swatch ${s.accent === k ? "on" : ""}`}
              style={{ background: `linear-gradient(135deg, ${accents[k].a}, ${accents[k].b})` }}
              onClick={() => s.set({ accent: k })}
              aria-label={accents[k].name}
              title={accents[k].name}
            />
          ))}
        </div>
      </Row>
    </Group>
  );
}

function About() {
  return (
    <>
      <div className="about">
        <img src="/logo.svg" alt="" />
        <div>
          <h2>Ampli</h2>
          <p className="muted">Version {appVersion} for desktop</p>
        </div>
      </div>
      <Group footer="A free player for your own server. No ads, no account, no tracking.">
        <Row label="Ampli for iPhone, iPad, Mac and Apple TV">
          <button className="btn small ghost" onClick={() => void openExternal("https://github.com/eliasthecactus/ampli-ios")}>
            GitHub
          </button>
        </Row>
        <Row label="Amplicon" detail="Your own YouTube Music bridge, as a Docker service">
          <button className="btn small ghost" onClick={() => void openExternal("https://github.com/eliasthecactus/ampli-con")}>
            GitHub
          </button>
        </Row>
      </Group>
      <Group title="Keyboard Shortcuts">
        {[
          ["Play / Pause", "Space"],
          ["Next / Previous", "⌘→ / ⌘←"],
          ["Volume", "⌘↑ / ⌘↓"],
          ["Search", "⌘K"],
          ["Back / Forward", "⌘[ / ⌘]"],
          ["Now Playing", "⌘P"],
          ["Mini Player", "⌥⌘M"],
          ["Settings", "⌘,"],
        ].map(([label, keys]) => (
          <Row key={label} label={label}>
            <kbd>{navigator.userAgent.includes("Mac") ? keys : keys.replace(/⌘/g, "Ctrl+").replace(/⌥/g, "Alt+")}</kbd>
          </Row>
        ))}
      </Group>
    </>
  );
}
