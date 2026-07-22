"use client";

import { useState } from "react";
import {
  ArrowsLeftRight,
  ArrowRight,
  ArrowSquareOut,
  Check,
  Coins,
  Copy,
  LockKey,
  LockOpen,
  PlayCircle,
} from "@phosphor-icons/react";
import { getPipelineStageStates } from "@/lib/epoch-pipeline";

type EpochPipelineProps = {
  state: number;
  participants: bigint;
  netHandle: string;
  residual: string;
  execTx: string;
  explorer: string | null;
};

const ZERO_HANDLE = "0x" + "0".repeat(64);

export function EpochPipeline({
  state,
  participants,
  netHandle,
  residual,
  execTx,
  explorer,
}: EpochPipelineProps) {
  const [copied, setCopied] = useState(false);
  const states = getPipelineStageStates(state);
  const hasHandle = netHandle && netHandle !== ZERO_HANDLE;
  const stages = [
    { title: "Seal", detail: `${participants.toString()} encrypted intent${participants === 1n ? "" : "s"}`, icon: LockKey },
    { title: "Net", detail: hasHandle ? `${netHandle.slice(0, 10)}…${netHandle.slice(-6)}` : "Awaiting close", icon: ArrowsLeftRight },
    { title: "Close", detail: residual, icon: LockOpen },
    { title: "Execute", detail: "Registry → Hook → Uniswap", icon: PlayCircle },
    { title: "Settle", detail: "Refund unused escrow", icon: Coins },
  ];

  async function copyTransaction() {
    if (!execTx || !navigator.clipboard) return;
    await navigator.clipboard.writeText(execTx);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="epoch-pipeline" aria-label="Epoch settlement pipeline">
      <ol className="epoch-pipeline-stages">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <li className={`pipeline-stage ${states[index]}`} key={stage.title}>
              <div className="pipeline-stage-card">
                <span className="pipeline-stage-number">{index + 1}</span>
                <Icon aria-hidden="true" size={24} weight="duotone" />
                <div>
                  <strong>{stage.title}</strong>
                  <span className={stage.title === "Net" && hasHandle ? "mono pipeline-hash" : "pipeline-detail"}>{stage.detail}</span>
                </div>
              </div>
              {index < stages.length - 1 && <ArrowRight className="pipeline-arrow" aria-hidden="true" size={20} weight="bold" />}
            </li>
          );
        })}
      </ol>
      {execTx && explorer && (
        <div className="pipeline-transaction">
          <span>Execution confirmed</span>
          <a href={`${explorer}/tx/${execTx}`} target="_blank" rel="noreferrer" className="mono">
            {execTx.slice(0, 10)}…{execTx.slice(-6)} <ArrowSquareOut aria-hidden="true" size={15} weight="bold" />
          </a>
          <button type="button" onClick={() => void copyTransaction()} aria-label="Copy execution transaction hash">
            {copied ? <Check aria-hidden="true" size={16} weight="bold" /> : <Copy aria-hidden="true" size={16} weight="bold" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </section>
  );
}
