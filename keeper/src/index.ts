/**
 * Nettle keeper — Sepolia Nox mode.
 * Signs txs locally (eth_sendRawTransaction).
 *
 * HTTP binds first and never process.exit on recoverable init failure so
 * Render free-tier probes get /health diagnostics instead of opaque 503 loops.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddress,
  type Abi,
  type Address,
  type EncodeFunctionDataParameters,
  type Hex,
  type PublicClient,
  type Chain,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";
import { mockRegistryAbi, noxRegistryAbi } from "./abi.js";
import {
  startHealthServer,
  closeHealthServer,
  setHealthIdentity,
  setConfigValid,
  setNoxReady,
  setRegistryReadable,
  recordTickStart,
  recordTickSuccess,
  recordTickFailure,
  recordRpcSuccess,
  recordAction,
  recordDecryptAttempt,
  clearDecryptBackoff,
  recordError,
  markShuttingDown,
  sanitizeError,
} from "./health.js";

// ---------------------------------------------------------------------------
// Bind HTTP immediately (before env validation) so Render detects PORT.
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 10000);
const healthServer = startHealthServer(PORT);

loadEnv({ path: resolve(process.cwd(), "../.env") });
loadEnv();

const MIN_POLL_MS = 2_000;
const DECRYPT_STUCK_AFTER = Number(process.env.DECRYPT_STUCK_AFTER ?? 12);
const DECRYPT_BACKOFF_MS = Number(process.env.DECRYPT_BACKOFF_MS ?? 8_000);
const DECRYPT_BACKOFF_MAX_MS = Number(
  process.env.DECRYPT_BACKOFF_MAX_MS ?? 120_000
);
const AUDIT_PATH =
  process.env.KEEPER_AUDIT_PATH ?? resolve(process.cwd(), "audit-log.jsonl");

function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra: Record<string, unknown> = {}
) {
  const row: Record<string, unknown> = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...extra,
  };
  // Never log secrets
  if (typeof row.rpc === "string") {
    row.rpc = String(row.rpc).replace(/\/v2\/[^/]+/g, "/v2/***");
  }
  const line = JSON.stringify(row);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function loadDeploy() {
  for (const p of [
    resolve(process.cwd(), "../deployments/sepolia.json"),
    resolve(process.cwd(), "../deployments/local.json"),
    resolve(process.cwd(), "deployments/sepolia.json"),
  ]) {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, "utf8")) as {
        registry: Address;
        chainId: number;
      };
    }
  }
  return null;
}

function normalizePk(raw: string | undefined): Hex {
  if (!raw) throw new Error("Missing PRIVATE_KEY / KEEPER_PRIVATE_KEY");
  const t = raw.trim().replace(/^["']|["']$/g, "");
  const hex = t.startsWith("0x") ? t : `0x${t}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `Invalid private key length (${hex.length - 2} hex chars, need 64)`
    );
  }
  return hex as Hex;
}

function resolveRpc(chainId: number): string {
  const rpc = process.env.RPC_URL?.trim();
  if (rpc) return rpc;
  if (chainId === 11155111) {
    throw new Error(
      "RPC_URL is required on Sepolia. Do not use the public Alchemy demo endpoint."
    );
  }
  if (chainId === 31337) return "http://127.0.0.1:8545";
  throw new Error(`RPC_URL required for chainId=${chainId}`);
}

function appendAudit(row: Record<string, unknown>) {
  try {
    const dir = resolve(AUDIT_PATH, "..");
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  try {
    appendFileSync(
      AUDIT_PATH,
      JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n"
    );
  } catch (e) {
    log("warn", "audit_write_failed", {
      err: sanitizeError((e as Error).message),
    });
  }
}

function backoffMs(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * Math.min(attempt, 8));
  const jitter = Math.floor(Math.random() * Math.min(1000, exp * 0.2));
  return exp + jitter;
}

async function sendContractTx(opts: {
  publicClient: PublicClient;
  account: PrivateKeyAccount;
  chain: Chain;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}): Promise<Hex> {
  const { publicClient, account, chain, address, abi, functionName, args } =
    opts;

  const data = encodeFunctionData({
    abi,
    functionName,
    args,
  } as EncodeFunctionDataParameters);

  const nonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const gasPrice = await publicClient.getGasPrice();
  const bumped = (gasPrice * 120n) / 100n;

  let gas: bigint;
  try {
    gas = await publicClient.estimateGas({
      account: account.address,
      to: address,
      data,
    });
    gas = (gas * 120n) / 100n;
  } catch {
    gas = 500_000n;
  }

  const signed = await account.signTransaction({
    to: address,
    data,
    gas,
    gasPrice: bumped,
    nonce,
    chainId: chain.id,
    type: "legacy",
  });

  return publicClient.sendRawTransaction({
    serializedTransaction: signed,
  });
}

type Runtime = {
  publicClient: PublicClient;
  account: PrivateKeyAccount;
  chain: Chain;
  registry: Address;
  mode: "mock" | "nox";
  pollMs: number;
  minOut: bigint;
  publicDecrypt: ((handle: Hex) => Promise<bigint>) | null;
};

async function buildRuntime(): Promise<Runtime> {
  const deploy = loadDeploy();
  const chainId = Number(
    process.env.CHAIN_ID ?? deploy?.chainId ?? 11155111
  );

  const modeRaw = (
    process.env.KEEPER_MODE ?? (chainId === 11155111 ? "nox" : "mock")
  ).toLowerCase();
  if (modeRaw !== "mock" && modeRaw !== "nox") {
    throw new Error(`KEEPER_MODE must be mock|nox, got ${modeRaw}`);
  }
  const mode = modeRaw as "mock" | "nox";

  if (mode === "nox" && chainId !== 11155111) {
    log("warn", "nox_mode_non_sepolia", { chainId });
  }

  const registryRaw =
    process.env.INTENT_REGISTRY_ADDRESS ?? deploy?.registry ?? "";
  if (!registryRaw || !isAddress(registryRaw)) {
    throw new Error(
      "Set INTENT_REGISTRY_ADDRESS to a valid address or provide deployments/sepolia.json"
    );
  }
  if (
    registryRaw.toLowerCase() ===
    "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error("INTENT_REGISTRY_ADDRESS cannot be zero");
  }
  const registry = registryRaw as Address;

  const pk = normalizePk(
    process.env.KEEPER_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  );
  const account = privateKeyToAccount(pk);

  const pollMs = Math.max(
    MIN_POLL_MS,
    Number(process.env.POLL_MS ?? 8000) || 8000
  );
  const minOutRaw = process.env.MIN_AMOUNT_OUT ?? "0";
  if (!/^\d+$/.test(minOutRaw)) {
    throw new Error("MIN_AMOUNT_OUT must be a nonnegative integer string");
  }
  const minOut = BigInt(minOutRaw);

  const rpc = resolveRpc(chainId);
  const chain = chainId === 11155111 ? sepolia : foundry;

  setHealthIdentity({
    chainId,
    registry,
    keeperAddress: account.address,
    mode,
  });
  setConfigValid(true);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpc, { timeout: 60_000 }),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpc, { timeout: 60_000 }),
  });

  log("info", "keeper_boot", {
    mode,
    registry,
    address: account.address,
    chainId,
    rpc,
    pollMs,
  });

  let publicDecrypt: ((handle: Hex) => Promise<bigint>) | null = null;
  if (mode === "nox") {
    try {
      const { createViemHandleClient } = await import("@iexec-nox/handle");
      const handleClient = await createViemHandleClient(walletClient as never);
      publicDecrypt = async (handle: Hex) => {
        const { value } = await handleClient.publicDecrypt(handle);
        return value as bigint;
      };
      setNoxReady(true);
      log("info", "nox_client_ready");
    } catch (e) {
      setNoxReady(false);
      const msg = sanitizeError((e as Error).message);
      recordError(`Nox SDK init failed: ${msg}`);
      log("warn", "nox_init_failed", { err: msg });
    }
  } else {
    setNoxReady(true);
  }

  return {
    publicClient,
    account,
    chain,
    registry,
    mode,
    pollMs,
    minOut,
    publicDecrypt,
  };
}

async function probeRpc(rt: Runtime) {
  const block = await rt.publicClient.getBlockNumber();
  const bal = await rt.publicClient.getBalance({
    address: rt.account.address,
  });
  recordRpcSuccess(block, bal);

  // Registry readable
  try {
    const epochId = (await rt.publicClient.readContract({
      address: rt.registry,
      abi: rt.mode === "mock" ? mockRegistryAbi : noxRegistryAbi,
      functionName: "currentEpochId",
    })) as bigint;
    setRegistryReadable(true, epochId);
  } catch (e) {
    setRegistryReadable(false);
    throw new Error(
      `registry_unreadable: ${sanitizeError((e as Error).message)}`
    );
  }
  return { block, bal };
}

async function tickMock(rt: Runtime) {
  const { publicClient, account, chain, registry, minOut } = rt;
  const epochId = (await publicClient.readContract({
    address: registry,
    abi: mockRegistryAbi,
    functionName: "currentEpochId",
  })) as bigint;
  setRegistryReadable(true, epochId);

  const ep = (await publicClient.readContract({
    address: registry,
    abi: mockRegistryAbi,
    functionName: "getEpoch",
    args: [epochId],
  })) as { state: number; closeBlock: bigint; participantCount: bigint };

  const block = await publicClient.getBlockNumber();
  if (ep.state === 0 && block >= ep.closeBlock && ep.participantCount > 0n) {
    log("info", "close_epoch", { epochId: epochId.toString() });
    const hash = await sendContractTx({
      publicClient,
      account,
      chain,
      address: registry,
      abi: mockRegistryAbi,
      functionName: "closeEpoch",
    });
    await publicClient.waitForTransactionReceipt({ hash });
    recordAction(`closeEpoch:${epochId}`, hash);
    return;
  }
  if (ep.state === 1) {
    log("info", "execute_epoch", { epochId: epochId.toString() });
    const hash = await sendContractTx({
      publicClient,
      account,
      chain,
      address: registry,
      abi: mockRegistryAbi,
      functionName: "executeEpoch",
      args: [minOut],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    recordAction(`executeEpoch:${epochId}`, hash);
  }
}

async function tickNox(
  rt: Runtime,
  decryptAttempts: number
): Promise<{ nextAttempts: number; backoffMs?: number }> {
  const { publicClient, account, chain, registry, minOut, publicDecrypt } = rt;

  const epochId = (await publicClient.readContract({
    address: registry,
    abi: noxRegistryAbi,
    functionName: "currentEpochId",
  })) as bigint;
  setRegistryReadable(true, epochId);

  const raw = (await publicClient.readContract({
    address: registry,
    abi: noxRegistryAbi,
    functionName: "epochs",
    args: [epochId],
  })) as unknown;

  const arr = raw as unknown as readonly unknown[];
  const state = Number(Array.isArray(arr) ? arr[0] : 0);
  const closeBlock = (Array.isArray(arr) ? arr[2] : 0n) as bigint;
  const netHandle = (Array.isArray(arr) ? arr[4] : "0x") as Hex;
  const participants = (Array.isArray(arr) ? arr[8] : 0n) as bigint;
  const block = await publicClient.getBlockNumber();

  if (state === 0 && block >= closeBlock) {
    log("info", "close_epoch", {
      epochId: epochId.toString(),
      participants: participants.toString(),
      empty: participants === 0n,
    });
    try {
      const hash = await sendContractTx({
        publicClient,
        account,
        chain,
        address: registry,
        abi: noxRegistryAbi,
        functionName: "closeEpoch",
      });
      log("info", "close_epoch_tx", { hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        recordError("closeEpoch reverted");
        return { nextAttempts: decryptAttempts, backoffMs: 30_000 };
      }
      clearDecryptBackoff();
      recordAction(`closeEpoch:${epochId}`, hash);
      appendAudit({
        event: "closeEpoch",
        epochId: epochId.toString(),
        participants: participants.toString(),
        tx: hash,
        netHandle,
      });
      return { nextAttempts: 0 };
    } catch (e) {
      const msg = sanitizeError((e as Error).message ?? "close failed");
      log("error", "close_epoch_failed", { err: msg });
      recordError(`closeEpoch: ${msg}`);
      return { nextAttempts: decryptAttempts, backoffMs: 15_000 };
    }
  }

  if (state === 1) {
    if (!publicDecrypt) {
      recordError("Nox publicDecrypt client not initialized");
      return { nextAttempts: decryptAttempts, backoffMs: 30_000 };
    }
    const zero = ("0x" + "0".repeat(64)) as Hex;
    if (!netHandle || netHandle === zero) {
      log("info", "net_handle_empty");
      return { nextAttempts: decryptAttempts };
    }
    try {
      const netSigned = await publicDecrypt(netHandle);
      log("info", "public_decrypt", { net: netSigned.toString() });
      appendAudit({
        event: "publicDecrypt",
        epochId: epochId.toString(),
        netHandle,
        netSigned: netSigned.toString(),
      });
      const hash = await sendContractTx({
        publicClient,
        account,
        chain,
        address: registry,
        abi: noxRegistryAbi,
        functionName: "executeEpoch",
        args: [netSigned, minOut],
      });
      log("info", "execute_epoch_tx", { hash });
      await publicClient.waitForTransactionReceipt({ hash });
      clearDecryptBackoff();
      recordAction(`executeEpoch:${epochId}`, hash);
      appendAudit({
        event: "executeEpoch",
        epochId: epochId.toString(),
        netHandle,
        netSigned: netSigned.toString(),
        tx: hash,
      });
      return { nextAttempts: 0 };
    } catch (e) {
      const next = decryptAttempts + 1;
      const stuck = next >= DECRYPT_STUCK_AFTER;
      const msg = sanitizeError((e as Error).message ?? "decrypt failed");
      log(stuck ? "error" : "info", "public_decrypt_pending", {
        attempt: next,
        stuck,
        err: msg,
        epochId: epochId.toString(),
      });
      recordDecryptAttempt(next, stuck, msg);
      return {
        nextAttempts: next,
        backoffMs: backoffMs(next, DECRYPT_BACKOFF_MS, DECRYPT_BACKOFF_MAX_MS),
      };
    }
  }

  if (state === 0 && Number(block % 20n) === 0) {
    log("info", "idle", {
      epochId: epochId.toString(),
      block: block.toString(),
      close: closeBlock.toString(),
      people: participants.toString(),
    });
  }

  return { nextAttempts: 0 };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  markShuttingDown();
  log("info", "shutdown", { signal });
  if (intervalHandle) clearInterval(intervalHandle);
  await closeHealthServer(healthServer);
  // Do not process.exit — let the platform stop the container.
  // If needed for local CLI:
  if (process.env.KEEPER_EXIT_ON_SIGNAL === "1") process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

async function main() {
  let rt: Runtime | null = null;
  let initAttempt = 0;

  // Retry boot with capped exponential backoff — process stays alive.
  while (!rt && !shuttingDown) {
    initAttempt += 1;
    try {
      rt = await buildRuntime();
      await probeRpc(rt);
      log("info", "init_ok", { attempt: initAttempt });
    } catch (e) {
      const msg = sanitizeError(
        e instanceof Error ? e.message : String(e)
      );
      setConfigValid(false);
      recordError(msg);
      log("error", "init_failed", { attempt: initAttempt, err: msg });
      const wait = backoffMs(initAttempt, 3_000, 60_000);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (!rt || shuttingDown) return;

  let busy = false;
  let decryptAttempts = 0;
  let nextDecryptNotBefore = 0;

  async function tick() {
    if (busy || shuttingDown || !rt) return;
    busy = true;
    recordTickStart();
    try {
      await probeRpc(rt);
      if (rt.mode === "mock") {
        await tickMock(rt);
      } else {
        if (Date.now() >= nextDecryptNotBefore) {
          const r = await tickNox(rt, decryptAttempts);
          decryptAttempts = r.nextAttempts;
          if (r.backoffMs) nextDecryptNotBefore = Date.now() + r.backoffMs;
        }
      }
      recordTickSuccess();
    } catch (e) {
      const msg = sanitizeError(
        e instanceof Error ? e.message : String(e)
      );
      log("error", "tick_error", { err: msg });
      recordTickFailure(msg);
    } finally {
      busy = false;
    }
  }

  await tick();
  intervalHandle = setInterval(tick, rt.pollMs);
}

main().catch((e) => {
  const msg = sanitizeError(e instanceof Error ? e.message : String(e));
  log("error", "main_fatal", { err: msg });
  recordError(msg);
  setConfigValid(false);
  // Stay alive for /health diagnostics — never process.exit here.
});
