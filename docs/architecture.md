# Nettle — Engineering design document

**Confidential batch netting for Uniswap, powered by iExec Nox (WTF Hackathon).**

---

## 1. Problem

Large rebalances (DAO treasuries, OTC desks, market makers) on public AMMs leak:

| Leak | Consequence |
| --- | --- |
| Full trade size on-chain | Sandwich / JIT liquidity / adverse selection |
| Direction before inclusion | Front-running of the residual path |
| Multi-leg “same intent” | Correlated flow readable by searchers |

Uniswap itself is the right venue for **price discovery**. The bug is not Uniswap — it is **broadcasting individual size**.

---

## 2. Why encrypted swaps alone fail

A natural first idea: “encrypt the swap, then settle on Uniswap privately.”

That fails for a structural reason:

> **AMMs require plaintext settlement.**  
> Pool reserves, `amountIn`, and `amountOut` must be public for invariant accounting and for anyone to verify the curve.

So you cannot:

1. Hide full size from Uniswap **and**
2. Still execute that full size on Uniswap’s curve.

Nettle’s design choice:

```text
Do NOT hide the AMM trade.
Hide individual intent sizes.
Only expose the net residual to Uniswap.
```

That matches the hackathon brief: **add privacy to an existing protocol without modifying it** (batching / layering).

---

## 3. Residual matching (what we actually build)

### 3.1 System architecture

```text
┌─────────────┐   encryptInput(int256)    ┌──────────────────┐
│  Trader UI  │ ───────────────────────► │  IntentRegistry  │
│  (Nox JS)   │   + ERC-20 escrow        │  Nox.add (TEE)   │
└─────────────┘                          └────────┬─────────┘
                                                  │ closeEpoch
                                                  │ allowPublicDecryption(net only)
                                                  ▼
                                         ┌──────────────────┐
                                         │ Keeper           │
                                         │ publicDecrypt    │
                                         │ executeEpoch     │
                                         └────────┬─────────┘
                                                  │ residual |net| only
                                                  ▼
                                         ┌──────────────────┐
                                         │ NettleHook       │  ◄── on-path gate
                                         │ only registry    │
                                         └────────┬─────────┘
                                                  │
                                                  ▼
                                         ┌──────────────────┐
                                         │ UniswapV4Executor│  OnlyHook
                                         └────────┬─────────┘
                                                  │ unlock + swap
                                                  ▼
                                         ┌──────────────────┐
                                         │ PoolManager (v4) │  hooks=NettleHook
                                         │ before/afterSwap │
                                         └────────┬─────────┘
                                                  │ amountOut → Registry
                                                  ▼
                                         ┌──────────────────┐
                                         │ _settleMatching  │
                                         └──────────────────┘
```

### 3.2 What “matching” means

| Term in pitch | Implementation |
| --- | --- |
| Opposing flow cancels | `ep.netEncrypted = Nox.add(ep.netEncrypted, amount)` |
| Residual executes | `executeEpoch` → Hook → Executor → Router |
| Matching engine (CLOB) | **Not claimed** — no clearing price, no P2P fills |

Running encrypted net:

```text
Trader A   +100
Trader B   −60
────────────────
Encrypted net = +40   (TEE, Nox.add)
AMM sees only   40
```

### 3.3 Sequence (happy path)

```text
Wallet A          Registry / Nox              Keeper              Hook / AMM
   │                    │                       │                     │
   │ submitIntent(+x)   │                       │                     │
   │───────────────────►│ Nox.add               │                     │
   │                    │ escrow tokenIn        │                     │
   │                    │                       │                     │
Wallet B                │                       │                     │
   │ submitIntent(−y)   │                       │                     │
   │───────────────────►│ Nox.add               │                     │
   │                    │                       │                     │
   │                    │◄── closeEpoch ────────│                     │
   │                    │ allowPublicDecrypt    │                     │
   │                    │                       │ publicDecrypt(net)  │
   │                    │◄── executeEpoch(net) ─│                     │
   │                    │ approve Hook          │                     │
   │                    │─────────────────────────────────────────────►│
   │                    │                     residual swap           │
   │                    │◄────────────────────────────────────────────│
   │                    │ settle pro-rata + refunds                   │
   │◄── tokens ─────────│                       │                     │
```

---

## 4. Threat model

| Threat | Mitigation | Residual risk (honest) |
| --- | --- | --- |
| Sandwich of full size | Only **residual** hits AMM | Residual can still be sandwiched |
| Intent size leakage | Nox `eint256` + ACL | Escrow **amounts** still plain ERC-20 |
| Intent direction (if same token) | Encrypted signed amount | Escrow token address is public |
| Keeper double-exec | `Closed → Executed`, `AlreadyExecuted`, `nonReentrant` | — |
| Non-keeper execute | `onlyKeeper` | Single trusted keeper (MVP) |
| Hook bypass / direct AMM | Registry approves **Hook only**; Executor `OnlyHook` | — |
| Reentrancy on settle | `nonReentrant` + CEI-style state | — |
| Failed `publicDecrypt` | Keeper retry / backoff | No admin recovery timeout (MVP) |
| Malicious keeper | Explicit trust for MVP | Can grief close/execute timing |
| Empty epoch gas grief | Empty book rotates without publicDecrypt ACL | Keeper still pays gas to rotate |
| RPC / log DoS on UI | Storage reads + 10-block log windows | History not infinite archive |

