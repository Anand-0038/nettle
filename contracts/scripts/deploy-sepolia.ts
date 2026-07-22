/**
 * Sepolia production:
 *   UniswapV3Executor (residual AMM)
 *   NettleHook (gate — Registry must call through Hook)
 *   IntentRegistry (Nox matching book)
 *
 * env: PRIVATE_KEY, RPC_URL?, KEEPER_ADDRESS?
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import hre from "hardhat";
import { getAddress } from "viem";

const USDC = getAddress("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
const WETH = getAddress("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14");
const SWAP_ROUTER_02 = getAddress("0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E");
const POOL_FEE = 3000;
const NOX_COMPUTE = getAddress("0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF");
const V4_POOL_MANAGER = getAddress("0xE03A1074c86CFeDd5C142C4F04F1a1536e203543");

async function main() {
  const { viem } = await hre.network.connect();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  if (chainId !== 11155111) throw new Error(`Need Sepolia, got ${chainId}`);

  const keeper = (process.env.KEEPER_ADDRESS ?? deployer.account.address) as `0x${string}`;
  const token0 = USDC.toLowerCase() < WETH.toLowerCase() ? USDC : WETH;
  const token1 = USDC.toLowerCase() < WETH.toLowerCase() ? WETH : USDC;

  console.log("Deployer", deployer.account.address);
  console.log("token0", token0, "token1", token1);

  const gasPrice = ((await publicClient.getGasPrice()) * 130n) / 100n;

  // 1) Residual AMM adapter
  const amm = await viem.deployContract(
    "UniswapV3Executor",
    [token0, token1, SWAP_ROUTER_02, POOL_FEE],
    { gasPrice } as never
  );
  console.log("UniswapV3Executor", amm.address);

  // 2) Hook gate
  const hook = await viem.deployContract(
    "NettleHook",
    [V4_POOL_MANAGER, amm.address, token0, token1, keeper],
    { gasPrice } as never
  );
  console.log("NettleHook", hook.address);

  // 3) Matching registry (executor = hook)
  const registry = await viem.deployContract(
    "IntentRegistry",
    [token0, token1, hook.address, keeper, 50n],
    { gasPrice } as never
  );
  console.log("IntentRegistry", registry.address);

  // Wire: hook.registry, amm.configure(hook, registry)
  await hook.write.setRegistry([registry.address], { gasPrice } as never);
  await amm.write.configure([hook.address, registry.address], {
    gasPrice,
  } as never);

  const out = {
    chainId,
    mode: "matching-engine+hook+uniswap-v3-residual",
    deployer: deployer.account.address,
    keeper,
    token0,
    token1,
    usdc: USDC,
    weth: WETH,
    swapRouter02: SWAP_ROUTER_02,
    poolFee: POOL_FEE,
    executor: amm.address,
    hook: hook.address,
    registry: registry.address,
    noxCompute: NOX_COMPUTE,
    v4PoolManager: V4_POOL_MANAGER,
    path: "Registry → Hook → UniswapV3Executor → SwapRouter02 (residual only)",
  };

  const dir = resolve(import.meta.dirname, "../../deployments");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "sepolia.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
