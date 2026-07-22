/**
 * Fallback local deployment addresses loaded at build time if present.
 * After `pnpm deploy:local`, copy deployments/local.json fields into .env.local
 * or rely on NEXT_PUBLIC_* env vars.
 */
export type LocalDeploy = {
  registry: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  keeper: `0x${string}`;
  mockAmm: `0x${string}`;
  chainId: number;
};

export function parseDeployEnv(): Partial<LocalDeploy> {
  return {
    registry: process.env.NEXT_PUBLIC_INTENT_REGISTRY_ADDRESS as
      | `0x${string}`
      | undefined,
    token0: process.env.NEXT_PUBLIC_TOKEN0_ADDRESS as
      | `0x${string}`
      | undefined,
    token1: process.env.NEXT_PUBLIC_TOKEN1_ADDRESS as
      | `0x${string}`
      | undefined,
  };
}
