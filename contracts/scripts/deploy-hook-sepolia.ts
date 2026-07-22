/**
 * Resume: deploy NettleHook only (executor+registry already live).
 * Uses elevated gas to avoid "replacement transaction underpriced".
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import hre from "hardhat";

const V4_POOL_MANAGER = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543" as const;
const REGISTRY = "0x1eb7Bc536aFd2cc28602d289A6F47DbDC3b9445f" as const;
const EXECUTOR = "0xfc2e1fb26a6ae1db07f3f748c9dcf2ef37ed3795" as const;

async function main() {
  const { viem } = await hre.network.connect();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  console.log("Deployer", deployer.account.address);
  const gasPrice = await publicClient.getGasPrice();
  // 50% bump for stuck nonces
  const maxFee = (gasPrice * 150n) / 100n;
  console.log("gasPrice", gasPrice.toString(), "using maxFee", maxFee.toString());

  const hook = await viem.deployContract(
    "NettleHook",
    [V4_POOL_MANAGER, REGISTRY, deployer.account.address],
    {
      gas: 800_000n,
      gasPrice: maxFee,
    } as never
  );
  console.log("NettleHook", hook.address);

  const out = {
    chainId: 11155111,
    mode: "nox+uniswap-v3",
    deployer: deployer.account.address,
    keeper: deployer.account.address,
    token0: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    token1: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    swapRouter02: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
    poolFee: 3000,
    executor: EXECUTOR,
    registry: REGISTRY,
    hook: hook.address,
    noxCompute: "0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF",
    v4PoolManager: V4_POOL_MANAGER,
    note: "zeroForOne = USDC->WETH; production no mocks",
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
