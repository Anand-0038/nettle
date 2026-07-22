/**
 * Nettle keeper — Sepolia Nox mode.
 * Signs txs locally (eth_sendRawTransaction). Alchemy rejects eth_sendTransaction.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type Chain,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";
import { mockRegistryAbi, noxRegistryAbi } from "./abi.js";

// Load ../.env then .env
loadEnv({ path: resolve(process.cwd(), "../.env") });
loadEnv();

const chainIdEnv = Number(process.env.CHAIN_ID ?? 11155111);
const MODE = (process.env.KEEPER_MODE ??
  (chainIdEnv === 11155111 ? "nox" : "mock")) as "mock" | "nox";
const POLL_MS = Number(process.env.POLL_MS ?? 8000);
const MIN_OUT = BigInt(process.env.MIN_AMOUNT_OUT ?? "0");
const DECRYPT_RETRIES = 12;

function loadDeploy() {
  for (const p of [
    resolve(process.cwd(), "../deployments/sepolia.json"),
    resolve(process.cwd(), "../deployments/local.json"),
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
    throw new Error(`Invalid private key length (${hex.length - 2} hex chars, need 64)`);
  }
  return hex as Hex;
}

/** Local sign + eth_sendRawTransaction (works with Alchemy). */
async function sendContractTx(opts: {
  publicClient: PublicClient;
  account: PrivateKeyAccount;
  chain: Chain;
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}): Promise<Hex> {
  const { publicClient, account, chain, address, abi, functionName, args } =
    opts;

  const data = encodeFunctionData({
    abi: abi as never,
    functionName: functionName as never,
    args: (args ?? []) as never,
  });

  const nonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const gasPrice = await publicClient.getGasPrice();
  // bump for sepolia congestion
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

async function main() {
  const deploy = loadDeploy();
  const registry = (process.env.INTENT_REGISTRY_ADDRESS ??
    deploy?.registry) as Address | undefined;
  if (!registry) {
    throw new Error("Set INTENT_REGISTRY_ADDRESS or deployments/sepolia.json");
  }

  const pk = normalizePk(
    process.env.KEEPER_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  );
  const account = privateKeyToAccount(pk);

  const chainId = Number(process.env.CHAIN_ID ?? deploy?.chainId ?? 11155111);
  const chain = chainId === 11155111 ? sepolia : foundry;
  const rpc =
    process.env.RPC_URL ??
    (chainId === 11155111
      ? "https://eth-sepolia.g.alchemy.com/v2/demo"
      : "http://127.0.0.1:8545");

  const publicClient = createPublicClient({
    chain,
    transport: http(rpc, { timeout: 60_000 }),
  });

  // Wallet client only for Nox SDK EIP-712 signatures (not for eth_sendTransaction)
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpc, { timeout: 60_000 }),
  });

  console.log(`[keeper] mode=${MODE} registry=${registry}`);
  console.log(`[keeper] address=${account.address} chain=${chainId}`);
  console.log(`[keeper] rpc=${rpc.replace(/\/v2\/.*/, "/v2/***")} poll=${POLL_MS}ms`);

  let publicDecrypt: ((handle: Hex) => Promise<bigint>) | null = null;
  if (MODE === "nox") {
    try {
      const { createViemHandleClient } = await import("@iexec-nox/handle");
      const handleClient = await createViemHandleClient(walletClient as never);
      publicDecrypt = async (handle: Hex) => {
        const { value } = await handleClient.publicDecrypt(handle);
        return value as bigint;
      };
      console.log("[keeper] Nox handle client ready");
    } catch (e) {
      console.warn("[keeper] Nox SDK init failed", (e as Error).message);
    }
  }

  let busy = false;
  let decryptAttempts = 0;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if (MODE === "mock") {
        await tickMock(publicClient, account, chain, registry!);
      } else {
        const r = await tickNox(
          publicClient,
          account,
          chain,
          registry!,
          publicDecrypt,
          decryptAttempts
        );
        decryptAttempts = r.nextAttempts;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[keeper] tick error:", msg.slice(0, 300));
    } finally {
      busy = false;
    }
  }

  await tick();
  setInterval(tick, POLL_MS);
}

