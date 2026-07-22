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
  const e = error as { shortMessage?: string; message?: string };
  const raw = e.shortMessage || e.message || String(error);
  // Strip noisy viem stack paths
  if (raw.includes("User rejected") || raw.includes("User denied")) {
    return "Request cancelled in wallet — nothing was sent.";
  }
  if (raw.length > 180) return raw.slice(0, 180) + "…";
  return raw;
}
