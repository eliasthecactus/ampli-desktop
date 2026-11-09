import { MoreHorizontal, Play, Shuffle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { dominantColor } from "../lib/artwork";

export function DetailHeader({
  art,
  artURL,
  kind,
  title,
  meta,
  description,
  onPlay,
  onShuffle,
  onMenu,
  actions,
  round,
}: {
  art: ReactNode;
  artURL?: string;
  kind: string;
  title: string;
  meta?: ReactNode;
  description?: string;
  onPlay?: () => void;
  onShuffle?: () => void;
  onMenu?: (e: React.MouseEvent) => void;
  actions?: ReactNode;
  round?: boolean;
}) {
  const [tint, setTint] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setTint(null);
    void dominantColor(artURL).then((c) => alive && setTint(c));
    return () => {
      alive = false;
    };
  }, [artURL]);
  return (
    <header className={`detail-head ${round ? "round" : ""}`} style={tint ? ({ "--tint": tint } as React.CSSProperties) : undefined}>
      <div className="detail-glow" />
      <div className="detail-art">{art}</div>
      <div className="detail-info">
        <span className="eyebrow">{kind}</span>
        <h1 className={title.length > 40 ? "long" : ""}>{title}</h1>
        {meta && <div className="detail-meta">{meta}</div>}
        {description && <p className="detail-desc">{description.replace(/<[^>]+>/g, " ")}</p>}
        <div className="detail-actions">
          {onPlay && (
            <button className="btn primary" onClick={onPlay}>
              <Play size={16} fill="currentColor" /> Play
            </button>
          )}
          {onShuffle && (
            <button className="btn" onClick={onShuffle}>
              <Shuffle size={16} /> Shuffle
            </button>
          )}
          {actions}
          {onMenu && (
            <button className="icon-btn" onClick={onMenu} aria-label="More">
              <MoreHorizontal />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
