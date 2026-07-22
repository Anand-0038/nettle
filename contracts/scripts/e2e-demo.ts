/**
 * End-to-end local demo: two traders submit opposite/same-side intents,
 * mine past epoch, close + execute as keeper.
 */
import hre from "hardhat";

async function main() {
  const { viem } = await hre.network.connect();
  const [deployer, keeper, alice, bob] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const registryAddr = process.env.INTENT_REGISTRY_ADDRESS as `0x${string}`;
  const token0Addr = process.env.TOKEN0_ADDRESS as `0x${string}`;
  const token1Addr = process.env.TOKEN1_ADDRESS as `0x${string}`;
  if (!registryAddr || !token0Addr) {
    throw new Error("Set INTENT_REGISTRY_ADDRESS TOKEN0_ADDRESS TOKEN1_ADDRESS");
  }

  const registry = await viem.getContractAt("MockIntentRegistry", registryAddr);
  const token0 = await viem.getContractAt("MockERC20", token0Addr);
  const token1 = await viem.getContractAt("MockERC20", token1Addr);

  const a = 5_000n * 10n ** 6n;
  const b = 3_000n * 10n ** 6n;

  await token0.write.approve([registryAddr, a], { account: alice.account });
  await registry.write.submitIntent([a, a], { account: alice.account });
  console.log("Alice submitted +", a.toString());

  await token0.write.approve([registryAddr, b], { account: bob.account });
  await registry.write.submitIntent([b, b], { account: bob.account });
  console.log("Bob submitted +", b.toString());

  const epochId = await registry.read.currentEpochId();
  const ep = await registry.read.getEpoch([epochId]);
  console.log("Epoch", epochId.toString(), "participants", ep.participantCount.toString());

  // Mine past close
  const blocksToMine = Number(ep.closeBlock - (await publicClient.getBlockNumber()) + 1n);
  for (let i = 0; i < Math.max(blocksToMine, 1); i++) {
    await publicClient.request({ method: "evm_mine", params: [] } as never);
  }

  await registry.write.closeEpoch({ account: keeper.account });
  const [net] = await registry.read.publicDecryptNet([epochId]);
  console.log("Public net", net.toString());

  await registry.write.executeEpoch([0n], { account: keeper.account });
  const done = await registry.read.getEpoch([epochId]);
  console.log("Executed amountIn", done.absAmountIn.toString(), "amountOut", done.amountOut.toString());
  console.log("E2E OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
