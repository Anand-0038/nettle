# feedback.md — iExec Nox tooling (WTF Hackathon)

**Project:** Nettle — confidential batch netting + residual Uniswap v4 settlement  
**Track:** WTF Hackathon Summer Edition  
**Date:** 2026-07  
**Severity key:** P0 blocker · P1 major friction · P2 nice-to-have

## Stack / versions

| Package | Version / note |
| --- | --- |
| `@iexec-nox/nox-protocol-contracts` | `0.2.4` (workspace pin via pnpm) |
| `@iexec-nox/handle` | `^0.1.0-beta.13` |
| Sepolia NoxCompute | `0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF` |
| Node | ≥ 20 |
| viem | `^2.48` |
| Hardhat toolbox (viem) | monorepo `@nettle/contracts` |

## What worked well

1. **Signed `eint256` as a netting book** — mapping buy `+` / sell `−` to a running `Nox.add` net is the cleanest confidential netting pattern we found.
2. **Selective `allowPublicDecryption` on only the net handle** — correct primitive for “hide composition, publish residual.”
3. **JS SDK + viem** — wallet-connected encrypt path fits a standard Next.js + wagmi frontend without a custom signing stack.
4. **ACL model is explicit** — once understood, `allow` / `allowThis` / `allowPublicDecryption` are predictable.

## Friction (actionable)

### P0 — Async public decrypt readiness has no first-class waiter

**Observed**

After `closeEpoch` calls `Nox.allowPublicDecryption(ep.netEncrypted)`, the keeper’s
`publicDecrypt(handle)` fails for many consecutive polls (TEE / gateway lag).

**Workaround**

```ts
// keeper polls every POLL_MS (8s), exponential backoff up to 120s,
// marks health "degraded" after DECRYPT_STUCK_AFTER attempts
```

**Impact**

- Epoch remains `Closed`; users cannot settle until TEE output is ready.
- Demo risk: judges see stuck “Closed” UI if decrypt lag exceeds attention span.
- Time lost: ~4–6 hours debugging “is ACL wrong?” vs “is TEE just slow?”

**Requested API**

```ts
await handleClient.waitForHandle(handle, {
  publiclyDecryptable: true,
  timeoutMs: 180_000,
  pollIntervalMs: 5_000,
});
// resolves with { value: bigint } or throws DecryptTimeoutError
```

Docs page that should exist: “Public decrypt lifecycle after `allowPublicDecryption`.”

---

### P1 — `allowThis` / `allow` footgun after every `Nox.add`

**Observed**

Missing ACL after `ep.netEncrypted = Nox.add(...)` causes the next Nox op or
`allowPublicDecryption` to fail with opaque reverts.

**Workaround**

After every add we re-grant:

```solidity
ep.netEncrypted = Nox.add(ep.netEncrypted, amount);
Nox.allowThis(ep.netEncrypted);
Nox.allow(ep.netEncrypted, address(this));
Nox.allow(ep.netEncrypted, keeper);
```

**Impact**

Easy to ship a broken epoch closer. Cost ~2 hours on first integration.

**Request**

- Hardhat / Foundry lint: “ciphertext written without subsequent allow.”
- Or `Nox.addAndAllow(a, b, readers[])` helper.

---

### P1 — Local full-stack Nox is too heavy for a 48h hackathon

**Observed**

Docker Compose for KMS / runner / gateway is a multi-GB path. Most teams skip to Sepolia-only.

**Impact**

- Unit tests of production `IntentRegistry` (real Nox types) are hard without mocks.
- We maintain `MockIntentRegistry` for CI; production path is Sepolia-only.

**Request**

Official profiles:

1. `nox-mock` — in-process encrypted types, no Docker  
2. `nox-local-tee` — full stack  
3. Documented Sepolia faucet + quota limits for publicDecrypt

---

### P2 — Free public RPCs reject wide `eth_getLogs`

**Observed**

Sepolia free endpoints 429 / truncate logs. Not Nox-specific, but every confidential dApp UI that indexes events hits this.

**Workaround**

On-chain storage views (`getEpochBook`, intent id lists) + Alchemy RPC.

**Request**

Sample “inspector without getLogs” recipe in Nox docs (we implemented this pattern).

---

### P2 — No equality between encrypted amount and public escrow

**Observed**

`submitIntent(externalEint256, proof, tokenIn, escrowAmount)` cannot prove
`|decrypt(handle)| == escrowAmount` on-chain in the current SDK surface we used.

**Impact**

Semantic gap: encrypted book and escrow can disagree; residual is clamped to balance.

**Request**

Documented pattern for:

- encrypt unsigned magnitude only + derive sign from `tokenIn`, **or**
- confidential equality / range proof binding escrow to handle

---

## Suggested docs snippets (for iExec)

### Recipe: batch net → residual AMM

```text
1. User encrypts signed amount (eint256), escrows ERC-20
2. Registry: net = Nox.add(net, amount); allow net to registry+keeper
3. closeEpoch: allowPublicDecryption(net)
4. Keeper: waitForHandle → publicDecrypt → executeEpoch(netSigned)
5. Only |net| hits AMM; opposite escrow refunded
```

### Error table (would have saved hours)

| Symptom | Likely cause |
| --- | --- |
| publicDecrypt always fails | TEE not ready; not necessarily bad ACL |
| add then publicDecrypt reverts | missing allow after add |
| encrypt works, submit reverts | wrong ACL on input handle / proof |

## Severity ranking (our experience)

1. Missing `waitForHandle` / readiness API (demo reliability)  
2. ACL footguns after ciphertext ops  
3. Heavy local TEE stack  
4. Escrow ↔ handle binding guidance  

— Nettle team, WTF Hackathon
