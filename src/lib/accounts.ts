// Servers the user signed in to. The list lives in local storage, credentials in the system keychain.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { connectionOf, isLocalAddress, normalizeServerURL, type Connection } from "./http";
import { secretDelete, secretGet, secretSet } from "./native";
import { AmpliconClient, signInAmplicon, type AmpliconInfo } from "./servers/amplicon";
import { AudiobookshelfClient, signInAudiobookshelf } from "./servers/audiobookshelf";
import type { BookClient, MusicClient } from "./servers/client";
import { JellyfinClient, signInJellyfin } from "./servers/jellyfin";
import { SubsonicClient, signInSubsonic } from "./servers/subsonic";
import { ServerError, type Credential, type ServerAccount, type ServerKind } from "./types";

interface AccountsState {
  servers: ServerAccount[];
  update: (id: string, patch: Partial<ServerAccount>) => void;
}

export const useAccounts = create<AccountsState>()(
  persist(
    (set) => ({
      servers: [],
      update: (id, patch) => set((s) => ({ servers: s.servers.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
    }),
    { name: "ampli.servers", partialize: (s) => ({ servers: s.servers }) },
  ),
);

const credentials = new Map<string, Credential>();
const secretKey = (id: string) => `server:${id}`;

export async function loadCredentials() {
  await Promise.all(
    useAccounts.getState().servers.map(async (a) => {
      const raw = await secretGet(secretKey(a.id));
      if (raw) credentials.set(a.id, JSON.parse(raw));
    }),
  );
}

async function saveCredential(id: string, credential: Credential) {
  credentials.set(id, credential);
  await secretSet(secretKey(id), JSON.stringify(credential));
}

export const account = (id: string) => useAccounts.getState().servers.find((a) => a.id === id);
export const servers = () => useAccounts.getState().servers;

const clients = new Map<string, { at: string; client: MusicClient & Partial<BookClient> }>();

/** One client per server, rebuilt when the account or its credential changes. */
function clientFor(id: string): (MusicClient & Partial<BookClient>) | (BookClient & Partial<MusicClient>) | null {
  const a = account(id);
  const c = credentials.get(id);
  if (!a || !c) return null;
  const stamp = JSON.stringify([a.url, a.pinnedCertificate, a.allowsUnencrypted, a.userId, c]);
  const cached = clients.get(id);
  if (cached && cached.at === stamp) return cached.client;
  const conn = connectionOf(a);
  let client: unknown = null;
  switch (a.kind) {
    case "jellyfin":
      if (c.jellyfinToken && a.userId) client = new JellyfinClient(conn, a.id, a.userId, c.jellyfinToken);
      break;
    case "subsonic":
      if (c.subsonic) client = new SubsonicClient(conn, a.id, a.username, c.subsonic);
      break;
    case "audiobookshelf":
      if (c.audiobookshelf)
        client = new AudiobookshelfClient(conn, a.id, c.audiobookshelf, (tokens) => void saveCredential(a.id, { ...c, audiobookshelf: tokens }));
      break;
    case "amplicon":
      if (c.amplicon) client = new AmpliconClient(conn, a.id, c.amplicon);
      break;
  }
  if (client) clients.set(id, { at: stamp, client: client as MusicClient });
  return client as MusicClient | null;
}

export function musicClient(id: string): MusicClient | null {
  const a = account(id);
  return a && (a.kind === "jellyfin" || a.kind === "subsonic" || a.kind === "amplicon") ? (clientFor(id) as MusicClient) : null;
}

export function bookClient(id: string): BookClient | null {
  const a = account(id);
  return a && (a.kind === "jellyfin" || a.kind === "audiobookshelf") ? (clientFor(id) as BookClient) : null;
}

export function ampliconClient(id: string): AmpliconClient | null {
  const a = account(id);
  return a?.kind === "amplicon" ? (clientFor(id) as unknown as AmpliconClient) : null;
}

export interface SignInForm {
  kind: ServerKind;
  url: string;
  username: string;
  password: string;
  name?: string;
  allowsUnencrypted?: boolean;
  pin?: string;
  /** Signing in again to an existing server. */
  replaceId?: string;
}

/** Signs in and saves the server. Throws ServerError ("certificate" means: ask the user to trust it). */
export async function signIn(form: SignInForm): Promise<{ account: ServerAccount; amplicon?: AmpliconInfo }> {
  const url = normalizeServerURL(form.url);
  if (!url) throw new ServerError("That doesn't look like a server address.", "server");
  const allowsUnencrypted = form.allowsUnencrypted ?? isLocalAddress(url);
  const conn: Connection = { url, pin: form.pin, allowsUnencrypted };
  const id = form.replaceId ?? crypto.randomUUID();
  const credential: Credential = {};
  let serverName: string | undefined;
  let userId: string | undefined;
  let amplicon: AmpliconInfo | undefined;

  switch (form.kind) {
    case "jellyfin": {
      const r = await signInJellyfin(conn, form.username, form.password);
      credential.jellyfinToken = r.token;
      userId = r.userId;
      serverName = r.serverName;
      break;
    }
    case "subsonic": {
      const r = await signInSubsonic(conn, form.username, form.password);
      credential.subsonic = r.auth;
      serverName = r.serverName;
      break;
    }
    case "audiobookshelf": {
      const r = await signInAudiobookshelf(conn, form.username, form.password);
      credential.audiobookshelf = r.tokens;
      serverName = r.serverName;
      break;
    }
    case "amplicon": {
      const r = await signInAmplicon(conn, form.username, form.password);
      credential.amplicon = r.credential;
      amplicon = r.info;
      serverName = r.info.name;
      break;
    }
  }

  const existing = form.replaceId ? account(form.replaceId) : undefined;
  const a: ServerAccount = existing
    ? { ...existing, url, username: form.username, userId, pinnedCertificate: form.pin, allowsUnencrypted, lastSyncError: undefined }
    : {
        id,
        kind: form.kind,
        url,
        username: form.username,
        // Docker containers name servers after their random host name ("ce865a7ceacb"): the address reads better.
        name: form.name?.trim() || (serverName && !/^[0-9a-f]{12,}$/i.test(serverName) ? serverName : new URL(url).hostname),
        userId,
        libraries: [],
        selectedLibraryIds: [],
        songCount: 0,
        albumCount: 0,
        bookCount: 0,
        pinnedCertificate: form.pin,
        allowsUnencrypted,
      };
  await saveCredential(id, credential);
  useAccounts.setState((s) => ({ servers: existing ? s.servers.map((x) => (x.id === id ? a : x)) : [...s.servers, a] }));
  return { account: a, amplicon };
}

export async function removeServer(id: string) {
  credentials.delete(id);
  clients.delete(id);
  await secretDelete(secretKey(id));
  useAccounts.setState((s) => ({ servers: s.servers.filter((a) => a.id !== id) }));
}

export const displayName = (a: ServerAccount) => a.name || new URL(a.url).hostname;
