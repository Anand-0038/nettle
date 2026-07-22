"use client";

export function TokenIcon({ symbol }: { symbol: string }) {
  const s = symbol.toUpperCase();
  if (s.includes("USDC") || s.includes("USD")) {
    return (
      <span className="token-icon usdc" aria-hidden>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2" />
          <path
            d="M12 6v12M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5-1.3 2.5-3 2.5-3 1.1-3 2.5 1.3 2.5 3 2.5 3-1.1 3-2.5"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  if (s.includes("WETH") || s.includes("ETH")) {
    return (
      <span className="token-icon weth" aria-hidden>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
          <path d="M12 3L5.5 12.2 12 15.5l6.5-3.3L12 3z" fill="#fff" opacity="0.95" />
          <path d="M5.5 13.4L12 21l6.5-7.6L12 16.7 5.5 13.4z" fill="#fff" opacity="0.7" />
        </svg>
      </span>
    );
  }
  return (
    <span className="token-icon generic" aria-hidden>
      {s.slice(0, 1)}
    </span>
  );
}
