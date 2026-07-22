"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useBlockNumber,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import {
  useEpoch,
  useMyIntents,
  useIntent,
  useTokenMeta,
  useAddresses,
  formatAmount,
} from "@/hooks/useRegistry";
import { EpochRing } from "@/components/EpochRing";
import { DEMO_MODE, TARGET_CHAIN_ID } from "@/lib/config";
import { decryptOwnHandle } from "@/lib/nox";
import { intentRegistryAbi } from "@/lib/abi";

function IntentRow({
  epochId,
  intentId,
  decimals0,
  decimals1,
  symbol0,
  symbol1,
  token0,
  showEpoch,
}: {
  epochId: bigint;
  intentId: bigint;
  decimals0: number;
  decimals1: number;
  symbol0: string;
  symbol1: string;
  token0?: `0x${string}`;
  showEpoch?: boolean;
}) {
  const data = useIntent(epochId, intentId);
  const { data: walletClient } = useWalletClient();
  const [decrypted, setDecrypted] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!data) return null;

  const buy =
    data.signedAmount !== undefined
      ? data.signedAmount > 0n
      : token0
        ? data.tokenIn.toLowerCase() === token0.toLowerCase()
        : true;

  async function onDecrypt() {
    if (!walletClient || !data) return;
    setBusy(true);
    setErr(null);
    try {
      const v = await decryptOwnHandle(walletClient, data.handle);
      setDecrypted(v);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const amountLabel = (() => {
    if (data.signedAmount !== undefined) {
      const a =
        data.signedAmount < 0n ? -data.signedAmount : data.signedAmount;
      const dec = data.signedAmount > 0n ? decimals0 : decimals1;
      const sym = data.signedAmount > 0n ? symbol0 : symbol1;
      return `${formatAmount(a, dec)} ${sym}`;
    }
    if (decrypted !== null) {
      const a = decrypted < 0n ? -decrypted : decrypted;
      const isBuy = decrypted > 0n;
      return `${formatAmount(a, isBuy ? decimals0 : decimals1)} ${isBuy ? symbol0 : symbol1} (ACL decrypt)`;
    }
    // escrow is always in tokenIn units
    const dec =
      token0 && data.tokenIn.toLowerCase() === token0.toLowerCase()
        ? decimals0
        : decimals1;
    const sym =
      token0 && data.tokenIn.toLowerCase() === token0.toLowerCase()
        ? symbol0
        : symbol1;
    return `${formatAmount(data.escrowed, dec)} ${sym}`;
  })();

  return (
    <tr>
      {showEpoch && (
        <td className="mono" style={{ fontWeight: 700 }}>
          #{epochId.toString()}
        </td>
      )}
      <td className="mono">#{intentId.toString()}</td>
      <td style={{ fontWeight: 600 }}>
        {data.signedAmount !== undefined
          ? buy
            ? `${symbol0} → ${symbol1}`
            : `${symbol1} → ${symbol0}`
          : token0
            ? data.tokenIn.toLowerCase() === token0.toLowerCase()
              ? `${symbol0} → ${symbol1}`
              : `${symbol1} → ${symbol0}`
            : "Encrypted"}
      </td>
      <td className="mono">{amountLabel}</td>
      <td>
        <span className={`badge ${data.settled ? "ok" : "wait"}`}>
          {data.settled ? "Settled" : "Pending"}
        </span>
      </td>
      <td>
        {!DEMO_MODE && decrypted === null && (
          <button
            type="button"
            className="link-btn"
            disabled={busy}
            onClick={onDecrypt}
          >
            {busy ? "…" : "Decrypt mine"}
          </button>
        )}
        {err && (
          <span className="muted" style={{ fontSize: "0.7rem" }}>
            {err}
          </span>
        )}
      </td>
    </tr>
  );
}

type PastSeal = { epochId: bigint; intentId: bigint };

export default function BatchPage() {
  const { isConnected, address } = useAccount();
  const { epoch, epochId, stateLabel } = useEpoch();
  const { intentIds } = useMyIntents(epochId);
  const meta = useTokenMeta();
  const { token0, registry } = useAddresses();
  const publicClient = usePublicClient();
  const { data: block } = useBlockNumber({
    watch: false,
    query: {
      refetchInterval: DEMO_MODE ? 8_000 : 20_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  });

  // Past epochs: storage reads only (no eth_getLogs) so Alchemy free works
  const { data: pastSeals = [], isFetching: pastLoading } = useQuery({
    queryKey: [
      "past-trader-intents",
      TARGET_CHAIN_ID,
      registry,
      address,
      epochId?.toString(),
    ],
    enabled: !!registry && !!address && !!publicClient && epochId !== undefined,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 0,
    refetchInterval: 45_000,
    queryFn: async (): Promise<PastSeal[]> => {
      if (!registry || !address || !publicClient || epochId === undefined) {
        return [];
      }
      const out: PastSeal[] = [];
      // Look back up to 15 epochs (cheap eth_calls)
      const lookback = 15n;
      const start = epochId > lookback ? epochId - lookback : 1n;
      for (let e = epochId - 1n; e >= start; e--) {
        if (e < 1n) break;
        const ids = (await publicClient.readContract({
          address: registry,
          abi: intentRegistryAbi,
          functionName: "getTraderIntentIds",
          args: [address, e],
        })) as readonly bigint[];
        for (const id of ids) {
          out.push({ epochId: e, intentId: id });
        }
      }
      return out;
    },
  });

  let progress = 0;
  let blocksLeft = 0n;
  if (epoch && block !== undefined) {
    const span = epoch.closeBlock - epoch.openBlock;
    const done = block > epoch.openBlock ? block - epoch.openBlock : 0n;
    progress = span > 0n ? Math.min(100, Number((done * 100n) / span)) : 100;
    blocksLeft = epoch.closeBlock > block ? epoch.closeBlock - block : 0n;
  }

  const residualHint = useMemo(() => {
    if (!epoch || epoch.state < 2) return null;
    if (epoch.absAmountIn === 0n) return "Fully matched — no residual AMM swap.";
    const route = epoch.zeroForOne
      ? `${meta.symbol0} → ${meta.symbol1}`
      : `${meta.symbol1} → ${meta.symbol0}`;
    return `Residual ${formatAmount(
      epoch.absAmountIn,
      epoch.zeroForOne ? meta.decimals0 : meta.decimals1
    )} ${route}`;
  }, [epoch, meta]);

  return (
    <div>
      <div className="page-head">
        <h1>Your batch</h1>
        <p>
          Others never see your size. Decrypt only works for handles your wallet
          is allowed to view (Nox ACL).
        </p>
      </div>

      <div className="epoch-card" style={{ marginTop: 0, marginBottom: 14 }}>
        <EpochRing
          progress={progress}
          label={blocksLeft > 0n ? `${blocksLeft}` : "·"}
        />
        <div className="epoch-body">
          <h3>
            Epoch #{epochId?.toString() ?? "—"}{" "}
            <em className="state-tag">{stateLabel}</em>
          </h3>
          <p>
            {blocksLeft > 0n
              ? `${epoch?.participantCount ?? 0} sealed · ${blocksLeft} blocks left`
              : `${epoch?.participantCount ?? 0} participants`}
          </p>
          <div className="epoch-pills">
            <span className="epoch-pill">
              <em>mode</em> {DEMO_MODE ? "local" : "Nox TEE"}
            </span>
            {epoch && epoch.state >= 1 && epoch.netHandle && (
              <span className="epoch-pill">
                <em>net</em> public
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="stat-card">
          <span>Traders (this epoch)</span>
          <strong>{epoch?.participantCount?.toString() ?? "0"}</strong>
        </div>
        <div className="stat-card">
          <span>Your seals (this epoch)</span>
          <strong>{intentIds.length}</strong>
        </div>
      </div>

      <div className="card">
        <p className="card-title">This epoch</p>
        {!isConnected && (
          <div className="empty">
            <span className="emoji">🦊</span>
            <p>Connect to see sealed intents.</p>
          </div>
        )}
        {isConnected && intentIds.length === 0 && (
          <div className="empty">
            <span className="emoji">📦</span>
            <p>
              Nothing sealed in epoch #{epochId?.toString() ?? "—"} yet.
              {pastSeals.length > 0
                ? " Your earlier seals are listed below."
                : " Seal on the Swap tab."}
            </p>
          </div>
        )}
        {intentIds.length > 0 && epochId !== undefined && (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Route</th>
                <th>Size</th>
                <th>Status</th>
                <th>ACL</th>
              </tr>
            </thead>
            <tbody>
              {intentIds.map((id) => (
                <IntentRow
                  key={`c-${id.toString()}`}
                  epochId={epochId}
                  intentId={id}
                  decimals0={meta.decimals0}
                  decimals1={meta.decimals1}
                  symbol0={meta.symbol0}
                  symbol1={meta.symbol1}
                  token0={token0}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isConnected && (pastSeals.length > 0 || pastLoading) && (
        <div className="card">
          <p className="card-title">
            Past epochs {pastLoading ? "…" : `(${pastSeals.length})`}
          </p>
          {pastSeals.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Loading past seals…
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Epoch</th>
                  <th>ID</th>
                  <th>Route</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>ACL</th>
                </tr>
              </thead>
              <tbody>
                {pastSeals.map((s) => (
                  <IntentRow
                    key={`p-${s.epochId}-${s.intentId}`}
                    epochId={s.epochId}
                    intentId={s.intentId}
                    decimals0={meta.decimals0}
                    decimals1={meta.decimals1}
                    symbol0={meta.symbol0}
                    symbol1={meta.symbol1}
                    token0={token0}
                    showEpoch
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {epoch && epoch.state >= 1 && epoch.netHandle && (
        <div className="card">
          <p className="card-title">
            Public net handle (only this is decryptable by all)
          </p>
          <p className="mono" style={{ margin: 0, wordBreak: "break-all" }}>
            {epoch.netHandle}
          </p>
          {residualHint && (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              {residualHint}
            </p>
          )}
        </div>
      )}

      {isConnected && pastSeals.length === 0 && intentIds.length === 0 && (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Tip: after a batch settles, open{" "}
          <strong>History</strong> for the public residual swap. Your private
          seals stay on this page under Past epochs.
        </p>
      )}
    </div>
  );
}
