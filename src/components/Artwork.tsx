import { Music } from "lucide-react";
import { useState, type ReactNode } from "react";

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A soft gradient for things without a cover, the same for the same name. */
export function placeholder(seed: string) {
  const h = hash(seed || "ampli");
  const a = h % 360;
  const b = (a + 40 + (h % 60)) % 360;
  return `linear-gradient(135deg, hsl(${a} 55% 46%), hsl(${b} 60% 30%))`;
}

export function Artwork({
  src,
  seed = "",
  icon,
  round,
  className = "",
  label,
  color,
}: {
  src?: string;
  seed?: string;
  icon?: ReactNode;
  round?: boolean;
  className?: string;
  /** Text instead of an icon (radio monograms). */
  label?: string;
  color?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  return (
    <div className={`artwork ${round ? "round" : ""} ${className}`} style={show ? undefined : { background: color ?? placeholder(seed) }}>
      {show ? (
        <img src={src} alt="" loading="lazy" draggable={false} crossOrigin="anonymous" onError={() => setFailed(src!)} />
      ) : label ? (
        <span className={`artwork-label ${label.length > 5 ? "long" : ""}`}>{label}</span>
      ) : (
        <span className="artwork-icon">{icon ?? <Music />}</span>
      )}
    </div>
  );
}
