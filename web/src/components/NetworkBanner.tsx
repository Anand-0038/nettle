"use client";

import { useEnsureChain } from "@/hooks/useEnsureChain";

export function NetworkBanner() {
  const {
    wrongNetwork,
    currentLabel,
    targetLabel,
    targetChainId,
    ensureChain,
    isSwitching,
  } = useEnsureChain();

  if (!wrongNetwork) return null;

  return (
    <div className="net-banner" role="alert">
      <div>
        <strong>Wrong network</strong>
        <p>
          Wallet is on <em>{currentLabel}</em>. Nettle needs{" "}
          <em>{targetLabel}</em> ({targetChainId}). Approving on Base/mainnet
          can trigger MetaMask scam warnings for local contract addresses.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-primary net-banner-btn"
        disabled={isSwitching}
        onClick={() => ensureChain().catch(() => {})}
      >
        {isSwitching ? "Switching…" : `Switch to ${targetLabel}`}
      </button>
    </div>
  );
}
