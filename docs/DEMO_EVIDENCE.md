# Demo evidence — Sepolia epoch **19**

**Status: complete live opposing-intent epoch**  
Generated: 2026-07-24T14:27:26Z

## Verdict for judges

Two wallets sealed **opposing Nox-encrypted signed notional** (+5e6 vs −3e6 micro-USDC units).  
Only the **residual 2 USDC** hit Uniswap v4. Opposite-side WETH was fully refunded.  
Path proven on-chain in a single `executeEpoch` transaction:

```text
IntentRegistry → NettleHook → UniswapV4Executor → PoolManager.swap
```

| Metric | Value |
| --- | --- |
| Encrypted net (publicDecrypt) | `+2_000_000` |
| Gross buy escrow (USDC) | `5_000_000` (5 USDC) |
| Residual to AMM | `2_000_000` (2 USDC). **3 of the 5 USDC buy notional was cancelled, leaving a 2 USDC residual.** |
| Residual out | `1_811_944` |
| zeroForOne | `true` |
| Participants | `2` |

## Pre-flight

| Check | Result |
| --- | --- |
| Registry | [`0xd5d950a0…b71f`](https://sepolia.etherscan.io/address/0xd5d950a0b211afe67ad4e5a8f28804b42bc2b71f) |
| Hook | [`0xd20f5fD8…80c0`](https://sepolia.etherscan.io/address/0xd20f5fD8094A000e37e5540dfE34444cd30780c0) |
| V4 Executor | [`0xfd84a8e2…4793`](https://sepolia.etherscan.io/address/0xfd84a8e2996875e5e34171e467c4f2b8221c4793) |
| Keeper `/ready` | https://nettle-s2q0.onrender.com/ready |
| Frontend | https://nettle-web-ecru.vercel.app |
| Wallet A | `0xFB76C4B6912bCF358752Fb4b4b15B959EfaDD915` |
| Wallet B | `0xd311e344720e94C5B151EF589F1220bA2469EB45` |
| netHandle | `0x0000aa36a743017c1330216c91450df1355a951933e680d59dc2833b5e06e6ea` |

## Transactions (Etherscan Sepolia)

| Step | Description | Tx |
| --- | --- | --- |
| 1 | Fund B ETH | [`0xdc5a3d22…c9ab`](https://sepolia.etherscan.io/tx/0xdc5a3d229f69580a6b66cffe6c4b105d100d8a26c5f0b99d69bbe409b7d4c9ab) |
| 2 | Fund B WETH | [`0xa66b96d2…df57`](https://sepolia.etherscan.io/tx/0xa66b96d249520ed618c8155349facb08566feef86c10386bb14a2e52eb2ddf57) |
| 3 | Approve A USDC | [`0x1114fdcf…4daf`](https://sepolia.etherscan.io/tx/0x1114fdcfe7f57de76d7a7951fbb7a6e05dee73dc0b641f70cd9d476308c54daf) |
| 4 | **Intent A** (+5 USDC encrypted, 5 USDC escrow) | [`0x1a460973…c934`](https://sepolia.etherscan.io/tx/0x1a46097312e4655239202ad41a5b61afc925e5bdd35999b3608828ac2da8c934) |
| 5 | Approve B WETH | [`0xfbbef76b…cc13`](https://sepolia.etherscan.io/tx/0xfbbef76b1c02cf3ccaa9fb42a4e556c9a2804a3cd69d1e370d3461a2f19dcc13) |
| 6 | **Intent B** (−3e6 encrypted, 0.0005 WETH escrow) | [`0xe5491e7c…4d49`](https://sepolia.etherscan.io/tx/0xe5491e7cba0a4704846464e29bbf87f0e679fc7830ef814646196622ed774d49) |
| 7 | **EpochClosed** (allowPublicDecryption) | [`0x24ba11d8…e00b`](https://sepolia.etherscan.io/tx/0x24ba11d8871c3e4b77a37981b7eb35a6e911a5f1aaf1809417a13d0a1a5ce00b) |
| 8 | **publicDecrypt** (keeper log) | net = `2000000` |
| 9 | **executeEpoch** + Hook + V4 residual + settlement | [`0xc6790809…c3c5`](https://sepolia.etherscan.io/tx/0xc679080947c4ff8f060b019f8f3d9c567739abfd21ec70f343c9b4bfce17c3c5) |

### Events inside execute tx `0xc6790809…`

Same transaction hash, block **11341282**:

| Contract | Evidence |
| --- | --- |
| NettleHook | `V4BeforeSwap` / `V4AfterSwap` / `BatchSwapValidated` (residualIn=`0x1e8480` = 2e6) |
| UniswapV4Executor | `ResidualV4Swap(zeroForOne=true, amountIn=2e6, amountOut=1811944, poolHooks=NettleHook)` |
| IntentRegistry | `BatchMatched`, `EpochExecuted`, `IntentSettled` ×2, `EpochOpened(20)` |

### Settlement interpretation

| Trader | Role | Settlement (from `IntentSettled` on execute tx) |
| --- | --- | --- |
| A `0xFB76…` | Residual side (USDC in) | Receives pro-rata residual **output** + unused USDC refund |
| B `0xd311…` | Opposite side (WETH in) | **Full WETH escrow refund** (`0.0005 WETH`) — not a P2P fill |

## Unit honesty

Encrypted signed amounts use **USDC micro-units** for both legs so the net is integer-meaningful:

```text
+5_000_000  (A buy, USDC escrow 5 USDC)
-3_000_000  (B sell-side signed notional)
──────────
+2_000_000  residual → AMM (proven on-chain)
```

B’s **token escrow** is real WETH (opposite token). That is intentional MVP economics: opposite escrow is refunded; residual is the encrypted book net in consistent units.

## Trust disclosures (say this in the video)

1. **Trusted keeper** closes epochs and submits `netSigned` (not proven on-chain vs handle).  
2. Encrypted magnitude is **not** proven equal to escrow on-chain in this MVP.  
3. Escrow token, amount, wallets, and residual swap are **public**.  
4. This is **confidential notional cancellation + residual AMM**, not a private CLOB.

## Reproduce

```bash
# from nettle/
set -a && source .env && set +a
# wake keeper first
curl -sS https://nettle-s2q0.onrender.com/ready
node scripts/sepolia-opposing-epoch.mjs
```

Machine-readable log: [`DEMO_EVIDENCE.partial.json`](./DEMO_EVIDENCE.partial.json)

## Demo script path (≤ 4 min)

1. Problem: AMM needs plaintext size → sandwich risk  
2. Show two intent txs (A/B) on Etherscan — escrow public, size encrypted  
3. Show EpochClosed + netHandle  
4. Show execute tx: residual **2 USDC** only (not 5+3)  
5. Show Hook + Executor logs on same tx  
6. State MVP trust limits in one sentence  
