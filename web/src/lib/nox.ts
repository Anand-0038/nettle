/**
 * Nox handle client — encrypt / decrypt with gateway error handling.
 * Used only when DEMO_MODE=false (Sepolia production path).
 */
import type { WalletClient } from "viem";

const ENCRYPT_TIMEOUT_MS = 45_000;

export type EncryptResult = {
  handle: `0x${string}`;
  handleProof: `0x${string}`;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(
            `${label} timed out after ${ms / 1000}s — Nox gateway may be slow. Retry.`
          )
        ),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function encryptSignedAmount(
  walletClient: WalletClient,
  signedAmount: bigint,
  applicationContract: `0x${string}`
): Promise<EncryptResult> {
  if (!walletClient.account) {
    throw new Error("Wallet not connected");
  }

  try {
    const { createViemHandleClient } = await import("@iexec-nox/handle");
    const handleClient = await createViemHandleClient(walletClient as never);

    const result = await withTimeout(
      handleClient.encryptInput(
        signedAmount,
        "int256",
        applicationContract
      ),
      ENCRYPT_TIMEOUT_MS,
      "encryptInput"
    );

    return {
      handle: result.handle as `0x${string}`,
      handleProof: result.handleProof as `0x${string}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timed out")) throw e;
    if (msg.includes("Chain") && msg.includes("not supported")) {
      throw new Error(
        "Nox gateway does not support this chain. Use Ethereum Sepolia (11155111)."
      );
    }
    throw new Error(`Nox encrypt failed: ${msg}`);
  }
}

export async function decryptOwnHandle(
  walletClient: WalletClient,
  handle: `0x${string}`
): Promise<bigint> {
  const { createViemHandleClient } = await import("@iexec-nox/handle");
  const handleClient = await createViemHandleClient(walletClient as never);
  const { value } = await withTimeout(
    handleClient.decrypt(handle),
    ENCRYPT_TIMEOUT_MS,
    "decrypt"
  );
  return value as bigint;
}

export async function publicDecryptNet(
  walletClient: WalletClient,
  handle: `0x${string}`
): Promise<bigint> {
  const { createViemHandleClient } = await import("@iexec-nox/handle");
  const handleClient = await createViemHandleClient(walletClient as never);
  const { value } = await withTimeout(
    handleClient.publicDecrypt(handle),
    ENCRYPT_TIMEOUT_MS,
    "publicDecrypt"
  );
  return value as bigint;
}
