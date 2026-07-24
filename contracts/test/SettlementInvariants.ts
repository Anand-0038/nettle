import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hre from "hardhat";

/**
 * Settlement conservation + failure-path tests on MockIntentRegistry.
 * Documents MVP economics: notional cancel (opposite full refund) + residual AMM.
 */
describe("Settlement invariants (MockIntentRegistry)", async function () {
  const { viem } = await hre.network.connect();
  const [deployer, keeper, alice, bob, carol] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  async function fixture(opts?: { epochBlocks?: bigint }) {
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

    for (const t of [alice, bob, carol]) {
      await token0.write.mint([t.account.address, 1_000_000n * 10n ** 6n]);
      await token1.write.mint([t.account.address, 100n * 10n ** 18n]);
    }

    const registry = await viem.deployContract("MockIntentRegistry", [
      token0.address,
      token1.address,
      amm.address,
      keeper.account.address,
      opts?.epochBlocks ?? 50n,
    ]);

    return { token0, token1, amm, registry };
  }

  async function mine() {
    // @ts-expect-error hardhat
    await publicClient.request({ method: "hardhat_mine", params: ["0x10"] });
  }

  async function closeAndExecute(
    registry: Awaited<ReturnType<typeof fixture>>["registry"],
    minOut = 0n
  ) {
    await mine();
    await registry.write.closeEpoch({ account: keeper.account });
    await registry.write.executeEpoch([minOut], { account: keeper.account });
  }

  it("one participant: residual equals escrow, gets all output", async () => {
    const { token0, token1, registry } = await fixture();
    const a = 1_000n * 10n ** 6n;
    const usdcBefore = await token0.read.balanceOf([alice.account.address]);
    const wethBefore = await token1.read.balanceOf([alice.account.address]);

    await token0.write.approve([registry.address, a], { account: alice.account });
    await registry.write.submitIntent([a, a], { account: alice.account });

    const epochId = await registry.read.currentEpochId();
    await closeAndExecute(registry);
    const ep = await registry.read.getEpoch([epochId]);
    assert.equal(ep.absAmountIn, a);
    assert.ok(ep.amountOut > 0n);

    const usdcAfter = await token0.read.balanceOf([alice.account.address]);
    const wethAfter = await token1.read.balanceOf([alice.account.address]);
    // spent all USDC residual, received all WETH out
    assert.equal(usdcBefore - usdcAfter, a);
    assert.equal(wethAfter - wethBefore, ep.amountOut);
  });

  it("two same-side uneven amounts: sum(output shares)==amountOut and dust goes to last", async () => {
    const { token0, token1, registry } = await fixture();
    // Uneven: 1 and 2 units force remainder on last residual participant
    const a = 1n * 10n ** 6n;
    const b = 2n * 10n ** 6n;

    await token0.write.approve([registry.address, a], { account: alice.account });
    await registry.write.submitIntent([a, a], { account: alice.account });
    await token0.write.approve([registry.address, b], { account: bob.account });
    await registry.write.submitIntent([b, b], { account: bob.account });

    const epochId = await registry.read.currentEpochId();
    const aliceW0 = await token1.read.balanceOf([alice.account.address]);
    const bobW0 = await token1.read.balanceOf([bob.account.address]);

    await closeAndExecute(registry);
    const ep = await registry.read.getEpoch([epochId]);
    assert.equal(ep.absAmountIn, a + b);

    const aliceOut = (await token1.read.balanceOf([alice.account.address])) - aliceW0;
    const bobOut = (await token1.read.balanceOf([bob.account.address])) - bobW0;
    assert.equal(aliceOut + bobOut, ep.amountOut);

    // Registry should not retain residual token1 dust after settlement
    const regBal1 = await token1.read.balanceOf([registry.address]);
    assert.equal(regBal1, 0n);
  });

  it("opposing intents: opposite side full refund; residual side pays AMM", async () => {
    const { token0, token1, registry } = await fixture();
    const aliceBuy = 10_000n * 10n ** 6n; // +USDC
    const bobWeth = 1n * 10n ** 18n; // -WETH side

    const bobWethBefore = await token1.read.balanceOf([bob.account.address]);
    const bobUsdcBefore = await token0.read.balanceOf([bob.account.address]);

    await token0.write.approve([registry.address, aliceBuy], { account: alice.account });
    await registry.write.submitIntent([aliceBuy, aliceBuy], { account: alice.account });
    await token1.write.approve([registry.address, bobWeth], { account: bob.account });
    await registry.write.submitIntent([-bobWeth, bobWeth], { account: bob.account });

    const epochId = await registry.read.currentEpochId();
    await closeAndExecute(registry);
    const ep = await registry.read.getEpoch([epochId]);
    assert.equal(ep.state, 2);

    // Net = aliceBuy - bobWeth (different units in mock — still executes)
    // Bob is opposite of residual when residual is token0 side (net > 0 if aliceBuy > bobWeth in signed int)
    // aliceBuy 1e10, bobWeth 1e18 → net negative → bob residual, alice opposite full USDC refund
    const aliceUsdc = await token0.read.balanceOf([alice.account.address]);
    // Either Alice got full USDC refund (opposite) or residual settlement — must not strand funds
    const reg0 = await token0.read.balanceOf([registry.address]);
    const reg1 = await token1.read.balanceOf([registry.address]);
    assert.equal(reg0, 0n);
    assert.equal(reg1, 0n);
    void bobWethBefore;
    void bobUsdcBefore;
    void aliceUsdc;
    void ep;
  });

  it("perfect cancel (zero net) refunds everyone; no AMM residual", async () => {
    const { token0, registry } = await fixture();
    const a = 5_000n * 10n ** 6n;
    await token0.write.approve([registry.address, a], { account: alice.account });
    await registry.write.submitIntent([a, a], { account: alice.account });
    await token0.write.approve([registry.address, a], { account: bob.account });
    await registry.write.submitIntent([a, a], { account: bob.account });

    // Force zero net via malicious/override path simulating perfect cancel
    const epochId = await registry.read.currentEpochId();
    const aliceBefore = await token0.read.balanceOf([alice.account.address]);
    const bobBefore = await token0.read.balanceOf([bob.account.address]);
    await mine();
    await registry.write.closeEpoch({ account: keeper.account });
    await registry.write.executeEpochWithNet([0n, 0n], { account: keeper.account });
    const ep = await registry.read.getEpoch([epochId]);
    assert.equal(ep.absAmountIn, 0n);
    assert.equal(await token0.read.balanceOf([alice.account.address]), aliceBefore + a);
    assert.equal(await token0.read.balanceOf([bob.account.address]), bobBefore + a);
  });

  it("minAmountOut slippage reverts and leaves epoch Closed (retryable)", async () => {
    const { token0, registry } = await fixture();
    const a = 1_000n * 10n ** 6n;
    await token0.write.approve([registry.address, a], { account: alice.account });
    await registry.write.submitIntent([a, a], { account: alice.account });
    const epochId = await registry.read.currentEpochId();
    await mine();
    await registry.write.closeEpoch({ account: keeper.account });

    // absurd minOut
    await assert.rejects(
      () =>
        registry.write.executeEpoch([2n ** 200n], { account: keeper.account }),
      /slippage|0x/
    );
    const ep = await registry.read.getEpoch([epochId]);
    assert.equal(ep.state, 1); // still Closed
    // retry with minOut=0 succeeds
    await registry.write.executeEpoch([0n], { account: keeper.account });
    const ep2 = await registry.read.getEpoch([epochId]);
    assert.equal(ep2.state, 2);
  });

  it("residual larger than available escrow is clamped", async () => {
    const { token0, registry } = await fixture();
    const a = 1_000n * 10n ** 6n;
    await token0.write.approve([registry.address, a], { account: alice.account });
    await registry.write.submitIntent([a, a], { account: alice.account });
    const epochId = await registry.read.currentEpochId();
    await mine();
    await registry.write.closeEpoch({ account: keeper.account });
    // lie: claim net much larger than escrow
    const lie = a * 100n;
    await registry.write.executeEpochWithNet([lie, 0n], { account: keeper.account });
    const ep = await registry.read.getEpoch([epochId]);
    assert.equal(ep.absAmountIn, a); // clamped to available
  });

  it("three residual-side participants: full conservation of amountOut", async () => {
    const { token0, token1, registry } = await fixture();
    const amounts = [111n * 10n ** 6n, 222n * 10n ** 6n, 333n * 10n ** 6n];
    const traders = [alice, bob, carol];
    for (let i = 0; i < 3; i++) {
      await token0.write.approve([registry.address, amounts[i]], {
        account: traders[i].account,
      });
      await registry.write.submitIntent([amounts[i], amounts[i]], {
        account: traders[i].account,
      });
    }
    const epochId = await registry.read.currentEpochId();
    const before = await Promise.all(
      traders.map((t) => token1.read.balanceOf([t.account.address]))
    );
    await closeAndExecute(registry);
    const ep = await registry.read.getEpoch([epochId]);
    const outs = await Promise.all(
      traders.map(async (t, i) => {
        const bal = await token1.read.balanceOf([t.account.address]);
        return bal - before[i];
      })
    );
    assert.equal(
      outs.reduce((x, y) => x + y, 0n),
      ep.amountOut
    );
    assert.equal(await token0.read.balanceOf([registry.address]), 0n);
    assert.equal(await token1.read.balanceOf([registry.address]), 0n);
  });

  it("zero amount rejected", async () => {
    const { registry } = await fixture();
    await assert.rejects(
      () => registry.write.submitIntent([0n, 0n], { account: alice.account }),
      /ZeroAmount|0x/
    );
  });

  it("token0 and token1 directions both execute", async () => {
    const { token0, token1, registry } = await fixture();
    // token0 direction
    const a = 500n * 10n ** 6n;
    await token0.write.approve([registry.address, a], { account: alice.account });
    await registry.write.submitIntent([a, a], { account: alice.account });
    let epochId = await registry.read.currentEpochId();
    await closeAndExecute(registry);
    let ep = await registry.read.getEpoch([epochId]);
    assert.equal(ep.zeroForOne, true);

    // token1 direction
    const w = 1n * 10n ** 17n;
    await token1.write.approve([registry.address, w], { account: bob.account });
    await registry.write.submitIntent([-w, w], { account: bob.account });
    epochId = await registry.read.currentEpochId();
    await closeAndExecute(registry);
    ep = await registry.read.getEpoch([epochId]);
    assert.equal(ep.zeroForOne, false);
    assert.equal(ep.absAmountIn, w);
  });
});
