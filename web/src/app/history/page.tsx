"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { intentRegistryAbi, mockRegistryAbi } from "@/lib/abi";
import {
  useAddresses,
  formatAmount,
  useTokenMeta,
} from "@/hooks/useRegistry";
import { DEMO_MODE, TARGET_CHAIN_ID } from "@/lib/config";
import { getEventsNearBlock } from "@/lib/blocks";

type Executed = {
  epochId: string;
  zeroForOne: boolean;
  amountIn: string;
  amountOut: string;
  traders: string;
  buyEscrow: string;
  sellEscrow: string;
  tx: string;
  empty: boolean;
};

/** Parse public `epochs(uint256)` return (array or named object). */
function parseEpoch(raw: unknown): {
  state: number;
  closeBlock: bigint;
  zeroForOne: boolean;
  absAmountIn: bigint;
  amountOut: bigint;
  participantCount: bigint;
  buyEscrow: bigint;
  sellEscrow: bigint;
} | null {
  if (raw == null) return null;
  const arr = raw as readonly unknown[];
  if (!Array.isArray(arr) || arr.length < 9) return null;
  return {
    state: Number(arr[0]),
    closeBlock: arr[2] as bigint,
    zeroForOne: Boolean(arr[5]),
    absAmountIn: arr[6] as bigint,
    amountOut: arr[7] as bigint,
    participantCount: arr[8] as bigint,
    buyEscrow: (arr[9] as bigint | undefined) ?? 0n,
    sellEscrow: (arr[10] as bigint | undefined) ?? 0n,
  };
}

export default function HistoryPage() {
  const { registry } = useAddresses();
  const publicClient = usePublicClient();
  const meta = useTokenMeta();

  const {
    data: rows = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["epoch-history-storage", TARGET_CHAIN_ID, registry, DEMO_MODE],
    enabled: !!registry && !!publicClient,
    staleTime: 20_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
    refetchInterval: 45_000,
    queryFn: async (): Promise<Executed[]> => {
      if (!registry || !publicClient) return [];

      // DEMO: still try event logs (local node is fine)
      if (DEMO_MODE) {
        const logs = await publicClient.getContractEvents({
          address: registry,
          abi: mockRegistryAbi,
          eventName: "EpochExecuted",
          fromBlock: 0n,
          toBlock: "latest",
        });
        return logs
          .map((l) => {
            const a = l.args as {
              epochId?: bigint;
              zeroForOne?: boolean;
              amountIn?: bigint;
              amountOut?: bigint;
            };
            return {
              epochId: a.epochId?.toString() ?? "?",
              zeroForOne: !!a.zeroForOne,
              amountIn: a.amountIn?.toString() ?? "0",
              amountOut: a.amountOut?.toString() ?? "0",
              traders: "—",
              buyEscrow: "0",
              sellEscrow: "0",
              tx: l.transactionHash ?? "",
              empty: (a.amountIn ?? 0n) === 0n,
            };
          })
          .reverse();
      }

      // Production: Alchemy free caps eth_getLogs at 10 blocks.
      // History must come from storage reads of epochs(i) — eth_call is unlimited.
      const currentId = (await publicClient.readContract({
        address: registry,
        abi: intentRegistryAbi,
        functionName: "currentEpochId",
      })) as bigint;

      const maxLookback = 40n;
      const start =
        currentId > maxLookback ? currentId - maxLookback + 1n : 1n;
      const rows: Executed[] = [];

      for (let id = currentId; id >= start; id--) {
        const raw = await publicClient.readContract({
          address: registry,
          abi: intentRegistryAbi,
          functionName: "epochs",
          args: [id],
        });
        const ep = parseEpoch(raw);
        if (!ep) continue;
        // Closed (1) or Executed (2) — show settled residual
        if (ep.state < 1) continue;
        // Skip pure empty rotates that never had traders (noise)
        if (ep.participantCount === 0n && ep.absAmountIn === 0n) continue;

        let tx = "";
        // Best-effort tx hash: tiny log window around close (Alchemy 10-block OK)
        if (ep.closeBlock > 0n) {
          try {
            const near = await getEventsNearBlock({
              publicClient,
              address: registry,
              abi: intentRegistryAbi,
              eventName: "EpochExecuted",
              aroundBlock: ep.closeBlock,
              radius: 5n,
            });
            const match = near.find((l) => {
              const eid = l.args?.epochId as bigint | undefined;
              return eid === id;
            });
            if (match?.transactionHash) tx = match.transactionHash;
          } catch {
            /* ignore — row still useful without tx */
          }
        }

        rows.push({
          epochId: id.toString(),
          zeroForOne: ep.zeroForOne,
          amountIn: ep.absAmountIn.toString(),
          amountOut: ep.amountOut.toString(),
          traders: ep.participantCount.toString(),
          buyEscrow: ep.buyEscrow.toString(),
          sellEscrow: ep.sellEscrow.toString(),
          tx,
          empty: ep.absAmountIn === 0n,
        });
      }

      return rows;
    },
  });

  const explorer =
    !DEMO_MODE && TARGET_CHAIN_ID === 11155111
      ? "https://sepolia.etherscan.io/tx/"
      : null;
  const contractExplorer =
    !DEMO_MODE && TARGET_CHAIN_ID === 11155111 && registry
      ? `https://sepolia.etherscan.io/address/${registry}`
      : null;

  const errMsg =
    isError && error instanceof Error
      ? error.message.includes("429") || error.message.includes("Too Many")
        ? "RPC rate-limited — wait a moment, then Refresh."
        : error.message.slice(0, 160)
      : null;

  return (
    <div>
      <div className="page-head">
        <h1>History</h1>
        <p>
          Public residual swaps only — opposing flow cancels in the batch; only
          |net| hits Uniswap.
        </p>
      </div>

      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 10,
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? "Loading…" : "Refresh"}
          </button>
        </div>

        {isLoading && rows.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            Loading history…
          </p>
        )}
        {errMsg && (
          <div className="toast err" style={{ marginBottom: 12 }}>
            {errMsg}
          </div>
        )}
        {!isLoading && rows.length === 0 && !errMsg ? (
          <div className="empty">
            <span className="emoji">🪴</span>
            <p>No settled batches yet. Keeper executes after epoch close.</p>
          </div>
        ) : rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Epoch</th>
                <th>Traders</th>
                <th>Route</th>
                <th>Residual in</th>
                <th>Out</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.epochId + r.tx}>
                  <td style={{ fontWeight: 700 }}>#{r.epochId}</td>
                  <td className="mono">{r.traders}</td>
                  <td>
                    {r.empty
                      ? "matched / empty residual"
                      : r.zeroForOne
                        ? `${meta.symbol0} → ${meta.symbol1}`
                        : `${meta.symbol1} → ${meta.symbol0}`}
                  </td>
                  <td className="mono">
                    {r.empty
                      ? "0"
                      : formatAmount(
                          BigInt(r.amountIn),
                          r.zeroForOne ? meta.decimals0 : meta.decimals1
                        )}
                  </td>
                  <td className="mono">
                    {r.empty
                      ? "—"
                      : formatAmount(
                          BigInt(r.amountOut),
                          r.zeroForOne ? meta.decimals1 : meta.decimals0
                        )}
                  </td>
                  <td className="mono">
                    {explorer && r.tx ? (
                      <a
                        href={`${explorer}${r.tx}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--fox-deep)", fontWeight: 700 }}
                      >
                        {r.tx.slice(0, 10)}…
                      </a>
                    ) : contractExplorer ? (
                      <a
                        href={contractExplorer}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--fox-deep)", fontWeight: 700 }}
                      >
                        registry
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
