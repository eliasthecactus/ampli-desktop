import { useState } from "react";
import { time } from "../lib/format";

/** A range input that only seeks when let go, and fills up to the value. */
export function Slider({
  value,
  max,
  onChange,
  onLive,
  step = 0.1,
  label,
  className = "",
  vertical,
  min = 0,
}: {
  value: number;
  max: number;
  min?: number;
  onChange: (v: number) => void;
  onLive?: (v: number) => void;
  step?: number;
  label: string;
  className?: string;
  vertical?: boolean;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const v = drag ?? value;
  const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      aria-label={label}
      className={`slider ${vertical ? "vertical" : ""} ${className}`}
      min={min}
      max={max || 1}
      step={step}
      value={Math.min(Math.max(v, min), max || 1)}
      style={{ "--pct": `${Math.max(0, Math.min(100, pct))}%` } as React.CSSProperties}
      onChange={(e) => {
        const n = Number(e.target.value);
        setDrag(n);
        onLive?.(n);
      }}
      onPointerUp={() => {
        if (drag !== null) onChange(drag);
        setDrag(null);
      }}
      onKeyUp={() => {
        if (drag !== null) onChange(drag);
        setDrag(null);
      }}
    />
  );
}

export function Progress({ position, duration, onSeek, live }: { position: number; duration: number; onSeek?: (t: number) => void; live?: boolean }) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? position;
  return (
    <div className="progress">
      <span className="time">{live ? "" : time(shown)}</span>
      {live ? (
        <div className="live-line">
          <span className="live-dot" /> LIVE
        </div>
      ) : (
        <Slider label="Position" value={position} max={duration} onLive={setDrag} onChange={(t) => (setDrag(null), onSeek?.(t))} />
      )}
      <span className="time right">{live ? "" : `-${time(Math.max(0, duration - shown))}`}</span>
    </div>
  );
}
