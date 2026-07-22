"use client";

export function EpochRing({
  progress,
  label,
}: {
  progress: number;
  label: string;
}) {
  const p = Math.max(0, Math.min(100, progress));
  return (
    <div className="ring" style={{ ["--p" as string]: p }} aria-hidden>
      <div className="ring-inner">{label}</div>
    </div>
  );
}
