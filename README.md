# Nettle

**Confidential batch netting for Uniswap — powered by iExec Nox.**

Traders seal Nox-encrypted signed swap intents. Each epoch the book nets them with
`Nox.add` inside Intel TDX TEEs. **Opposing signed notional cancels in the encrypted
book.** Only residual `|net|` is validated by **NettleHook** and executed on Uniswap.
Individual size never hits the AMM curve.

Built for **DAO treasuries and OTC desks**: rebalance without full size leaking to
MEV, without forking Uniswap or changing wallets.

---

## Why not “private swaps”?

```text
AMMs require plaintext settlement
        │
        ▼
You cannot hide full size ON Uniswap
        │
        ▼
Therefore Nettle:
  privately nets intents (Nox TEE)
  publicly settles only residual
```

Matched flow is cancelled for the pool — not magically hidden *on* the pool.
That is the WTF brief: **privacy as a layer**, without modifying Uniswap.

---

## What Nettle does **not** hide

| Visible | Why |
| --- | --- |
| Residual AMM swap | Curve needs plaintext `amountIn` / `amountOut` |
| Escrow token + size | Standard ERC-20 transfer (ERC-7984 = phase 2) |
| Participant count / epoch | Bookkeeping events |
| Final residual direction | After publicDecrypt + execute |

## What Nettle **does** hide

| Hidden | How |
| --- | --- |
| Individual signed size | Nox `eint256` handle + ACL |
| Composition of the book | Only **net** is public-decryptable |
| Full AMM footprint of each leg | Cancelled notional never hits the pool |

---

## What “matching” means here

| Claim | Reality in this repo |
| --- | --- |
| Running encrypted net | `ep.netEncrypted = Nox.add(net, amount)` |
| Residual only to AMM | `executeEpoch` → Hook → UniswapV3Executor |
| Full CLOB / clearing price | **No** |
| P2P fill Alice↔Bob | **No** — opposite escrow refunded |
| Residual-side settlement | Pro-rata AMM out **+ unused escrow refund** |

Judge prompt *“show me matching”* → `IntentRegistry.submitIntent` (`Nox.add`) + `_settleMatching`.

---

## System architecture

```text
┌──────────┐  encrypt + escrow   ┌─────────────────┐
│ Traders  │ ──────────────────► │ IntentRegistry  │
└──────────┘                     │  Nox.add (TEE)  │
                                 └────────┬────────┘
                                          │ close + publicDecrypt(net)
                                          ▼
                                 ┌─────────────────┐
                                 │     Keeper      │
                                 └────────┬────────┘
                                          │ residual |net|
                                          ▼
                                 ┌─────────────────┐
                                 │   NettleHook    │  batch gate + v4 IHooks
                                 │  (CREATE2 flags)│  beforeSwap / afterSwap
                                 └────────┬────────┘
                                          ▼
                                 ┌─────────────────┐
                                 │ UniswapV4Exec.  │  OnlyHook
                                 └────────┬────────┘
                                          ▼
                                 ┌─────────────────┐
                                 │  PoolManager    │  singleton v4 liquidity
                                 │  .swap residual │
                                 └────────┬────────┘
                                          ▼
                                     Settlement
```

## Epoch lifecycle

```text
OPEN ──submit──► OPEN ──closeEpoch──► CLOSED ──executeEpoch──► EXECUTED
  ▲                  │ empty book                              │
  │                  └──► EXECUTED (no swap) ──────────────────┘
  └──────────────────────── _openEpoch (id++) ─────────────────┘
```

## Threat model (MVP)

| Threat | Mitigation |
| --- | --- |
| Sandwich of full size | Only residual reaches AMM |
| Intent size leakage | Encrypted `eint256` handles |
| Keeper replay / double exec | `Executed` state + `onlyKeeper` + `nonReentrant` |
| Hook bypass | Registry → Hook only; Executor `OnlyHook` |
| Failed decryption | Keeper retry (MVP — no admin recovery) |
| Malicious keeper | **Explicitly trusted** for MVP |

Full design: [docs/architecture.md](docs/architecture.md) · Demo runbook: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)

---

## Why this fits the WTF brief

| Typical submission | Nettle |
| --- | --- |
| Encrypt one trade, swap same size | Net opposing intents; residual only |
| Hook as a stub | Registry → **Hook** → Executor (required) |
| Nox as a sticker | `Nox.add` + selective public decrypt is load-bearing |

Residual path is **Uniswap v4 `PoolManager.swap`** (not SwapRouter02).  
NettleHook is CREATE2-mined with `BEFORE_SWAP | AFTER_SWAP` flags and is the
`PoolKey.hooks` address — so residual execution hits **real v4 hook callbacks**.

---

## Safety (MVP)

- `executeEpoch`: `onlyKeeper` + `nonReentrant` + `Closed → Executed`
- Hook: non-registry / zero residual rejected; approvals reset
- Executor: `OnlyHook`, `minAmountOut`, SafeERC20, approval reset
- Multi-keeper / governance / multi-pool: **out of scope** (demo reliability)

---

## Sepolia deployments (latest — v4 residual)

| Contract | Address |
| --- | --- |
| **IntentRegistry** | [`0xd5d950a0b211afe67ad4e5a8f28804b42bc2b71f`](https://sepolia.etherscan.io/address/0xd5d950a0b211afe67ad4e5a8f28804b42bc2b71f) |
| **NettleHook** (CREATE2 + flags) | [`0xd20f5fD8094A000e37e5540dfE34444cd30780c0`](https://sepolia.etherscan.io/address/0xd20f5fD8094A000e37e5540dfE34444cd30780c0) |
| **UniswapV4Executor** | [`0xfd84a8e2996875e5e34171e467c4f2b8221c4793`](https://sepolia.etherscan.io/address/0xfd84a8e2996875e5e34171e467c4f2b8221c4793) |
| PoolManager (v4) | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| USDC / WETH | Circle / canonical Sepolia |
| NoxCompute | `0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF` |

Source of truth: **`deployments/sepolia.json`**.

Path: **Registry → NettleHook → UniswapV4Executor → PoolManager.swap**

UI: **Swap** · **Batch** · **History** · **Inspect**

---

## Demo narrative (institutional)

```text
Treasury A    +120k USDC  (encrypted)
Market maker  −100k       (encrypted opposing)
────────────────────────
Residual       20k → Uniswap **once**
Matched       100k never hits the pool
```

Record with [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) (≤ 4 min).

---

## Quick start (Sepolia)

```bash
pnpm install
cp .env.example .env   # PRIVATE_KEY, Alchemy RPC_URL

cd contracts && pnpm compile && pnpm deploy:sepolia
# paste addresses → web/.env.local (DEMO_MODE=false) and root .env

cd ../web && pnpm dev
cd ../keeper && set -a && source ../.env && set +a && pnpm dev
```

## Local Hardhat (tests / mocks only)

```bash
cd contracts && pnpm exec hardhat node   # terminal 1
pnpm deploy:local && pnpm test           # mocks — not submission path
```

## Repository layout

```text
nettle/
  contracts/     production + test/mocks
  keeper/        KEEPER_MODE=nox
  web/           Swap · Batch · History · Inspect
  docs/          architecture.md · DEMO_SCRIPT.md
  deployments/sepolia.json
  feedback.md    iExec tooling feedback (deliverable)
```

## License

MIT
