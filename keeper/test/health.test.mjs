import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { startHealthServer } from "../dist/health.js";

test("health server reports keeper status", async (t) => {
  const server = startHealthServer(0);
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "nettle-keeper",
  });
});
