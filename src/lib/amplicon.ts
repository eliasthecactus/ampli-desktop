// What the app knows about the user's Amplicon servers: profiles and locations, For You, and the downloads
// running on them. While something downloads it asks every two seconds; when a download finishes it says so
// and syncs the music servers when the location asks one to scan, so the new songs show up in the library.
import { create } from "zustand";
import { ampliconClient, servers } from "./accounts";
import { syncAll } from "./library";
import { errorText, toast } from "./nav";
import { jobIsActive, jobNeedsReview, type AmpliconInfo, type AmpliconJob, type AmpliconLocation, type AmpliconProfile, type CatalogHome } from "./servers/amplicon";

interface AmpliconState {
  info: Record<string, AmpliconInfo>;
  errors: Record<string, string>;
  jobs: Record<string, AmpliconJob[]>;
  forYou: Record<string, CatalogHome>;
  forYouAsked: Record<string, boolean>;
  reviewing: { serverId: string; job: number } | null;
}

export const useAmplicon = create<AmpliconState>(() => ({ info: {}, errors: {}, jobs: {}, forYou: {}, forYouAsked: {}, reviewing: null }));

const get = () => useAmplicon.getState();
const ampliconServers = () => servers().filter((s) => s.kind === "amplicon");

export const activeJobs = () => Object.values(get().jobs).flat().filter((j) => jobIsActive(j) && !jobNeedsReview(j));

const waitingForReview = new Set<number>();
let polling = false;
let watchers = 0;

export async function refreshInfo(serverId: string) {
  const client = ampliconClient(serverId);
  if (!client) return;
  try {
    const info = await client.info();
    useAmplicon.setState((s) => ({ info: { ...s.info, [serverId]: info }, errors: { ...s.errors, [serverId]: "" } }));
  } catch (e) {
    useAmplicon.setState((s) => ({ errors: { ...s.errors, [serverId]: errorText(e) } }));
  }
}

export async function refreshAll() {
  for (const s of ampliconServers()) {
    await refreshInfo(s.id);
    await refreshJobs(s.id);
  }
  if (activeJobs().length) startPolling();
}

export async function loadForYou(serverId: string, refresh = false) {
  const client = ampliconClient(serverId);
  if (!client) return;
  try {
    const home = await client.home(refresh);
    useAmplicon.setState((s) => ({ forYou: { ...s.forYou, [serverId]: home } }));
  } catch {
    /* older servers have no For You */
  }
  useAmplicon.setState((s) => ({ forYouAsked: { ...s.forYouAsked, [serverId]: true } }));
}

export const profiles = (serverId: string): AmpliconProfile[] => get().info[serverId]?.profiles ?? [];
export const locations = (serverId: string): AmpliconLocation[] => get().info[serverId]?.locations ?? [];

export async function download(
  serverId: string,
  kind: "song" | "album" | "playlist",
  id: string,
  title: string,
  subtitle?: string,
  thumbnail?: string,
  profile?: AmpliconProfile,
) {
  const client = ampliconClient(serverId);
  if (!client) return;
  try {
    const job = await client.download(kind, id, title, subtitle, thumbnail, profile?.id, profile?.locationId);
    useAmplicon.setState((s) => ({ jobs: { ...s.jobs, [serverId]: [job, ...(s.jobs[serverId] ?? []).filter((j) => j.id !== job.id)] } }));
    if (job.review) {
      waitingForReview.add(job.id);
      toast(`Looking up ${title}`);
    } else toast(`Adding ${title}${job.locationName ? ` → ${job.locationName}` : ""}`);
    startPolling();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

export async function refreshJobs(serverId: string) {
  const client = ampliconClient(serverId);
  if (!client) return;
  const fresh = await client.jobs(30).catch(() => null);
  if (!fresh) return;
  const before = new Map((get().jobs[serverId] ?? []).map((j) => [j.id, j]));
  useAmplicon.setState((s) => ({ jobs: { ...s.jobs, [serverId]: fresh } }));
  for (const job of fresh) {
    if (!jobIsActive(job) && before.get(job.id) && jobIsActive(before.get(job.id)!)) finished(job, serverId);
    // Only what was started here opens by itself; the rest waits in Downloads.
    if (jobNeedsReview(job) && waitingForReview.has(job.id)) {
      waitingForReview.delete(job.id);
      if (!get().reviewing) useAmplicon.setState({ reviewing: { serverId, job: job.id } });
    }
  }
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;
function finished(job: AmpliconJob, serverId: string) {
  if (job.status === "done") toast(`Added ${job.title}`, "ok");
  else if (job.status === "partial") toast(`${job.title}: ${job.failed} songs failed`, "error");
  else if (job.status === "failed") toast(`${job.title} couldn't be added`, "error");
  else return;
  // The server asked Navidrome or Jellyfin to scan; give it a moment, then pick up the new songs.
  const scans = locations(serverId).find((l) => l.name === job.locationName)?.scans;
  if (!scans || job.done === 0) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncAll(), 20_000);
}

export async function jobAction(serverId: string, job: AmpliconJob, action: "cancel" | "retry" | "remove") {
  const client = ampliconClient(serverId);
  if (!client) return;
  try {
    if (action === "cancel") await client.cancel(job.id);
    if (action === "retry") await client.retry(job.id);
    if (action === "remove") {
      await client.remove(job.id);
      useAmplicon.setState((s) => ({ jobs: { ...s.jobs, [serverId]: (s.jobs[serverId] ?? []).filter((j) => j.id !== job.id) } }));
      return;
    }
    await refreshJobs(serverId);
    if (action === "retry") startPolling();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

export function jobStarted(serverId: string, job: AmpliconJob) {
  useAmplicon.setState((s) => ({ jobs: { ...s.jobs, [serverId]: [job, ...(s.jobs[serverId] ?? []).filter((j) => j.id !== job.id)] } }));
  startPolling();
}

function startPolling() {
  if (polling) return;
  polling = true;
  const tick = async () => {
    if (!activeJobs().length && !waitingForReview.size) {
      polling = false;
      return;
    }
    if (watchers === 0) for (const s of ampliconServers()) await refreshJobs(s.id);
    setTimeout(tick, 2000);
  };
  setTimeout(tick, 2000);
}

/** Downloads screens call this while visible, so the list stays fresh. Returns a function to stop. */
export function watch(): () => void {
  watchers++;
  let stopped = false;
  const loop = async () => {
    if (stopped) return;
    for (const s of ampliconServers()) await refreshJobs(s.id);
    setTimeout(loop, activeJobs().length ? 1500 : 6000);
  };
  void loop();
  return () => {
    stopped = true;
    watchers--;
  };
}
