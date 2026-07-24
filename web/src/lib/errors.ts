/** User-facing error messages for wallet / viem failures */

export function isUserRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    name?: string;
    code?: number | string;
    shortMessage?: string;
    message?: string;
    cause?: { code?: number; name?: string; message?: string };
  };
  if (e.name === "UserRejectedRequestError") return true;
  if (e.code === 4001 || e.code === "ACTION_REJECTED") return true;
  if (e.cause?.code === 4001) return true;
  if (e.cause?.name === "UserRejectedRequestError") return true;
  const msg = `${e.shortMessage ?? ""} ${e.message ?? ""} ${e.cause?.message ?? ""}`.toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("rejected the request") ||
    msg.includes("request rejected")
  );
}

export function friendlyError(error: unknown): string {
  if (isUserRejection(error)) {
    return "Request cancelled in wallet — nothing was sent.";
  }
  const e = error as { shortMessage?: string; message?: string; details?: string };
  const raw = `${e.shortMessage || ""} ${e.message || ""} ${e.details || ""} ${String(error)}`;
  const lower = raw.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return "Request cancelled in wallet — nothing was sent.";
  }
  if (
    lower.includes("nonce too low") ||
    lower.includes("already known") ||
    lower.includes("replacement transaction underpriced")
  ) {
    return "Wallet nonce is out of sync. In MetaMask: ⋮ → Settings → Advanced → Clear activity tab data, then retry.";
  }
  if (
    lower.includes("epochnotopen") ||
    lower.includes("epoch not open") ||
    (lower.includes("0x") && lower.includes("reverted") && lower.includes("epoch"))
  ) {
    return "This batch is closed. Wait for settle, then seal into the next open batch.";
  }
  if (lower.includes("insufficient funds")) {
    return "Not enough Sepolia ETH for gas.";
  }

  const short = e.shortMessage || e.message || String(error);
  if (short.length > 180) return short.slice(0, 180) + "…";
  return short;
}
