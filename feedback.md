# feedback.md — iExec Nox tooling (WTF Hackathon)

Project: **Nettle** — confidential batch matching engine (Uniswap residual + Nox).

## Used

| Tool | Role |
| --- | --- |
| `@iexec-nox/nox-protocol-contracts` | `eint256`, `fromExternal`, `add`, `allow` / `allowThis`, `allowPublicDecryption` |
| `@iexec-nox/handle` | `encryptInput`, `decrypt`, `publicDecrypt` |
| Sepolia NoxCompute | `0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF` |

## What worked

1. Signed `eint256` maps cleanly to a netting / residual book (buy +, sell −).
2. Selective `allowPublicDecryption` on **only** the net handle is the right primitive for transparent AMM settlement.
3. JS SDK (viem) fits a standard wallet frontend.

## Friction

1. **`allowThis` / `allow` footgun** — missing ACL after every `Nox.add` breaks the next tx. Lint or plugin check would help.
2. **Async TEE lifecycle** — after `closeEpoch`, keepers need a first-class `waitForHandle` / readiness poll before `publicDecrypt`.
3. **Local full stack** — Docker Compose for KMS/runner/gateway is heavy for a short hackathon. Official “mock Nox” vs “full TEE” profiles would help.
4. **Public RPC + logs** — free Sepolia endpoints reject wide `eth_getLogs`; not Nox-specific but bites every confidential dApp UI.

## Requests

1. Official `waitForHandle(handle, { publiclyDecryptable })` in `@iexec-nox/handle`.
2. Hardhat profile for lightweight local encrypted types without full Docker.
3. Sample “batch net → residual AMM” recipe in docs (matches this project’s pattern).

— Nettle, WTF Hackathon Summer Edition
