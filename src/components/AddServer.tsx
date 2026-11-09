import { BookOpen, Lock, Music, Server, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { signIn, type SignInForm } from "../lib/accounts";
import { refreshAll } from "../lib/amplicon";
import { isLocalAddress, normalizeServerURL } from "../lib/http";
import { syncServer } from "../lib/library";
import { probeCertificate } from "../lib/native";
import { errorText, toast } from "../lib/nav";
import { serverKinds, ServerError, type ServerAccount, type ServerKind } from "../lib/types";
import { openDialog } from "../lib/ui";
import { confirm, Dialog } from "./Dialog";
import { Spinner, Toggle } from "./Shelf";

const kindIcon: Record<ServerKind, React.ReactNode> = {
  jellyfin: <Server />,
  subsonic: <Music />,
  audiobookshelf: <BookOpen />,
  amplicon: <Sparkles />,
};

const placeholders: Record<ServerKind, string> = {
  jellyfin: "jellyfin.example.com or 192.168.1.10:8096",
  subsonic: "music.example.com or 192.168.1.10:4533",
  audiobookshelf: "books.example.com or 192.168.1.10:13378",
  amplicon: "amplicon.example.com or 192.168.1.10:8080",
};

const fingerprint = (hex: string) => hex.toUpperCase().match(/.{2}/g)!.join(":");

function AddServerForm({ close, existing, onDone }: { close: () => void; existing?: ServerAccount; onDone?: (a: ServerAccount) => void }) {
  const [kind, setKind] = useState<ServerKind | null>(existing?.kind ?? null);
  const [url, setUrl] = useState(existing?.url ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [http, setHttp] = useState<boolean | null>(existing?.allowsUnencrypted ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeServerURL(url);
  const isHttp = normalized?.startsWith("http://") ?? false;
  const allowHttp = http ?? (normalized ? isLocalAddress(normalized) : false);

  const submit = async (pin = existing?.pinnedCertificate) => {
    if (!kind) return;
    setBusy(true);
    setError(null);
    const form: SignInForm = { kind, url, username, password, name, allowsUnencrypted: allowHttp, pin, replaceId: existing?.id };
    try {
      const { account } = await signIn(form);
      close();
      toast(`Connected to ${account.name}`, "ok");
      onDone?.(account);
      if (account.kind === "amplicon") void refreshAll();
      else void syncServer(account.id);
    } catch (e) {
      if (e instanceof ServerError && e.kind === "certificate" && normalized) {
        try {
          const fp = await probeCertificate(normalized);
          const ok = await confirm(
            "Trust this certificate?",
            <>
              The server's certificate isn't signed by a known authority (self-signed). Only trust it if it's your server. Ampli will accept exactly this certificate
              for this server and nothing else.
              <code className="fingerprint">SHA-256 {fingerprint(fp)}</code>
            </>,
            "Trust and Connect",
            false,
          );
          if (ok) return void submit(fp);
        } catch (p) {
          setError(errorText(p));
        }
      } else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!kind)
    return (
      <div className="kind-grid">
        {serverKinds.map((k) => (
          <button key={k.kind} className="kind-card" onClick={() => setKind(k.kind)}>
            <span className="kind-icon">{kindIcon[k.kind]}</span>
            <strong>{k.name}</strong>
            <span>{k.detail}</span>
          </button>
        ))}
      </div>
    );

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {!existing && (
        <button type="button" className="kind-chosen" onClick={() => setKind(null)}>
          {kindIcon[kind]} {serverKinds.find((k) => k.kind === kind)!.name} <span className="link">Change</span>
        </button>
      )}
      <label className="field">
        <span>Server Address</span>
        <input autoFocus={!existing} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={placeholders[kind]} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus={!!existing} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      </div>
      {!existing && (
        <label className="field">
          <span>Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Uses the server's name" />
        </label>
      )}
      {isHttp && (
        <div className={`notice ${allowHttp ? "" : "warn"}`}>
          {allowHttp ? <Lock size={16} /> : <ShieldAlert size={16} />}
          <div>
            <strong>Allow Unencrypted Connection</strong>
            <p>This address uses http: passwords and music travel unencrypted. Fine at home, not over the internet.</p>
          </div>
          <Toggle checked={allowHttp} onChange={setHttp} label="Allow Unencrypted Connection" />
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn ghost" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy || !normalized || !username || (!password && kind !== "subsonic")}>
          {busy && <Spinner size={14} />} {existing ? "Sign In" : "Connect"}
        </button>
      </div>
    </form>
  );
}

export function addServer(onDone?: (a: ServerAccount) => void) {
  openDialog((close) => (
    <Dialog title="Add a Server" onClose={close}>
      <AddServerForm close={close} onDone={onDone} />
    </Dialog>
  ));
}

export function signInAgain(a: ServerAccount) {
  openDialog((close) => (
    <Dialog title={`Sign in to ${a.name}`} onClose={close}>
      <AddServerForm close={close} existing={a} />
    </Dialog>
  ));
}
