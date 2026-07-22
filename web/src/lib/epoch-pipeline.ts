export type PipelineStageState = "active" | "complete" | "pending";

export function getPipelineStageStates(
  epochState: number
): PipelineStageState[] {
  if (epochState >= 2) {
    return ["complete", "complete", "complete", "complete", "complete"];
  }

  if (epochState === 1) {
    return ["complete", "complete", "active", "pending", "pending"];
  }

  return ["active", "pending", "pending", "pending", "pending"];
}
