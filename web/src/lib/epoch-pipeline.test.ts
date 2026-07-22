import assert from "node:assert/strict";
import test from "node:test";
import { getPipelineStageStates } from "./epoch-pipeline";

test("maps epoch lifecycle states to five readable pipeline stages", () => {
  assert.deepEqual(getPipelineStageStates(0), ["active", "pending", "pending", "pending", "pending"]);
  assert.deepEqual(getPipelineStageStates(1), ["complete", "complete", "active", "pending", "pending"]);
  assert.deepEqual(getPipelineStageStates(2), ["complete", "complete", "complete", "complete", "complete"]);
});
