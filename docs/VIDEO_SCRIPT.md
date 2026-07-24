# Four-minute demo video (epoch 19 — do not improvise)

**Goal:** prove confidential notional netting on Sepolia, residual-only v4 execution.  
**Do not say:** private asset matching, decentralized keeper, fully private, 60% of flow.

Open tabs before record:

1. Frontend: https://nettle-web-ecru.vercel.app  
2. Execute tx **Logs** tab: https://sepolia.etherscan.io/tx/0xc679080947c4ff8f060b019f8f3d9c567739abfd21ec70f343c9b4bfce17c3c5#eventlog  
3. Intent A: https://sepolia.etherscan.io/tx/0x1a46097312e4655239202ad41a5b61afc925e5bdd35999b3608828ac2da8c934  
4. Intent B: https://sepolia.etherscan.io/tx/0xe5491e7cba0a4704846464e29bbf87f0e679fc7830ef814646196622ed774d49  
5. EpochClosed: https://sepolia.etherscan.io/tx/0x24ba11d8871c3e4b77a37981b7eb35a6e911a5f1aaf1809417a13d0a1a5ce00b  
6. Optional: keeper https://nettle-s2q0.onrender.com/ready  

Wake the keeper once before recording.

---

## 0:00 – 0:45 — Problem + claim

**Show:** frontend Swap page (Sepolia).

**Say:**

> On Uniswap, a large rebalance exposes full size to searchers.  
> You cannot hide the AMM trade itself — pools need plaintext.  
> Nettle does **confidential notional netting** with iExec Nox: opposing signed intent is cancelled in an encrypted book, then only the residual hits Uniswap v4.

**On-screen text:** `Confidential notional netting` · `Residual only on Uniswap v4`

---

## 0:45 – 1:30 — Two intents (already mined — walk txs)

**Show:** Intent A Etherscan, then Intent B.

**Say:**

> Wallet A sealed a +5 USDC signed notional with 5 USDC escrow.  
> Wallet B sealed opposing −3e6 notional units and escrowed a small WETH amount.  
> Escrow and wallets are public. Individual signed size stays encrypted as a Nox handle.

**On-screen:** `Intent A` · `Intent B` · `Escrow public · size encrypted`

---

## 1:30 – 2:15 — Close + public decrypt

**Show:** EpochClosed tx, then briefly `/ready` or keeper narrative.

**Say:**

> Epoch 19 closed. The keeper public-decrypts **only the net**.  
> Decrypt result: plus two million micro-USDC — that is +2 USDC.  
> **3 of the 5 USDC buy notional was cancelled, leaving a 2 USDC residual.**

**On-screen:** `publicDecrypt = +2e6` · `2 USDC residual`

---

## 2:15 – 3:20 — Execute logs (critical)

**Show:** execute tx → **Event Logs** (not Overview). Scroll:

1. NettleHook `BatchSwapValidated` / before-after swap  
2. UniswapV4Executor residual swap  
3. IntentRegistry `EpochExecuted` residualIn `2000000`  
4. `IntentSettled` (B full WETH refund; A residual settlement)

**Say:**

> Same transaction: Registry calls the hook, the hook calls the v4 executor, residual swaps on PoolManager.  
> Opposite-side WETH is fully refunded — this is notional cancellation, not peer-to-peer matching.  
> Path: IntentRegistry → NettleHook → UniswapV4Executor → PoolManager.swap.

**On-screen:** `One residual swap` · `Hook on path` · `Not a CLOB`

---

## 3:20 – 4:00 — Honest limits + close

**Show:** Inspect page or README threat model if needed; end on logo/repo.

**Say:**

> MVP trust: one trusted keeper submits the decrypted net; we do not prove net equals handle on-chain.  
> Encrypted notional is not cryptographically bound to escrow in this MVP — we disclose that.  
> What we prove: confidential book composition, residual-only Uniswap v4 settlement, live Sepolia evidence.  
> Nettle — confidential notional netting as a layer on Uniswap, powered by Nox.

**End card:**

```text
Nettle · Sepolia epoch 19
github.com/Anand-0038/nettle
nettle-web-ecru.vercel.app
```

---

## Forbidden phrases

| Avoid | Prefer |
| --- | --- |
| private asset matching | confidential notional netting |
| private order matching | encrypted batch net |
| decentralized keeper | trusted keeper MVP |
| fully private | signed size encrypted; escrow public |
| 60% of total flow cancelled | 3 of 5 USDC buy notional cancelled → 2 USDC residual |
