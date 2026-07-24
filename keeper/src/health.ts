import { createServer, type Server } from "node:http";

export type HealthStatus = "starting" | "ready" | "degraded" | "failed";

export type ReadinessChecks = {
  configValid: boolean;
  rpcOk: boolean;
  registryReadable: boolean;
  noxReady: boolean;
  notDecryptStuck: boolean;
};

export type HealthSnapshot = {
  service: "nettle-keeper";
  status: HealthStatus;
  processStartedAt: string;
  uptimeSec: number;
  chainId: number | null;
  mode: string | null;
  registry: string | null;
  keeperAddress: string | null;
  currentBlock: string | null;
  currentEpochId: string | null;
  lastTickStartedAt: string | null;
  lastTickSucceededAt: string | null;
  lastRpcSucceededAt: string | null;
  noxClientReady: boolean;
  consecutiveTickFailures: number;
  lastAction: string | null;
  lastTransactionHash: string | null;
  keeperBalanceWei: string | null;
  decrypt: {
    attempts: number;
    firstFailureAt: string | null;
    lastFailureAt: string | null;
    stuck: boolean;
  };
  checks: ReadinessChecks;
  lastError: string | null;
};

type MutableHealth = {
  processStartedAt: number;
  status: HealthStatus;
  chainId: number | null;
  mode: string | null;
  registry: string | null;
  keeperAddress: string | null;
  currentBlock: bigint | null;
  currentEpochId: bigint | null;
  lastTickStartedAt: number | null;
  lastTickSucceededAt: number | null;
  lastRpcSucceededAt: number | null;
  noxClientReady: boolean;
  consecutiveTickFailures: number;
  lastAction: string | null;
  lastTransactionHash: string | null;
  keeperBalanceWei: bigint | null;
  decryptAttempts: number;
  decryptFirstFailureAt: number | null;
  decryptLastFailureAt: number | null;
  decryptStuck: boolean;
  configValid: boolean;
  registryReadable: boolean;
  lastError: string | null;
  shuttingDown: boolean;
};

const state: MutableHealth = {
  processStartedAt: Date.now(),
  status: "starting",
  chainId: null,
  mode: null,
  registry: null,
  keeperAddress: null,
  currentBlock: null,
  currentEpochId: null,
  lastTickStartedAt: null,
  lastTickSucceededAt: null,
  lastRpcSucceededAt: null,
  noxClientReady: false,
  consecutiveTickFailures: 0,
  lastAction: null,
  lastTransactionHash: null,
  keeperBalanceWei: null,
  decryptAttempts: 0,
  decryptFirstFailureAt: null,
  decryptLastFailureAt: null,
  decryptStuck: false,
  configValid: false,
  registryReadable: false,
  lastError: null,
  shuttingDown: false,
};

