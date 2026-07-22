"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { intentRegistryAbi } from "@/lib/abi";
import {
  useAddresses,
  formatAmount,
  useTokenMeta,
  useEpoch,
} from "@/hooks/useRegistry";
import { DEMO_MODE, EPOCH_STATE, TARGET_CHAIN_ID } from "@/lib/config";
import { getEventsNearBlock } from "@/lib/blocks";

const STATE = ["Open", "Closed", "Executed"] as const;

type Book = {
  state: number;
  openBlock: bigint;
  closeBlock: bigint;
  netHandle: `0x${string}`;
  zeroForOne: boolean;
  residualIn: bigint;
  residualOut: bigint;
  participantCount: bigint;
  buyEscrow: bigint;
  sellEscrow: bigint;
  matchedHint: bigint;
};

type IntentView = {
  id: string;
  trader: string;
  tokenIn: string;
  escrowed: bigint;
  settled: boolean;
  handle: string;
};

export default function InspectPage() {
  const { registry } = useAddresses();
  const { epochId: liveEpoch } = useEpoch();
  const publicClient = usePublicClient();
  const meta = useTokenMeta();
  const [selected, setSelected] = useState<string>("");

  const epochId = useMemo(() => {
    if (selected && /^\d+$/.test(selected)) return BigInt(selected);
    return liveEpoch;
  }, [selected, liveEpoch]);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: [
      "epoch-inspector",
      TARGET_CHAIN_ID,
      registry,
      epochId?.toString(),
    ],
    enabled: !!registry && !!publicClient && epochId !== undefined && !DEMO_MODE,
    staleTime: 12_000,
    refetchOnWindowFocus: false,
    retry: 0,
    queryFn: async () => {
      if (!registry || !publicClient || epochId === undefined) return null;

      const bookRaw = (await publicClient.readContract({
        address: registry,
        abi: intentRegistryAbi,
        functionName: "getEpochBook",
        args: [epochId],
      })) as Book;

      const ids = (await publicClient.readContract({
        address: registry,
        abi: intentRegistryAbi,
        functionName: "getEpochIntentIds",
        args: [epochId],
      })) as readonly bigint[];

      const intents: IntentView[] = [];
      for (const id of ids) {
        const raw = (await publicClient.readContract({
          address: registry,
          abi: intentRegistryAbi,
          functionName: "intents",
          args: [epochId, id],
        })) as readonly unknown[];
        const arr = raw as readonly unknown[];
        intents.push({
          id: id.toString(),
          trader: String(arr[0]),
          handle: String(arr[1]),
          tokenIn: String(arr[2]),
          escrowed: arr[3] as bigint,
          settled: Boolean(arr[4]),
        });
      }

      let execTx = "";
      if (bookRaw.state >= 2 && bookRaw.closeBlock > 0n) {
        try {
          const near = await getEventsNearBlock({
            publicClient,
            address: registry,
            abi: intentRegistryAbi as never,
            eventName: "EpochExecuted",
            aroundBlock: bookRaw.closeBlock,
            radius: 6n,
          });
          const match = near.find((l) => l.args?.epochId === epochId);
          if (match?.transactionHash) execTx = match.transactionHash;
        } catch {
          /* optional */
        }
      }

      return { book: bookRaw, intents, execTx };
    },
  });

  const book = data?.book;
  const explorer =
    TARGET_CHAIN_ID === 11155111
      ? "https://sepolia.etherscan.io"
      : null;

  return (
    <div>
      <div className="page-head">
        <h1>Epoch Inspector</h1>
        <p>
          Observability for judges: participants → encrypted net → residual →
          settlement. Storage reads only (Alchemy-safe).
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <label className="muted" style={{ fontSize: "0.85rem" }}>
            Epoch
          </label>
          <input
            className="mono"
            style={{
              width: 100,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--panel)",
            }}
            placeholder={liveEpoch?.toString() ?? "1"}
            value={selected}
            onChange={(e) => setSelected(e.target.value.replace(/\D/g, ""))}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setSelected(liveEpoch?.toString() ?? "")}
          >
            Live
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {DEMO_MODE && (
        <div className="toast err">Inspector is for Sepolia (DEMO_MODE off).</div>
      )}
      {error && (
        <div className="toast err">
          {(error as Error).message.slice(0, 160)}
        </div>
      )}
      {isLoading && <p className="muted">Loading book…</p>}

      {book && epochId !== undefined && (
        <>
          <div className="epoch-card" style={{ marginTop: 0 }}>
            <div className="epoch-body" style={{ width: "100%" }}>
              <h3>
                Epoch #{epochId.toString()}{" "}
                <em className="state-tag">
                  {STATE[book.state] ?? EPOCH_STATE[book.state] ?? "?"}
                </em>
              </h3>
              <p className="muted" style={{ marginBottom: 0 }}>
                blocks {book.openBlock.toString()} → {book.closeBlock.toString()}
              </p>
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 12 }}>
            <div className="stat-card">
              <span>Participants</span>
              <strong>{book.participantCount.toString()}</strong>
            </div>
            <div className="stat-card">
              <span>Matched hint (min buy/sell escrow)</span>
              <strong className="mono" style={{ fontSize: "1rem" }}>
                {formatAmount(book.matchedHint, meta.decimals0)}*
              </strong>
            </div>
            <div className="stat-card">
              <span>Buy escrow ({meta.symbol0})</span>
              <strong className="mono" style={{ fontSize: "1rem" }}>
                {formatAmount(book.buyEscrow, meta.decimals0)}
              </strong>
            </div>
            <div className="stat-card">
              <span>Sell escrow ({meta.symbol1})</span>
              <strong className="mono" style={{ fontSize: "1rem" }}>
                {formatAmount(book.sellEscrow, meta.decimals1)}
              </strong>
            </div>
          </div>

          <div className="card">
            <p className="card-title">Pipeline</p>
            <ol className="steps" style={{ margin: 0 }}>
              <li>
                <span>1</span> Encrypted intents sealed (
                {book.participantCount.toString()} handles)
              </li>
              <li>
                <span>2</span> Net handle{" "}
                <code className="mono" style={{ fontSize: "0.75rem" }}>
                  {book.netHandle &&
                  book.netHandle !==
                    "0x0000000000000000000000000000000000000000000000000000000000000000"
                    ? `${book.netHandle.slice(0, 18)}…`
                    : "— (open or empty)"}
                </code>
              </li>
              <li>
                <span>3</span> Residual{" "}
                {book.state >= 2
                  ? book.residualIn === 0n
                    ? "0 (full internal cancel)"
                    : `${formatAmount(
                        book.residualIn,
                        book.zeroForOne ? meta.decimals0 : meta.decimals1
                      )} ${
                        book.zeroForOne ? meta.symbol0 : meta.symbol1
                      } → ${formatAmount(
                        book.residualOut,
                        book.zeroForOne ? meta.decimals1 : meta.decimals0
                      )} ${book.zeroForOne ? meta.symbol1 : meta.symbol0}`
                  : "pending close / execute"}
              </li>
              <li>
                <span>4</span> Path Registry → Hook → UniswapV3Executor →
                SwapRouter02
              </li>
              <li>
                <span>5</span> Settlement: residual-side pro-rata out + unused
                escrow refund; opposite side full refund
              </li>
            </ol>
            {data?.execTx && explorer && (
              <p style={{ marginTop: 12, marginBottom: 0 }}>
                Execute tx:{" "}
                <a
                  href={`${explorer}/tx/${data.execTx}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--fox-deep)", fontWeight: 700 }}
                >
                  {data.execTx.slice(0, 14)}…
                </a>
              </p>
            )}
          </div>

          <div className="card">
            <p className="card-title">
              Intents ({data?.intents.length ?? 0}) — sizes are escrow (public);
              signed size is Nox-encrypted
            </p>
            {!data?.intents.length ? (
              <div className="empty">
                <span className="emoji">📭</span>
                <p>No intents in this epoch.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Trader</th>
                    <th>Token in</th>
                    <th>Escrow</th>
                    <th>Settled</th>
                    <th>Handle</th>
                  </tr>
                </thead>
                <tbody>
                  {data.intents.map((it) => {
                    const isUsdc =
                      it.tokenIn.toLowerCase() ===
                      "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
                    const dec = isUsdc ? meta.decimals0 : meta.decimals1;
                    const sym = isUsdc ? meta.symbol0 : meta.symbol1;
                    return (
                      <tr key={it.id}>
                        <td className="mono">#{it.id}</td>
                        <td className="mono">
                          {explorer ? (
                            <a
                              href={`${explorer}/address/${it.trader}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {it.trader.slice(0, 6)}…{it.trader.slice(-4)}
                            </a>
                          ) : (
                            `${it.trader.slice(0, 6)}…`
                          )}
                        </td>
                        <td>{sym}</td>
                        <td className="mono">
                          {formatAmount(it.escrowed, dec)}
                        </td>
                        <td>
                          <span className={`badge ${it.settled ? "ok" : "wait"}`}>
                            {it.settled ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="mono" style={{ fontSize: "0.7rem" }}>
                          {it.handle.slice(0, 12)}…
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ fontSize: "0.75rem", marginTop: 10 }}>
              * matchedHint = min(buyEscrow, sellEscrow) in raw units — not a
              clearing price. True match size lives in the encrypted net
              (`Nox.add`).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
