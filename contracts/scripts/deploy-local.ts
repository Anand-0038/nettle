import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import hre from "hardhat";

/** Burn nonce 0 so first contract is not 0x5FbDB… (Blockaid flag on public nets). */
async function burnNonce0(
  publicClient: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof hre.network.connect>>["viem"]["getPublicClient"]
    >
  >,
  deployer: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof hre.network.connect>>["viem"]["getWalletClients"]
    >
  >[0]
) {
  const hash = await deployer.sendTransaction({
    to: deployer.account.address,
    value: 0n,
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

async function main() {
  const { viem } = await hre.network.connect();
  const [deployer, keeper, traderA, traderB] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  console.log("Deployer:", deployer.account.address);
  await burnNonce0(publicClient, deployer);

  const token0 = await viem.deployContract("MockERC20", ["Mock USDC", "mUSDC", 6]);
  const token1 = await viem.deployContract("MockERC20", ["Mock WETH", "mWETH", 18]);
  const amm = await viem.deployContract("MockAMM", [token0.address, token1.address]);

  const usdcLiq = 1_000_000n * 10n ** 6n;
  const wethLiq = 500n * 10n ** 18n;
  await token0.write.mint([deployer.account.address, usdcLiq]);
  await token1.write.mint([deployer.account.address, wethLiq]);
  await token0.write.approve([amm.address, usdcLiq]);
  await token1.write.approve([amm.address, wethLiq]);
  await amm.write.seed([usdcLiq, wethLiq]);

  const traderUsdc = 50_000n * 10n ** 6n;
  const traderWeth = 20n * 10n ** 18n;
  for (const t of [traderA, traderB, deployer, keeper]) {
    await token0.write.mint([t.account.address, traderUsdc]);
    await token1.write.mint([t.account.address, traderWeth]);
  }

  // Local: registry → MockAMM directly (hook optional). Keep simple for unit tests.
  const registry = await viem.deployContract("MockIntentRegistry", [
    token0.address,
    token1.address,
    amm.address,
    keeper.account.address,
    15n,
  ]);

  const hook = await viem.deployContract("NettleHook", [
    deployer.account.address,
    amm.address,
    token0.address,
    token1.address,
    keeper.account.address,
  ]);
  await hook.write.setRegistry([registry.address]);

  const out = {
    chainId: Number(await publicClient.getChainId()),
    blockNumber: (await publicClient.getBlockNumber()).toString(),
    deployer: deployer.account.address,
    keeper: keeper.account.address,
    traderA: traderA.account.address,
    traderB: traderB.account.address,
    token0: token0.address,
    token1: token1.address,
    mockAmm: amm.address,
    registry: registry.address,
    hook: hook.address,
    epochDurationBlocks: "15",
    mode: "local-test",
  };

  const dir = resolve(import.meta.dirname, "../../deployments");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "local.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
