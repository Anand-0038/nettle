"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";

const links = [
  { href: "/", label: "Swap", icon: "⟳" },
  { href: "/batch", label: "Batch", icon: "◎" },
  { href: "/history", label: "History", icon: "◷" },
  { href: "/inspect", label: "Inspect", icon: "▣" },
];

function FoxMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 8.5C6 8.5 7.5 4 12 4s6 4.5 6 4.5l2.5 1.5-1.5 3L19 14l-2 5H7l-2-5 .5-1.5-2-3L6 8.5z"
        fill="white"
        fillOpacity="0.95"
      />
      <circle cx="9.2" cy="12" r="1.1" fill="#1a1612" />
      <circle cx="14.8" cy="12" r="1.1" fill="#1a1612" />
      <path
        d="M10 15.2c.6.7 1.4 1 2 1s1.4-.3 2-1"
        stroke="#1a1612"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Nav() {
  const path = usePathname();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <>
      <header className="nav">
        <div className="brand">
          <div className="logo">
            <FoxMark />
          </div>
          <div className="brand-text">
            <h1>Nettle</h1>
            <p>Confidential notional netting</p>
          </div>
        </div>

        <nav className="tabs" aria-label="Main">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={path === l.href ? "active" : ""}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="nav-actions">
          {isConnected ? (
            <button type="button" className="btn btn-ghost" onClick={() => disconnect()}>
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-connect"
              disabled={isPending}
              onClick={() => connect({ connector: connectors[0] })}
            >
              {isPending ? "…" : "Connect"}
            </button>
          )}
        </div>
      </header>

      <nav className="bottom-nav" aria-label="Mobile">
        <div className="bottom-nav-inner">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={path === l.href ? "active" : ""}
            >
              <span className="icon">{l.icon}</span>
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