async function tickMock(
  publicClient: PublicClient,
  account: PrivateKeyAccount,
  chain: Chain,
  registry: Address
) {
  const epochId = (await publicClient.readContract({
    address: registry,
    abi: mockRegistryAbi,
    functionName: "currentEpochId",
  })) as bigint;

  const ep = (await publicClient.readContract({
    address: registry,
    abi: mockRegistryAbi,
    functionName: "getEpoch",
    args: [epochId],
  })) as { state: number; closeBlock: bigint; participantCount: bigint };

  const block = await publicClient.getBlockNumber();
  if (ep.state === 0 && block >= ep.closeBlock && ep.participantCount > 0n) {
    console.log(`[keeper] closeEpoch ${epochId}`);
    const hash = await sendContractTx({
      publicClient,
      account,
      chain,
      address: registry,
      abi: mockRegistryAbi,
      functionName: "closeEpoch",
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return;
  }
  if (ep.state === 1) {
    console.log(`[keeper] executeEpoch ${epochId}`);
    const hash = await sendContractTx({
      publicClient,
      account,
      chain,
      address: registry,
      abi: mockRegistryAbi,
      functionName: "executeEpoch",
      args: [MIN_OUT],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

async function tickNox(
  publicClient: PublicClient,
  account: PrivateKeyAccount,
  chain: Chain,
  registry: Address,
  publicDecrypt: ((handle: Hex) => Promise<bigint>) | null,
  decryptAttempts: number
): Promise<{ nextAttempts: number }> {
  const epochId = (await publicClient.readContract({
    address: registry,
    abi: noxRegistryAbi,
    functionName: "currentEpochId",
  })) as bigint;

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

  // Open & past close: only close if someone joined (avoid empty-epoch gas spam)
  if (state === 0 && block >= closeBlock) {
    if (participants === 0n) {
      // still advance empty epochs so the book doesn't stuck forever
      console.log(
        `[keeper] epoch ${epochId} empty & past close — closing to rotate`
      );
    } else {
      console.log(
        `[keeper] closeEpoch ${epochId} participants=${participants}`
      );
    }
    try {
      const hash = await sendContractTx({
        publicClient,
        account,
        chain,
        address: registry,
        abi: noxRegistryAbi,
        functionName: "closeEpoch",
      });
      console.log(`[keeper] closeEpoch tx ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        console.error(
          "[keeper] closeEpoch REVERTED — check contract (empty epoch ACL / Nox)"
        );
        // back off so we don't burn gas in a loop
        await new Promise((r) => setTimeout(r, 30_000));
        return { nextAttempts: decryptAttempts };
      }
      console.log(
        participants === 0n
          ? "[keeper] empty epoch rotated"
          : "[keeper] closed — waiting for TEE before publicDecrypt"
      );
      return { nextAttempts: 0 };
    } catch (e) {
      console.error(
        "[keeper] closeEpoch failed:",
        (e as Error).message?.slice(0, 200)
      );
      await new Promise((r) => setTimeout(r, 15_000));
      return { nextAttempts: decryptAttempts };
    }
  }

  if (state === 1) {
    if (!publicDecrypt) {
      console.warn("[keeper] no publicDecrypt client");
      return { nextAttempts: decryptAttempts };
    }
    const zero = ("0x" + "0".repeat(64)) as Hex;
    if (!netHandle || netHandle === zero) {
      console.log("[keeper] net handle empty, wait");
      return { nextAttempts: decryptAttempts };
    }
    try {
      const netSigned = await publicDecrypt(netHandle);
      console.log(`[keeper] publicDecrypt net=${netSigned}`);
      const hash = await sendContractTx({
        publicClient,
        account,
        chain,
        address: registry,
        abi: noxRegistryAbi,
        functionName: "executeEpoch",
        args: [netSigned, MIN_OUT],
      });
      console.log(`[keeper] executeEpoch tx ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`[keeper] epoch ${epochId} residual executed`);
      return { nextAttempts: 0 };
    } catch (e) {
      const next = decryptAttempts + 1;
      console.log(
        `[keeper] publicDecrypt not ready (${next}/${DECRYPT_RETRIES}):`,
        (e as Error).message?.slice(0, 120)
      );
      return { nextAttempts: next >= DECRYPT_RETRIES ? 0 : next };
    }
  }

  // idle log occasionally
  if (state === 0 && Number(block % 20n) === 0) {
    console.log(
      `[keeper] idle epoch=${epochId} state=Open block=${block} close=${closeBlock} people=${participants}`
    );
  }

  return { nextAttempts: 0 };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
