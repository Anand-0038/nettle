/**
 * Sepolia production — Uniswap v4 residual path:
 *   UniswapV4Executor (PoolManager.swap)
 *   NettleHook (batch gate + v4 IHooks)
 *   IntentRegistry (Nox netting)
 *
 * Falls back to UniswapV3Executor if v4 pool/liquidity cannot be established.
 *
 * env: PRIVATE_KEY, RPC_URL?, KEEPER_ADDRESS?
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import hre from "hardhat";
import {
  getAddress,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  encodePacked,
  type Hex,
  type Address,
} from "viem";

const USDC = getAddress("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
const WETH = getAddress("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14");
const SWAP_ROUTER_02 = getAddress("0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E");
const V4_POOL_MANAGER = getAddress("0xE03A1074c86CFeDd5C142C4F04F1a1536e203543");
const NOX_COMPUTE = getAddress("0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF");
const POOL_FEE = 3000;
const TICK_SPACING = 60;
// 1:1 raw sqrtPriceX96 = 2^96 — fine for testnet residual smoke
const SQRT_PRICE_X96 = 79228162514264337593543950336n;
const HOOK_FLAGS = (1n << 7n) | (1n << 6n); // BEFORE_SWAP | AFTER_SWAP
const ALL_HOOK_MASK = (1n << 14n) - 1n;

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "s", type: "address" },
      { name: "a", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

function getArtifact(name: string) {
  // Hardhat 3 artifact path
  const candidates = [
    resolve(import.meta.dirname, `../artifacts/contracts/hooks/${name}.sol/${name}.json`),
    resolve(import.meta.dirname, `../artifacts/contracts/${name}.sol/${name}.json`),
    resolve(import.meta.dirname, `../artifacts/contracts/v4/${name}.sol/${name}.json`),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      /* next */
    }
  }
  throw new Error(`artifact not found: ${name}`);
}

function mineHookSalt(
  factory: Address,
  initCodeHash: Hex,
  flags: bigint
): { salt: Hex; address: Address } {
  for (let i = 0; i < 500_000; i++) {
    const salt = (`0x${i.toString(16).padStart(64, "0")}`) as Hex;
    const addr = getAddress(
      `0x${keccak256(
        encodePacked(
          ["bytes1", "address", "bytes32", "bytes32"],
          ["0xff", factory, salt, initCodeHash]
        )
      ).slice(26)}`
    );
    const bits = BigInt(addr) & ALL_HOOK_MASK;
    if (bits === (flags & ALL_HOOK_MASK)) {
      return { salt, address: addr };
    }
  }
  throw new Error("HookMiner: no salt found");
}

