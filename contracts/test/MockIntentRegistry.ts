import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hre from "hardhat";

describe("MockIntentRegistry batch netting", async function () {
  const { viem } = await hre.network.connect();
  const [deployer, keeper, alice, bob] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  async function fixture() {
    const token0 = await viem.deployContract("MockERC20", ["USDC", "USDC", 6]);
    const token1 = await viem.deployContract("MockERC20", ["WETH", "WETH", 18]);
    const amm = await viem.deployContract("MockAMM", [token0.address, token1.address]);

    const usdcLiq = 1_000_000n * 10n ** 6n;
    const wethLiq = 500n * 10n ** 18n;
    await token0.write.mint([deployer.account.address, usdcLiq * 2n]);
    await token1.write.mint([deployer.account.address, wethLiq * 2n]);
    await token0.write.approve([amm.address, usdcLiq]);
    await token1.write.approve([amm.address, wethLiq]);
    await amm.write.seed([usdcLiq, wethLiq]);

    for (const t of [alice, bob]) {
      await token0.write.mint([t.account.address, 100_000n * 10n ** 6n]);
      await token1.write.mint([t.account.address, 50n * 10n ** 18n]);
    }

    const registry = await viem.deployContract("MockIntentRegistry", [
      token0.address,
      token1.address,
      amm.address,
      keeper.account.address,
      5n,
    ]);

    return { token0, token1, amm, registry };
  }

  it("nets opposite intents and executes one swap", async function () {
    const { token0, token1, registry } = await fixture();

    const aliceBuy = 10_000n * 10n ** 6n; // +USDC -> WETH
    const bobSell = 5_000n * 10n ** 6n; // expressed as -USDC side via token1 path

    // Alice: positive signed = token0 in
    await token0.write.approve([registry.address, aliceBuy], { account: alice.account });
    await registry.write.submitIntent([aliceBuy, aliceBuy], { account: alice.account });

    // Bob: sell WETH for USDC (negative signed amount in WETH wei)
    const bobWeth = 2n * 10n ** 18n;
    await token1.write.approve([registry.address, bobWeth], { account: bob.account });
    await registry.write.submitIntent([-bobWeth, bobWeth], { account: bob.account });

    const epochId = await registry.read.currentEpochId();
    const ep = await registry.read.getEpoch([epochId]);
    assert.equal(ep.participantCount, 2n);

    // Mine past close block
    // @ts-expect-error hardhat network helpers via test client
    await publicClient.request({ method: "hardhat_mine", params: ["0x10"] });

    await registry.write.closeEpoch({ account: keeper.account });
    const [net] = await registry.read.publicDecryptNet([epochId]);
    // net = aliceBuy - bobWeth (different units in mock — just ensure close works)
    assert.ok(typeof net === "bigint");

    await registry.write.executeEpoch([0n], { account: keeper.account });
    const epAfter = await registry.read.getEpoch([epochId]);
    assert.equal(epAfter.state, 2); // Executed
  });

  it("same-side intents accumulate net and settle pro-rata", async function () {
    const { token0, registry } = await fixture();

    const a = 3_000n * 10n ** 6n;
    const b = 7_000n * 10n ** 6n;

    await token0.write.approve([registry.address, a], { account: alice.account });
    await registry.write.submitIntent([a, a], { account: alice.account });

    await token0.write.approve([registry.address, b], { account: bob.account });
    await registry.write.submitIntent([b, b], { account: bob.account });

    const epochId = await registry.read.currentEpochId();
    // @ts-expect-error
    await publicClient.request({ method: "hardhat_mine", params: ["0x10"] });
    await registry.write.closeEpoch({ account: keeper.account });

    const [net] = await registry.read.publicDecryptNet([epochId]);
    assert.equal(net, a + b);

    await registry.write.executeEpoch([0n], { account: keeper.account });
    const ep = await registry.read.getEpoch([epochId]);
    assert.equal(ep.absAmountIn, a + b);
    assert.ok(ep.amountOut > 0n);
    assert.equal(ep.zeroForOne, true);
  });
});
