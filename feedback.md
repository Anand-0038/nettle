# iExec Nox Tooling Feedback

**Project:** Nettle — confidential batch netting with residual Uniswap v4 settlement  
**Hackathon:** iExec WTF Hackathon Summer Edition  
**Test environment:** Ethereum Sepolia  
**Date:** July 2026  

Nettle completed a live two-wallet Sepolia epoch using opposing encrypted signed notionals. The final encrypted net was publicly decrypted, and only the residual was executed through:

```text
IntentRegistry → NettleHook → UniswapV4Executor → PoolManager.swap
```

This feedback is based on building, operating, debugging, and recording that end-to-end path.

## Versions used

| Component | Version or configuration |
| --- | --- |
| `@iexec-nox/nox-protocol-contracts` | `0.2.4` |
| `@iexec-nox/handle` | `0.1.0-beta.13` (pnpm-resolved) |
| `@iexec-nox/nox-hardhat-plugin` | Available (local stack); Nettle CI used mocks + Sepolia |
| Sepolia `NoxCompute` | `0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF` |
| Application runtime | Node.js 22 on Render (Nettle) |
| Upstream protocol docs | Node.js **24+** for `@iexec-nox/nox-protocol-contracts` development |
| viem | `2.55.x` |
| Hardhat | 3.x |
| Frontend | Next.js, wagmi, viem |

Note: Nettle runs on Node 22 in production. That is separate from the upstream package’s documented **Node 24+** development requirement.

## What worked well

### 1. Signed encrypted integers fit confidential netting

Using `eint256` allowed directional notional as:

```text
buy  = positive
sell = negative
```

Each submission updates one encrypted running net with `Nox.add`. Nox is load-bearing, not a sticker over a public calculation.

### 2. Selective public decryption fits transparent settlement

`allowPublicDecryption` is the right boundary:

- Individual signed notionals stay encrypted  
- Batch composition is not disclosed  
- Only the final net becomes decryptable  
- Residual can hit a transparent AMM  

Useful general pattern for confidential contracts that settle into public DeFi.

### 3. Handle SDK works with a normal wallet frontend

Encryption integrated into Next.js + wagmi + viem without a special wallet or separate signing system.

### 4. ACL model is expressive

`allow`, `allowThis`, and `allowPublicDecryption` give explicit control over who may use a handle. The hard part was discovering **when** permissions must be renewed after encrypted ops—not missing capability.

## Friction and suggested improvements

### P1: Public decryption readiness has no first-class lifecycle API

**Observed:** After `Nox.allowPublicDecryption(ep.netEncrypted)`, immediate `publicDecrypt(handle)` often failed for several keeper poll cycles. Failures did not clearly separate:

- Not processed yet  
- Permission not propagated  
- Wrong ACL  
- Invalid handle  
- Gateway failure  

**Workaround:** Nettle polls with exponential backoff, consecutive-failure tracking, degraded `/ready` health, and structured logs.

**Impact:** Closed epochs cannot settle until decrypt is ready. ~4–6 hours distinguishing async delay from bad ACL during development. Live demos need custom readiness logic. *Does not block eventual completion of epochs (multiple Sepolia epochs succeeded).*

**Suggested API:**

```ts
const result = await handleClient.waitForPublicDecryption(handle, {
  timeoutMs: 180_000,
  pollIntervalMs: 5_000,
  signal,
});

const status = await handleClient.getHandleStatus(handle);
// pending | computing | ready | failed
```

Docs should include:

```text
allowPublicDecryption → confirmation → off-chain processing → readiness → publicDecrypt
```

---

### P1: ACL renewal after encrypted operations is easy to miss

**Observed:** After `ep.netEncrypted = Nox.add(...)`, the **new** handle needs ACL before later ops or public decrypt. Failure surfaces at close/decrypt, not at the add line.

**Working pattern:**

```solidity
ep.netEncrypted = Nox.add(ep.netEncrypted, amount);
Nox.allowThis(ep.netEncrypted);
Nox.allow(ep.netEncrypted, address(this));
Nox.allow(ep.netEncrypted, keeper);
```

**Impact:** ~2 hours initial diagnosis; epochs can accept intents and only fail on close.

**Suggested:** `Nox.addAndAllow(a, b, readers[])`, Hardhat lint when a stored ciphertext has no following allow, or explicit reverts like `NOX_HANDLE_NOT_AUTHORIZED_FOR_CALLER`.

---

