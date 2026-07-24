import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import {
  startHealthServer,
  closeHealthServer,
  setHealthIdentity,
  setConfigValid,
  setNoxReady,
  setRegistryReadable,
  recordRpcSuccess,
  recordDecryptAttempt,
  clearDecryptBackoff,
  getHealthSnapshot,
  isReady,
  sanitizeError,
} from "../dist/health.js";

async function withServer(fn) {
  const server = startHealthServer(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await fn(address.port);
  } finally {
    await closeHealthServer(server);
  }
}

test("sanitizeError redacts api keys and private keys", () => {
  const s = sanitizeError(
    "failed https://eth-sepolia.g.alchemy.com/v2/supersecretKEY123 call 0x" +
      "a".repeat(64) +
      " Bearer tok_abc api_key=xyz"
  );
  assert.ok(!s.includes("supersecretKEY123"));
  assert.ok(!s.includes("tok_abc"));
  assert.ok(s.includes("/v2/***"));
  assert.ok(s.includes("0x***PRIVATE***") || s.includes("***"));
});

test("GET / returns Nettle Keeper", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "Nettle Keeper");
  });
});

test("GET unknown returns 404", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "not_found");
  });
});

test("health is live and ready after full checks", async () => {
  setConfigValid(true);
  setHealthIdentity({
    chainId: 11155111,
    registry: "0xd5d950a0b211afe67ad4e5a8f28804b42bc2b71f",
    keeperAddress: "0xfb76c4b6912bcf358752fb4b4b15b959efadd915",
    mode: "nox",
  });
  setNoxReady(true);
  setRegistryReadable(true, 14n);
  recordRpcSuccess(123n, 1_000_000_000_000_000n);
  clearDecryptBackoff();

  assert.equal(isReady(), true);
  const snap = getHealthSnapshot();
  assert.equal(snap.service, "nettle-keeper");
  assert.ok(snap.processStartedAt);
  assert.equal(snap.checks.configValid, true);
  assert.equal(snap.checks.rpcOk, true);
  assert.equal(snap.checks.registryReadable, true);
  assert.equal(snap.checks.noxReady, true);

  await withServer(async (port) => {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.chainId, 11155111);
    assert.ok(!JSON.stringify(healthBody).includes("PRIVATE"));

    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(ready.status, 200);
    const readyBody = await ready.json();
    assert.equal(readyBody.ready, true);
  });
});

test("ready is 503 when decrypt stuck or config invalid", async () => {
  setConfigValid(true);
  setHealthIdentity({
    chainId: 11155111,
    registry: "0xabc",
    keeperAddress: "0xdef",
    mode: "nox",
  });
  setNoxReady(true);
  setRegistryReadable(true, 1n);
  recordRpcSuccess(1n, 1n);
  recordDecryptAttempt(12, true, "not ready");

  assert.equal(isReady(), false);
  assert.equal(getHealthSnapshot().status, "degraded");

  await withServer(async (port) => {
    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(ready.status, 503);
    const body = await ready.json();
    assert.equal(body.ready, false);
    assert.equal(body.checks.notDecryptStuck, false);
  });

  setConfigValid(false);
  assert.equal(isReady(), false);
});

test("health remains 200 while not ready", async () => {
  setConfigValid(false);
  await withServer(async (port) => {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.status, "failed");
  });
});
