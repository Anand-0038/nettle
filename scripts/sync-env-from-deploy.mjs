#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localPath = resolve(root, "deployments/local.json");
const sepoliaPath = resolve(root, "deployments/sepolia.json");

const useSepolia =
  process.argv.includes("--sepolia") ||
  (existsSync(sepoliaPath) && process.argv.includes("--prefer-sepolia"));

const path = useSepolia && existsSync(sepoliaPath) ? sepoliaPath : localPath;
if (!existsSync(path)) {
  console.error("No deploy file at", path);
  process.exit(1);
}

const d = JSON.parse(readFileSync(path, "utf8"));
const isLocal = d.chainId === 31337;

const webEnv = `NEXT_PUBLIC_CHAIN_ID=${d.chainId}
NEXT_PUBLIC_RPC_URL=${isLocal ? "http://127.0.0.1:8545" : "https://ethereum-sepolia-rpc.publicnode.com"}
NEXT_PUBLIC_INTENT_REGISTRY_ADDRESS=${d.registry}
NEXT_PUBLIC_TOKEN0_ADDRESS=${d.token0}
NEXT_PUBLIC_TOKEN1_ADDRESS=${d.token1}
NEXT_PUBLIC_AMM_ADDRESS=${d.mockAmm ?? d.executor ?? ""}
NEXT_PUBLIC_DEMO_MODE=${isLocal ? "true" : "false"}
`;

const rootEnv = `CHAIN_ID=${d.chainId}
RPC_URL=${isLocal ? "http://127.0.0.1:8545" : "https://ethereum-sepolia-rpc.publicnode.com"}
INTENT_REGISTRY_ADDRESS=${d.registry}
TOKEN0_ADDRESS=${d.token0}
TOKEN1_ADDRESS=${d.token1}
KEEPER_MODE=${isLocal ? "mock" : "nox"}
KEEPER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
MIN_AMOUNT_OUT=0
POLL_MS=3000
`;

writeFileSync(resolve(root, "web/.env.local"), webEnv);
writeFileSync(resolve(root, ".env"), rootEnv);
console.log("Synced env from", path);
console.log("token0", d.token0, "registry", d.registry);