### What Nettle does **not** hide

- AMM settlement of residual (public by necessity)
- ERC-20 deposit / escrow size and token
- That *someone* sealed an intent this epoch (events / participant count)
- Final residual direction and size after execute

### What Nettle **does** hide

- Individual signed size (encrypted handle; ACL decrypt for owner)
- How opposing intents compose until net is public-decrypted
- Full would-be AMM footprint of unmatched individual legs

---

## 5. Epoch lifecycle

```text
                  submitIntent (Open only, block < closeBlock)
                              │
         ┌────────────────────▼────────────────────┐
         │              OPEN                        │
         │  netEncrypted via Nox.add                │
         │  buyEscrow / sellEscrow (plain stats)    │
         └────────────────────┬────────────────────┘
                              │ closeEpoch
              ┌───────────────┴───────────────┐
              │ participants == 0             │ participants > 0
              ▼                               ▼
         EXECUTED + open next            CLOSED
         (no TEE publicDecrypt)          netHandle public-decryptable
                                              │
                                              │ executeEpoch(net, minOut)
                                              ▼
                                         EXECUTED
                                         residual swap (if net ≠ 0)
                                         settle + _openEpoch
```

**Rollover rule:** after close/execute path opens epoch `N+1`. New submits never join a Closed epoch.

---

## 6. Settlement

Push model at `executeEpoch` (no separate `claim()` in MVP).

### Residual ≠ 0

1. Residual-side traders (tokenIn matches residual direction):
   - `consumed = residualIn * escrowed / sideTotal`
   - `shareOut = amountOut * escrowed / sideTotal`
   - refund `escrowed - consumed` of tokenIn
   - transfer `shareOut` of tokenOut
2. Opposite-side traders:
   - **full escrow refund** (privacy cancel vs AMM — not P2P exchange)

### Residual = 0

Full refund of all escrows; zero Uniswap call.

### Worked example

```text
Alice  +100 USDC
Bob    opposing notional (token1 in)
Net residual  ~20 USDC → Uniswap → WETH

Alice: unused USDC refunded + pro-rata WETH
Bob:   full token1 refund
```

Bob does not receive Alice’s USDC peer-to-peer (needs a clearing price). He reduces Alice’s AMM footprint.

---

## 7. Keeper

| Responsibility | Notes |
| --- | --- |
| Detect past `closeBlock` | Poll on Alchemy Sepolia |
| `closeEpoch` | Empty vs non-empty paths |
| `publicDecrypt(netHandle)` | After TEE ACL ready |
| `executeEpoch(net, minOut)` | Local sign + `eth_sendRawTransaction` |
| Retries | Backoff on decrypt not ready |

**Trust model:** one keeper address (MVP). Not decentralized. Stated in README.

---

## 8. TEE / Nox

| Step | Primitive |
| --- | --- |
| Client encrypt | `@iexec-nox/handle` `encryptInput` |
| On-chain ingest | `Nox.fromExternal` |
| Netting | `Nox.add` on `eint256` |
| ACL | `allowThis` / `allow` after every add |
| Publish residual | `allowPublicDecryption` on **net only** |
| Keeper decrypt | `publicDecrypt` |

Individual handles stay owner-ACL; only net becomes publicly decryptable.

---

## 9. Hook & Executor (path integrity)

| Component | Authoritative checks |
| --- | --- |
| Registry | Approves **Hook** as `executor`, never raw AMM |
| NettleHook | `msg.sender == registry`, `amountIn > 0`, minOut, approve reset |
| UniswapV4Executor | `msg.sender == hook` (`OnlyHook`), PoolManager.unlock + swap, minOut |

Residual execution uses **Uniswap v4 PoolManager.swap**.  
NettleHook is CREATE2-mined with `BEFORE_SWAP | AFTER_SWAP` flags and is
`PoolKey.hooks`, so residual swaps invoke real v4 hook callbacks.

---

## 10. Failure modes

| Failure | Behavior |
| --- | --- |
| User on wrong chain | UI network banner / switch |
| Insufficient allowance | Approve then submit |
| Epoch past close | `submitIntent` reverts `EpochNotOpen` |
| Double `executeEpoch` | Reverts `AlreadyExecuted` / not Closed |
| Decrypt not ready | Keeper logs + retry; epoch stays Closed |
| Slippage | `minAmountOut` reverts swap; epoch remains Closed until retry |
| Alchemy free log limits | UI uses storage + ≤10-block log windows |
| Empty epochs | Rotate without publicDecrypt (zero handle ACL issue) |

---

## 11. Out of scope (intentionally)

- Full Uniswap v4 pool execution as primary path  
- Decentralized / multi-keeper consensus  
- Governance, multi-pool routing, cross-chain  
- ERC-7984 private deposits  
- CLOB clearing-price settlement  

These increase demo risk without improving brief fit.

---

## 12. Deployed path (Sepolia)

See `deployments/sepolia.json` for addresses.

```text
IntentRegistry → NettleHook → UniswapV4Executor → PoolManager.swap
```

UI: Swap · Batch · History · Inspect  
Keeper: `KEEPER_MODE=nox`
