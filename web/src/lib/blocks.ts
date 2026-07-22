import type { Abi, Address, PublicClient } from "viem";

/**
 * Alchemy free tier: eth_getLogs max **10 blocks** per request.
 * Public nodes often cap at 1k–2k. Never chunk-spam — hard caps below.
 */

/** Free Alchemy limit */
const ALCHEMY_MAX = 10n;
/** Total blocks we'll scan with chunked logs (at most 30 RPC calls) */
const MAX_SCAN = 300n;
const MAX_CHUNKS = 30;

export function configuredDeployBlock(): bigint {
  const raw = process.env.NEXT_PUBLIC_DEPLOY_BLOCK;
  if (raw && /^\d+$/.test(raw)) return BigInt(raw);
  return 11_310_000n;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type LogRow = {
  args: Record<string, unknown>;
  transactionHash?: `0x${string}` | null;
  blockNumber?: bigint | null;
};

/**
 * Chunked getLogs safe for Alchemy free (10-block windows).
 * Scans at most MAX_SCAN blocks ending at `latest` (or toBlock).
 */
export async function getContractEventsSafe(params: {
  publicClient: PublicClient;
  address: Address;
  abi: Abi;
  eventName: string;
  fromBlock?: bigint;
  toBlock?: bigint;
}): Promise<LogRow[]> {
  const { publicClient, address, abi, eventName } = params;

  let latest: bigint;
  try {
    latest = params.toBlock ?? (await publicClient.getBlockNumber());
  } catch {
    return [];
  }

  const deploy = configuredDeployBlock();
  const floor =
    params.fromBlock ?? (latest > MAX_SCAN ? latest - MAX_SCAN : 0n);
  let from = floor > deploy ? floor : deploy;
  if (from > latest) return [];

  const out: LogRow[] = [];
  let chunks = 0;

  while (from <= latest && chunks < MAX_CHUNKS) {
    const to =
      from + ALCHEMY_MAX - 1n > latest ? latest : from + ALCHEMY_MAX - 1n;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const part = (await publicClient.getContractEvents({
        address,
        abi,
        eventName: eventName as never,
        fromBlock: from,
        toBlock: to,
      })) as readonly {
        args?: Record<string, unknown>;
        transactionHash?: `0x${string}` | null;
        blockNumber?: bigint | null;
      }[];
      for (const l of part) {
        out.push({
          args: (l.args ?? {}) as Record<string, unknown>,
          transactionHash: l.transactionHash,
          blockNumber: l.blockNumber,
        });
      }
    } catch {
      // skip this window — don't abort whole history
    }
    from = to + 1n;
    chunks += 1;
    if (chunks % 5 === 0) await sleep(80);
  }

  return out;
}

/**
 * Look up a single event near a known block (e.g. epoch close).
 * One or two 10-block requests — cheap on Alchemy free.
 */
export async function getEventsNearBlock(params: {
  publicClient: PublicClient;
  address: Address;
  abi: Abi;
  eventName: string;
  aroundBlock: bigint;
  radius?: bigint;
}): Promise<LogRow[]> {
  const radius = params.radius ?? 8n;
  const from =
    params.aroundBlock > radius ? params.aroundBlock - radius : 0n;
  const to = params.aroundBlock + radius;
  return getContractEventsSafe({
    publicClient: params.publicClient,
    address: params.address,
    abi: params.abi,
    eventName: params.eventName,
    fromBlock: from,
    toBlock: to,
  });
}

/** @deprecated use getContractEventsSafe */
export const getContractEventsChunked = getContractEventsSafe;
