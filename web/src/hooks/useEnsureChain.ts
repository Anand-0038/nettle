"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { TARGET_CHAIN_ID, chainLabel } from "@/lib/config";

/**
 * Ensure wallet is on the app's target chain (Hardhat 31337 or Sepolia).
 * Prevents approve() to Hardhat addresses while MetaMask is on Base/mainnet
 * (Blockaid flags 0x5FbDB… as malicious on public nets).
 */
export function useEnsureChain() {
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync, isPending, error } = useSwitchChain();

  const onTarget = chainId === TARGET_CHAIN_ID;
  const wrongNetwork = isConnected && chainId !== undefined && !onTarget;

  async function ensureChain(): Promise<boolean> {
    if (!isConnected) {
      throw new Error("Connect your wallet first");
    }
    if (chainId === TARGET_CHAIN_ID) return true;

    try {
      await switchChainAsync({ chainId: TARGET_CHAIN_ID });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Switch MetaMask to ${chainLabel(TARGET_CHAIN_ID)} (id ${TARGET_CHAIN_ID}). ` +
          `Currently on ${chainLabel(chainId ?? 0)}. ${msg.includes("rejected") || msg.includes("denied") ? "Switch cancelled." : msg}`
      );
    }
  }

  return {
    chainId,
    targetChainId: TARGET_CHAIN_ID,
    targetLabel: chainLabel(TARGET_CHAIN_ID),
    currentLabel: chainId !== undefined ? chainLabel(chainId) : "—",
    onTarget,
    wrongNetwork,
    ensureChain,
    isSwitching: isPending,
    switchError: error,
  };
}
