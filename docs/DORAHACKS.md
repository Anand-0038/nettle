# DoraHacks submission copy (paste-ready)

Use this text on the DoraHacks project page. It is intentionally honest about MVP limits.

## One-liner

**Confidential notional netting for DeFi** — Nox-encrypted batch net, residual-only Uniswap v4 settlement.

## Short description

Nettle is a confidential **notional netting** layer for DeFi (not private asset matching). Users escrow public testnet tokens while submitting a Nox-encrypted signed intent. Nettle computes the aggregate net inside confidential computation, publicly decrypts only the final net, and sends only the residual through a hooked Uniswap v4 pool.

The MVP does **not** provide full transaction privacy or peer-to-peer clearing. Wallet addresses, escrow transfers, token direction, epoch metadata, and the final residual remain public. The confidential component protects each signed intent and the composition of the batch.

## What to say (correct claims)

| Say this | Not this |
| --- | --- |
| Confidential notional netting | Private asset matching / private order matching |
| Trusted keeper MVP | Decentralized keeper |
| Signed intent amount encrypted | Individual orders remain confidential throughout |
| Residual AMM settlement | Orders are filled against each other |
| Institutional-style treasury workflows | Production institutional trading |
| 3 of 5 USDC buy notional cancelled → 2 USDC residual | “60% of total flow cancelled” |

## Recommended abstract (full)

Nettle is a confidential batch-netting layer for DeFi. Users escrow public testnet tokens while submitting a Nox-encrypted signed intent. Nettle computes the aggregate net inside confidential computation (iExec Nox / Intel TDX), publicly decrypts only the final net, and routes only the residual through:

`IntentRegistry → NettleHook → UniswapV4Executor → PoolManager.swap`

Opposing **notional** is cancelled in the encrypted book before AMM execution. Opposite-side escrow is refunded (notional cancellation), not exchanged Alice↔Bob at a clearing price. Residual-side traders receive pro-rata AMM output plus unused input refunds.

**Live proof (Sepolia epoch 19):** two wallets sealed opposing encrypted notionals (+5e6 / −3e6 micro-USDC units). Nox publicDecrypt returned `+2_000_000`. Only a **2 USDC residual** executed on Uniswap v4 in one transaction that includes NettleHook and UniswapV4Executor events. Full links: [docs/DEMO_EVIDENCE.md](./DEMO_EVIDENCE.md).

**MVP disclosures**

- Escrow token, escrow amount, trader address, participant count, epoch metadata, and residual swap are public.
- A **trusted keeper** closes each epoch, retrieves the publicly decryptable net, and calls `executeEpoch`. Keeper decentralization is out of scope for the hackathon MVP.
- The contract accepts the keeper-supplied decrypted net without on-chain proof against the Nox handle (explicit trust assumption).
- Encrypted magnitude is not proven equal to escrow amount on-chain in this MVP (e.g. opposing notional may be in USDC micro-units while the opposite leg escrows WETH).

Nettle demonstrates confidential computation as a composable execution layer for residual reduction — not complete transaction privacy.

## Tagline options

1. Confidential notional netting for DeFi  
2. Confidential batch netting with residual Uniswap v4 settlement  
3. Confidential notional cancellation for Uniswap  

Avoid: “Private Intent Matching,” “private asset matching,” “decentralized keeper.”

## Live links

| Component | URL |
| --- | --- |
| Frontend | https://nettle-web-ecru.vercel.app |
| Keeper health | https://nettle-s2q0.onrender.com/health |
| Keeper ready | https://nettle-s2q0.onrender.com/ready |
| Registry (Sepolia) | https://sepolia.etherscan.io/address/0xd5d950a0b211afe67ad4e5a8f28804b42bc2b71f |
| Execute residual (epoch 19) | https://sepolia.etherscan.io/tx/0xc679080947c4ff8f060b019f8f3d9c567739abfd21ec70f343c9b4bfce17c3c5 |

**Note:** Render free tier cold-starts. Hit `/health` once before a live demo; wait ~30–60s if the first request times out.

## X / Twitter post (paste)

```text
Nettle — confidential notional netting for DeFi on iExec Nox + Uniswap v4.

Two Sepolia wallets sealed opposing encrypted notionals. Nox revealed only the net (+2 USDC). That residual alone hit PoolManager via NettleHook — not full size.

Not private asset matching. Not a CLOB. Trusted keeper MVP. Escrow stays public.

Demo evidence: github.com/Anand-0038/nettle
App: nettle-web-ecru.vercel.app
#iExec #WTFHackathon #Uniswap
```
