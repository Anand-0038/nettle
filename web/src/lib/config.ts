import { http, createConfig } from "wagmi";
import { injected } from "@wagmi/core";
import { foundry, sepolia, type Chain } from "wagmi/chains";

/** Hardhat / Anvil local — explicit name so MetaMask can add it cleanly */
export const hardhatLocal: Chain = {
  ...foundry,
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
};

export const TARGET_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337
);

// Prefer Alchemy (set NEXT_PUBLIC_RPC_URL). Free public RPCs rate-limit eth_getLogs hard.
const rpc =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (TARGET_CHAIN_ID === 11155111
    ? "https://sepolia.drpc.org"
    : "http://127.0.0.1:8545");

export const chain: Chain =
  TARGET_CHAIN_ID === 11155111 ? sepolia : hardhatLocal;

/** Both chains registered so switchChain works from Base/mainnet */
export const wagmiConfig = createConfig({
  chains: [hardhatLocal, sepolia],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [hardhatLocal.id]: http(
      TARGET_CHAIN_ID === 31337 ? rpc : "http://127.0.0.1:8545"
    ),
    [sepolia.id]: http(
      TARGET_CHAIN_ID === 11155111
        ? rpc
        : "https://ethereum-sepolia-rpc.publicnode.com"
    ),
  },
  ssr: true,
});

const explicitDemo = process.env.NEXT_PUBLIC_DEMO_MODE;
export const DEMO_MODE =
  explicitDemo !== undefined
    ? explicitDemo === "true"
    : TARGET_CHAIN_ID !== 11155111;

export const REGISTRY =
  (process.env.NEXT_PUBLIC_INTENT_REGISTRY_ADDRESS as `0x${string}`) ||
  undefined;

export const TOKEN0 =
  (process.env.NEXT_PUBLIC_TOKEN0_ADDRESS as `0x${string}`) || undefined;
export const TOKEN1 =
  (process.env.NEXT_PUBLIC_TOKEN1_ADDRESS as `0x${string}`) || undefined;

export const EPOCH_STATE = ["Open", "Closed", "Executed"] as const;

export const SEPOLIA = {
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const,
  weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as const,
  swapRouter02: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E" as const,
  noxCompute: "0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF" as const,
  v4PoolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543" as const,
  chainId: 11155111,
};

export function chainLabel(id: number): string {
  if (id === 31337) return "Hardhat Local";
  if (id === 11155111) return "Sepolia";
  if (id === 8453) return "Base";
  if (id === 1) return "Ethereum";
  return `Chain ${id}`;
}