async function main() {
  const { viem } = await hre.network.connect();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  if (chainId !== 11155111) throw new Error(`Need Sepolia, got ${chainId}`);

  const keeper = (process.env.KEEPER_ADDRESS ??
    deployer.account.address) as Address;
  const token0 = USDC.toLowerCase() < WETH.toLowerCase() ? USDC : WETH;
  const token1 = USDC.toLowerCase() < WETH.toLowerCase() ? WETH : USDC;

  console.log("Deployer", deployer.account.address);
  console.log("token0", token0, "token1", token1);

  const gasPrice = ((await publicClient.getGasPrice()) * 130n) / 100n;
  const txOpts = { gasPrice, account: deployer.account } as const;

  // --- Prefer Uniswap v4 residual path ---
  let mode = "nox+hook+uniswap-v4-residual";
  let path =
    "Registry → NettleHook → UniswapV4Executor → PoolManager.swap (residual only)";
  let executorAddr: Address;
  let hookAddr: Address;
  let registryAddr: Address;
  let poolHooks: Address = "0x0000000000000000000000000000000000000000";
  let v3Fallback = false;

  try {
    const v4Exec = await viem.deployContract(
      "UniswapV4Executor",
      [V4_POOL_MANAGER, token0, token1, POOL_FEE, TICK_SPACING],
      txOpts as never
    );
    console.log("UniswapV4Executor", v4Exec.address);
    executorAddr = v4Exec.address;

    // CREATE2 factory + HookMiner for permissioned NettleHook address
    const factory = await viem.deployContract("Create2Factory", [], txOpts as never);
    console.log("Create2Factory", factory.address);

    const hookArt = getArtifact("NettleHook");
    const initCode = encodeDeployData({
      abi: hookArt.abi,
      bytecode: hookArt.bytecode as Hex,
      args: [
        V4_POOL_MANAGER,
        v4Exec.address,
        token0,
        token1,
        keeper,
      ],
    });
    const initCodeHash = keccak256(initCode);
    const mined = mineHookSalt(factory.address, initCodeHash, HOOK_FLAGS);
    console.log("Mined hook", mined.address, "salt", mined.salt);

    const deployHash = await deployer.writeContract({
      address: factory.address,
      abi: factory.abi,
      functionName: "deploy",
      args: [mined.salt, initCode],
      gasPrice,
    });
    await publicClient.waitForTransactionReceipt({ hash: deployHash });
    hookAddr = mined.address;
    console.log("NettleHook (CREATE2)", hookAddr);

    // Use mined hook as PoolKey.hooks so beforeSwap runs on residual swaps
    poolHooks = hookAddr;

    const registry = await viem.deployContract(
      "IntentRegistry",
      [token0, token1, hookAddr, keeper, 50n],
      txOpts as never
    );
    registryAddr = registry.address;
    console.log("IntentRegistry", registryAddr);

    // Wire hook.registry + v4 executor configure(hook, registry, poolHooks)
    const hookContract = await viem.getContractAt("NettleHook", hookAddr);
    await hookContract.write.setRegistry([registryAddr], txOpts as never);
    await v4Exec.write.configure(
      [hookAddr, registryAddr, poolHooks],
      txOpts as never
    );

    // Initialize pool (ignore if already exists)
    try {
      const initData = encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "initialize",
            stateMutability: "nonpayable",
            inputs: [
              {
                name: "key",
                type: "tuple",
                components: [
                  { name: "currency0", type: "address" },
                  { name: "currency1", type: "address" },
                  { name: "fee", type: "uint24" },
                  { name: "tickSpacing", type: "int24" },
                  { name: "hooks", type: "address" },
                ],
              },
              { name: "sqrtPriceX96", type: "uint160" },
            ],
            outputs: [{ type: "int24" }],
          },
        ],
        functionName: "initialize",
        args: [
          {
            currency0: token0,
            currency1: token1,
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: poolHooks,
          },
          SQRT_PRICE_X96,
        ],
      });
      const h = await deployer.sendTransaction({
        to: V4_POOL_MANAGER,
        data: initData,
        gasPrice,
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      console.log("Pool initialized with NettleHook");
    } catch (e) {
      console.log(
        "Pool initialize skipped/failed (may exist):",
        (e as Error).message?.slice(0, 120)
      );
    }

    // Bootstrap liquidity if we have balances
    try {
      const boot = await viem.deployContract(
        "V4LiquidityBootstrap",
        [V4_POOL_MANAGER],
        txOpts as never
      );
      // Wrap a bit of ETH → WETH for LP
      const ethBal = await publicClient.getBalance({
        address: deployer.account.address,
      });
      if (ethBal > 15_000_000_000_000_000n) {
        // 0.01 ETH
        const wrapHash = await deployer.writeContract({
          address: WETH,
          abi: erc20Abi,
          functionName: "deposit",
          value: 10_000_000_000_000_000n,
          gasPrice,
        });
        await publicClient.waitForTransactionReceipt({ hash: wrapHash });
        console.log("Wrapped 0.01 ETH → WETH");
      }

      const usdcBal = (await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [deployer.account.address],
      })) as bigint;
      const wethBal = (await publicClient.readContract({
        address: WETH,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [deployer.account.address],
      })) as bigint;

      const amount0 =
        token0.toLowerCase() === USDC.toLowerCase()
          ? usdcBal > 5_000_000n
            ? 5_000_000n
            : usdcBal / 2n
          : wethBal > 1_000_000_000_000_000n
            ? 1_000_000_000_000_000n
            : wethBal / 2n;
      const amount1 =
        token1.toLowerCase() === WETH.toLowerCase()
          ? wethBal > 1_000_000_000_000_000n
            ? 1_000_000_000_000_000n
            : wethBal / 2n
          : usdcBal > 5_000_000n
            ? 5_000_000n
            : usdcBal / 2n;

      if (amount0 > 0n && amount1 > 0n) {
        await deployer.writeContract({
          address: token0,
          abi: erc20Abi,
          functionName: "approve",
          args: [boot.address, amount0],
          gasPrice,
        });
        await deployer.writeContract({
          address: token1,
          abi: erc20Abi,
          functionName: "approve",
          args: [boot.address, amount1],
          gasPrice,
        });
        // Full-range ticks for spacing 60
        const tickLower = -887220;
        const tickUpper = 887220;
        const liq = 1_000_000_000_000n; // small
        const bh = await boot.write.bootstrap(
          [
            {
              currency0: token0,
              currency1: token1,
              fee: POOL_FEE,
              tickSpacing: TICK_SPACING,
              hooks: poolHooks,
            },
            amount0,
            amount1,
            liq,
            tickLower,
            tickUpper,
          ],
          txOpts as never
        );
        await publicClient.waitForTransactionReceipt({ hash: bh });
        console.log("Bootstrapped v4 liquidity", {
          amount0: amount0.toString(),
          amount1: amount1.toString(),
        });
      } else {
        console.log("Skip LP bootstrap — low token balances");
      }
    } catch (e) {
      console.log(
        "Liquidity bootstrap failed:",
        (e as Error).message?.slice(0, 200)
      );
    }
  } catch (e) {
    console.error("V4 deploy path failed, falling back to V3:", e);
    v3Fallback = true;
    mode = "nox+hook+uniswap-v3-residual-fallback";
    path =
      "Registry → NettleHook → UniswapV3Executor → SwapRouter02 (v4 path failed)";

    const amm = await viem.deployContract(
      "UniswapV3Executor",
      [token0, token1, SWAP_ROUTER_02, POOL_FEE],
      txOpts as never
    );
    executorAddr = amm.address;
    const hook = await viem.deployContract(
      "NettleHook",
      [V4_POOL_MANAGER, amm.address, token0, token1, keeper],
      txOpts as never
    );
    hookAddr = hook.address;
    const registry = await viem.deployContract(
      "IntentRegistry",
      [token0, token1, hook.address, keeper, 50n],
      txOpts as never
    );
    registryAddr = registry.address;
    await hook.write.setRegistry([registry.address], txOpts as never);
    await amm.write.configure([hook.address, registry.address], txOpts as never);
    console.log("V3 fallback registry", registryAddr);
  }

  const out = {
    chainId,
    mode,
    v3Fallback,
    deployer: deployer.account.address,
    keeper,
    token0,
    token1,
    usdc: USDC,
    weth: WETH,
    swapRouter02: SWAP_ROUTER_02,
    poolFee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    poolHooks,
    executor: executorAddr!,
    hook: hookAddr!,
    registry: registryAddr!,
    noxCompute: NOX_COMPUTE,
    v4PoolManager: V4_POOL_MANAGER,
    path,
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