/** Strip secrets/URLs that may embed API keys from error strings. */
export function sanitizeError(raw: string, max = 280): string {
  let s = raw.replace(/\s+/g, " ").trim();
  // Alchemy / Infura / generic API key path segments
  s = s.replace(/\/v2\/[A-Za-z0-9_-]+/gi, "/v2/***");
  s = s.replace(/\/v3\/[A-Za-z0-9_-]+/gi, "/v3/***");
  s = s.replace(/0x[a-fA-F0-9]{64}/g, "0x***PRIVATE***");
  s = s.replace(
    /(api[_-]?key|private[_-]?key|secret|token|authorization)[=:]\s*["']?[^"'&\s]+/gi,
    "$1=***"
  );
  s = s.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
  if (s.length > max) s = s.slice(0, max) + "…";
  return s;
}

function iso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

export function getReadinessChecks(): ReadinessChecks {
  return {
    configValid: state.configValid,
    rpcOk: state.lastRpcSucceededAt != null,
    registryReadable: state.registryReadable,
    noxReady: state.mode !== "nox" || state.noxClientReady,
    notDecryptStuck: !state.decryptStuck,
  };
}

export function isReady(): boolean {
  if (state.shuttingDown) return false;
  const c = getReadinessChecks();
  return (
    c.configValid &&
    c.rpcOk &&
    c.registryReadable &&
    c.noxReady &&
    c.notDecryptStuck
  );
}

function recomputeStatus() {
  if (state.shuttingDown) {
    state.status = "failed";
    return;
  }
  if (!state.configValid) {
    state.status = "failed";
    return;
  }
  if (isReady() && state.consecutiveTickFailures === 0 && !state.lastError) {
    state.status = "ready";
    return;
  }
  if (state.lastRpcSucceededAt != null || state.noxClientReady) {
    state.status = "degraded";
    return;
  }
  if (state.lastError) {
    state.status = "failed";
    return;
  }
  state.status = "starting";
}

export function getHealthSnapshot(): HealthSnapshot {
  recomputeStatus();
  return {
    service: "nettle-keeper",
    status: state.status,
    processStartedAt: new Date(state.processStartedAt).toISOString(),
    uptimeSec: Math.floor((Date.now() - state.processStartedAt) / 1000),
    chainId: state.chainId,
    mode: state.mode,
    registry: state.registry,
    keeperAddress: state.keeperAddress,
    currentBlock:
      state.currentBlock == null ? null : state.currentBlock.toString(),
    currentEpochId:
      state.currentEpochId == null ? null : state.currentEpochId.toString(),
    lastTickStartedAt: iso(state.lastTickStartedAt),
    lastTickSucceededAt: iso(state.lastTickSucceededAt),
    lastRpcSucceededAt: iso(state.lastRpcSucceededAt),
    noxClientReady: state.noxClientReady,
    consecutiveTickFailures: state.consecutiveTickFailures,
    lastAction: state.lastAction,
    lastTransactionHash: state.lastTransactionHash,
    keeperBalanceWei:
      state.keeperBalanceWei == null
        ? null
        : state.keeperBalanceWei.toString(),
    decrypt: {
      attempts: state.decryptAttempts,
      firstFailureAt: iso(state.decryptFirstFailureAt),
      lastFailureAt: iso(state.decryptLastFailureAt),
      stuck: state.decryptStuck,
    },
    checks: getReadinessChecks(),
    lastError: state.lastError,
  };
}

export function setConfigValid(ok: boolean) {
  state.configValid = ok;
  recomputeStatus();
}

export function setHealthIdentity(opts: {
  chainId: number;
  registry: string;
  keeperAddress: string;
  mode: string;
}) {
  state.chainId = opts.chainId;
  state.registry = opts.registry;
  state.keeperAddress = opts.keeperAddress;
  state.mode = opts.mode;
  recomputeStatus();
}

export function setNoxReady(ready: boolean) {
  state.noxClientReady = ready;
  recomputeStatus();
}

export function setRegistryReadable(ok: boolean, epochId?: bigint) {
  state.registryReadable = ok;
  if (epochId !== undefined) state.currentEpochId = epochId;
  recomputeStatus();
}

export function recordTickStart() {
  state.lastTickStartedAt = Date.now();
}

export function recordTickSuccess() {
  state.lastTickSucceededAt = Date.now();
  state.consecutiveTickFailures = 0;
  recomputeStatus();
}

export function recordTickFailure(err: string) {
  state.consecutiveTickFailures += 1;
  state.lastError = sanitizeError(err);
  recomputeStatus();
}

export function recordRpcSuccess(block: bigint, balanceWei?: bigint) {
  state.lastRpcSucceededAt = Date.now();
  state.currentBlock = block;
  if (balanceWei !== undefined) state.keeperBalanceWei = balanceWei;
  recomputeStatus();
}

export function recordAction(action: string, txHash?: string) {
  state.lastAction = action;
  state.lastTickSucceededAt = Date.now();
  state.consecutiveTickFailures = 0;
  if (txHash) state.lastTransactionHash = txHash;
  state.lastError = null;
  recomputeStatus();
}

export function recordDecryptAttempt(
  attempts: number,
  stuck: boolean,
  err?: string
) {
  state.decryptAttempts = attempts;
  const now = Date.now();
  if (attempts === 0) {
    state.decryptFirstFailureAt = null;
    state.decryptLastFailureAt = null;
    state.decryptStuck = false;
    recomputeStatus();
    return;
  }
  if (state.decryptFirstFailureAt == null) state.decryptFirstFailureAt = now;
  state.decryptLastFailureAt = now;
  state.decryptStuck = stuck;
  if (err) state.lastError = sanitizeError(err);
  recomputeStatus();
}

export function clearDecryptBackoff() {
  recordDecryptAttempt(0, false);
}

export function recordError(err: string) {
  state.lastError = sanitizeError(err);
  recomputeStatus();
}

export function markShuttingDown() {
  state.shuttingDown = true;
  recomputeStatus();
}

export function startHealthServer(port: number): Server {
  const server = createServer((request, response) => {
    const url = request.url?.split("?")[0] ?? "/";

    if (url === "/health") {
      const body = getHealthSnapshot();
      // Liveness: always 200 while process is up (Render free-tier friendly).
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
      return;
    }

    if (url === "/ready") {
      const body = getHealthSnapshot();
      const ready = isReady();
      response.writeHead(ready ? 200 : 503, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ ...body, ready }));
      return;
    }

    if (url === "/" || url === "") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("Nettle Keeper");
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ error: "not_found", paths: ["/", "/health", "/ready"] })
    );
  });

  server.listen(port, "0.0.0.0", () => {
    // intentional early bind for Render port detection
    console.log(
      JSON.stringify({
        level: "info",
        msg: "health_listen",
        port,
        host: "0.0.0.0",
      })
    );
  });

  return server;
}

export function closeHealthServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
