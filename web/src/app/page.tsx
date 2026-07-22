"use client";

import { useMemo, useState } from "react";
import { useAccount, useBlockNumber } from "wagmi";
import {
  useEpoch,
  useSubmitIntent,
  useTokenMeta,
  useBalances,
  useQuote,
  formatAmount,
  parseAmount,
} from "@/hooks/useRegistry";
import { EpochRing } from "@/components/EpochRing";
import { TokenIcon } from "@/components/TokenIcon";
import { DEMO_MODE } from "@/lib/config";
import { useEnsureChain } from "@/hooks/useEnsureChain";
import { friendlyError } from "@/lib/errors";

function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 10V6a1 1 0 0 1 1-1h8M17 14v4a1 1 0 0 1-1 1H8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17 7l-2-2 2-2M7 17l2 2-2 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function SwapPage() {
  const { isConnected } = useAccount();
  const { epoch, epochId, stateLabel, registry, refetch } = useEpoch();
  const { submit, isPending, phase, error } = useSubmitIntent();
  const meta = useTokenMeta();
  const { balance0, balance1, refetch: refetchBal } = useBalances();
  const { data: block } = useBlockNumber({
    watch: false,
    query: {
      refetchInterval: DEMO_MODE ? 8_000 : 20_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  });
  const { wrongNetwork, targetLabel, isSwitching, ensureChain } =
    useEnsureChain();

  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"ok" | "err">("ok");

  const zeroForOne = direction === "buy";
  const decimalsIn = zeroForOne ? meta.decimals0 : meta.decimals1;
  const decimalsOut = zeroForOne ? meta.decimals1 : meta.decimals0;
  const tokenIn = zeroForOne ? meta.symbol0 : meta.symbol1;
  const tokenOut = zeroForOne ? meta.symbol1 : meta.symbol0;
  const balanceIn = zeroForOne ? balance0 : balance1;

  const amountRaw = useMemo(
    () => (amount ? parseAmount(amount, decimalsIn) : 0n),
    [amount, decimalsIn]
  );
  const quoteOut = useQuote(amountRaw, zeroForOne);

  let progress = 0;
  let blocksLeft = 0n;
  if (epoch && block !== undefined) {
    const span = epoch.closeBlock - epoch.openBlock;
    const done = block > epoch.openBlock ? block - epoch.openBlock : 0n;
    progress = span > 0n ? Math.min(100, Number((done * 100n) / span)) : 100;
    blocksLeft = epoch.closeBlock > block ? epoch.closeBlock - block : 0n;
  }

  const minsLeft =
    blocksLeft > 0n ? Math.max(1, Math.ceil(Number(blocksLeft) * 12 / 60)) : 0;

  function flip() {
    setDirection((d) => (d === "buy" ? "sell" : "buy"));
    setAmount("");
  }

  function setPct(pct: number) {
    if (balanceIn <= 0n) return;
    const raw = (balanceIn * BigInt(pct)) / 100n;
    setAmount(formatAmount(raw, decimalsIn, decimalsIn > 8 ? 6 : 4));
  }

  async function onSubmit() {
    setStatus(null);
    try {
      if (wrongNetwork) {
        await ensureChain();
        setStatusKind("ok");
        setStatus(`Switched to ${targetLabel}. Enter amount and seal again.`);
        return;
      }
      if (amountRaw <= 0n) throw new Error("Enter an amount greater than zero");
      if (amountRaw > balanceIn) throw new Error("Insufficient balance");
      const hash = await submit({ direction, amount: amountRaw });
      setStatusKind("ok");
      setStatus("Intent sealed · settles when the batch closes");
      setAmount("");
      refetch();
      refetchBal();
      void hash;
    } catch (e) {
      setStatusKind("err");
      setStatus(friendlyError(e));
    }
  }

  const cta = !registry
    ? "Deploy registry first"
    : !isConnected
      ? "Connect wallet"
      : wrongNetwork
        ? `Switch to ${targetLabel}`
        : phase === "switching" || isSwitching
          ? "Switch network…"
          : phase === "encrypting"
            ? "Encrypting with Nox…"
            : phase === "approving"
              ? "Approve tokens…"
              : phase === "submitting" || isPending
                ? "Confirm in wallet…"
                : !amount
                  ? "Enter amount"
                  : amountRaw > balanceIn
                    ? "Insufficient balance"
                    : "Seal private intent";

  // Allow click when wrong network so CTA can trigger switchChain
  const canSubmit =
    isConnected &&
    !isPending &&
    !!registry &&
    (wrongNetwork || (amountRaw > 0n && amountRaw <= balanceIn));

  return (
    <div>
      {/* How it works — one glance */}
      <ol className="steps">
        <li className="active">
          <span>1</span> Seal
        </li>
        <li>
          <span>2</span> Batch
        </li>
        <li>
          <span>3</span> Settle
        </li>
      </ol>

      <div className="swap-card">
        <div className="swap-header">
          <h2>Private swap</h2>
          <span className="pill">
            <span className="pill-dot" />
            {blocksLeft > 0n
              ? `Batch closes ~${minsLeft}m`
              : stateLabel}
          </span>
        </div>

        <div className="token-panel">
          <div className="token-panel-top">
            <span>You send</span>
            <span className="bal-row">
              {isConnected ? (
                <>
                  Bal {formatAmount(balanceIn, decimalsIn)}{" "}
                  <button type="button" className="link-btn" onClick={() => setPct(100)}>
                    Max
                  </button>
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
          <div className="token-panel-row">
            <input
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              autoComplete="off"
            />
            <div className="token-chip">
              <TokenIcon symbol={tokenIn} />
              {tokenIn}
            </div>
          </div>
          {isConnected && balanceIn > 0n && (
            <div className="pct-row">
              {[25, 50, 75].map((p) => (
                <button key={p} type="button" onClick={() => setPct(p)}>
                  {p}%
                </button>
              ))}
              <button type="button" onClick={() => setPct(100)}>
                Max
              </button>
            </div>
          )}
        </div>

        <div className="swap-flip">
          <button type="button" onClick={flip} aria-label="Switch tokens">
            <FlipIcon />
          </button>
        </div>

        <div className="token-panel is-out">
          <div className="token-panel-top">
            <span>Est. after batch</span>
            <span className="hint">pro-rata of net</span>
          </div>
          <div className="token-panel-row">
            <input
              readOnly
              tabIndex={-1}
              placeholder="0"
              value={
                quoteOut && amountRaw > 0n
                  ? formatAmount(quoteOut, decimalsOut, 6)
                  : ""
              }
            />
            <div className="token-chip">
              <TokenIcon symbol={tokenOut} />
              {tokenOut}
            </div>
          </div>
        </div>

        {amountRaw > 0n && (
          <div className="detail-box">
            <div>
              <span>Route</span>
              <strong>
                {tokenIn} → {tokenOut}
              </strong>
            </div>
            <div>
              <span>Privacy</span>
              <strong>Size hidden until net</strong>
            </div>
            <div>
              <span>Fill</span>
              <strong>1 public swap / epoch</strong>
            </div>
            <div>
              <span>Slippage</span>
              <strong>0.5%</strong>
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {cta}
        </button>

        {(status || error) && (
          <div className={`toast ${statusKind === "err" || error ? "err" : "ok"}`}>
            {status || error?.message}
          </div>
        )}
      </div>

      <div className="epoch-card">
        <EpochRing
          progress={progress}
          label={blocksLeft > 0n ? `${blocksLeft}` : "·"}
        />
        <div className="epoch-body">
          <h3>
            Batch #{epochId?.toString() ?? "—"}{" "}
            <em className="state-tag">{stateLabel}</em>
          </h3>
          <p>
            {blocksLeft > 0n
              ? `${epoch?.participantCount ?? 0} traders sealed · closes in ~${minsLeft} min`
              : `Waiting · ${epoch?.participantCount ?? 0} in last window`}
          </p>
          <div className="epoch-pills">
            <span className="epoch-pill">
              <em>encrypted</em> intents
            </span>
            <span className="epoch-pill">
              <em>net</em> only on-chain
            </span>
          </div>
        </div>
      </div>

      <p className={DEMO_MODE ? "tip quiet" : "tip"}>
        {DEMO_MODE
          ? "Local Hardhat fixtures only — not for submission."
          : "Encrypted intents are matched in the batch. Opposing flow cancels; only residual volume hits Uniswap via NettleHook — for treasury-scale rebalances without full size on the pool."}
      </p>
    </div>
  );
}