### P1: Local end-to-end testing is automated but still heavy

**Update:** `@iexec-nox/nox-hardhat-plugin` starts KMS, runner, gateway, NATS, S3, and local `NoxCompute` automatically. That is a real improvement over hand-assembled stacks.

**Remaining friction:** Full stack is still multi-service Docker—heavy for short cycles. Gap remains between:

- Fast unit tests (app mocks)  
- Full local Nox integration  

Nettle used `MockIntentRegistry` for CI and Sepolia for the real Nox path.

**Suggested profiles:**

| Profile | Role |
| --- | --- |
| `nox-unit` | In-process deterministic types for control-flow/accounting (no TEE claim) |
| `nox-integration` | Existing Docker-backed plugin stack |
| `nox-sepolia` | Remote recipe: faucets, endpoints, retry, quotas |

---

### P1: No documented binding between encrypted notional and public escrow

**Gap:** `submitIntent(encryptedAmount, proof, tokenIn, escrowAmount)` does not prove `|encrypted| == escrow` or that sign matches `tokenIn` with the API surface we used.

**Impact:** Malformed or malicious inputs can desync the encrypted book from balances. Nettle clamps residual to available escrow—mitigation, not proof.

**Requested recipes:**

| Pattern | Idea |
| --- | --- |
| A | Public direction from `tokenIn`; encrypt unsigned magnitude only |
| B | Encrypted comparison / equality with public escrow |
| C | ERC-7984-style confidential balances |

Each should document confidentiality, what stays public, ops, gas/latency, and settlement limits with transparent DeFi.

---

### P2: Machine-readable error classifications

Suggested:

```ts
class NoxHandleError extends Error {
  code:
    | "HANDLE_PENDING"
    | "HANDLE_NOT_FOUND"
    | "ACL_DENIED"
    | "PUBLIC_DECRYPT_NOT_ALLOWED"
    | "INVALID_PROOF"
    | "GATEWAY_UNAVAILABLE"
    | "COMPUTATION_FAILED";
  retryable: boolean;
}
```

`retryable` is especially useful for keepers.

---

### P2: Event-indexing guidance for frontends

Free Sepolia RPCs often reject wide `eth_getLogs`. Nettle used bounded ranges, storage views (`getEpochBook`, intent id lists), and an inspector page. A docs recipe (recent logs + views as canonical state + pagination) would help.

## Suggested documentation recipe

### Confidential batch netting with public residual settlement

```text
1. User encrypts signed notional as eint256
2. User escrows ERC-20
3. Registry imports encrypted input
4. Registry Nox.add into epoch net
5. Result handle receives ACL
6. closeEpoch: allowPublicDecryption on net only
7. Keeper waits until handle ready
8. Keeper publicDecrypts net
9. Contract executes only |residual| on public AMM
10. Opposite-side escrow per documented settlement model
```

### Recommended trust disclosure

```text
Public: wallets, escrow assets/amounts, epoch metadata, final residual
Confidential: individual signed notionals; batch composition before net reveal
App trust: whether keeper plaintext is verified vs handle;
          whether escrow is cryptographically bound to encrypted notional
```

## Troubleshooting table

| Symptom | Likely causes | Retry? |
| --- | --- | --- |
| `publicDecrypt` fails right after close | Handle still processing | Usually |
| `publicDecrypt` never succeeds | Missing permission, bad handle, infra | Diagnose |
| Op succeeds, later op fails | Result handle missing ACL | No — fix contract |
| Encrypt OK, submit reverts | Proof / wrong contract / ACL on input | No |
| Local Nox tests do not start | Docker, ports, images, health | Diagnose |
| UI history incomplete | RPC log-range limits | Smaller ranges |

## Priority ranking

1. Handle readiness / public-decrypt lifecycle API  
2. ACL diagnostics and safer permission helpers  
3. Lightweight deterministic test mode next to the full Hardhat plugin stack  
4. Official escrow ↔ encrypted-input binding patterns  
5. Machine-readable SDK errors  
6. Frontend indexing guidance  

## Final assessment

Nox primitives were sufficient for Nettle’s core:

```text
encrypted individual notionals
→ encrypted aggregate net
→ selective net disclosure
→ public residual settlement
```

Largest difficulties were operational and DX—not missing confidential computation. The highest-value improvement is making encrypted-handle state and readiness explicit so developers can tell “not ready yet” from “incorrect permissions” without custom polling and health heuristics.

— Nettle team, WTF Hackathon Summer Edition
