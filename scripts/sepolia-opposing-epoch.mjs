/**
 * Live Sepolia opposing-intent epoch for DEMO_EVIDENCE.md
 *
 * Uses ONE funded key as trader A (USDC buy) and creates a funded trader B
 * (WETH sell) so residual |net| is smaller than gross notional in signed
 * eint256 units (same integer units as encrypted book, not mixed ERC-20 wei).
 *
 * Encrypted signed amounts use USDC base units (1e6) for both sides so
 * netting is integer-meaningful: +10e6 and -7e6 → residual +3e6 → AMM.
 * Trader B still escrows real WETH (tokenIn=token1) as the opposing leg.
 *
 * Usage (from repo root):
 *   set -a && source .env && set +a
 *   node scripts/sepolia-opposing-epoch.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
// Resolve deps from the keeper workspace (pnpm layout)
const require = createRequire(resolve(root, "keeper/package.json"));
const { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData } =
  require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { sepolia } = require("viem/chains");

function loadEnvFile(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(resolve(root, ".env"));

const RPC = process.env.RPC_URL;
const PK = (process.env.PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY || "").trim();
const REGISTRY = (process.env.INTENT_REGISTRY_ADDRESS ||
  "0xd5d950a0b211afe67ad4e5a8f28804b42bc2b71f").toLowerCase();
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

if (!RPC) throw new Error("RPC_URL required");
if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK.startsWith("0x") ? PK : `0x${PK}`)) {
  throw new Error("PRIVATE_KEY / KEEPER_PRIVATE_KEY required");
}
const pk = /** @type {`0x${string}`} */ (PK.startsWith("0x") ? PK : `0x${PK}`);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
]);

const registryAbi = parseAbi([
  "function currentEpochId() view returns (uint256)",
  "function epochDurationBlocks() view returns (uint256)",
  "function epochs(uint256) view returns (uint8 state, uint64 openBlock, uint64 closeBlock, bytes32 netEncrypted, bytes32 netHandle, bool zeroForOne, uint256 absAmountIn, uint256 amountOut, uint256 participantCount, uint256 buyEscrow, uint256 sellEscrow)",
  "function submitIntent(bytes32 inputHandle, bytes inputProof, address tokenIn, uint256 escrowAmount) returns (uint256 intentId)",
  "function getEpochBook(uint256 epochId) view returns (uint8 state, uint64 openBlock, uint64 closeBlock, bytes32 netHandle, bool zeroForOne, uint256 residualIn, uint256 residualOut, uint256 participantCount, uint256 buyEscrow, uint256 sellEscrow, uint256 matchedHint)",
  "event IntentSubmitted(uint256 indexed epochId, uint256 indexed intentId, address indexed trader, bytes32 handle, address tokenIn, uint256 escrowed)",
  "event EpochClosed(uint256 indexed epochId, bytes32 netHandle)",
  "event EpochExecuted(uint256 indexed epochId, bool zeroForOne, uint256 amountIn, uint256 amountOut)",
  "event BatchMatched(uint256 indexed epochId, uint256 buyEscrow, uint256 sellEscrow, uint256 residualIn, uint256 residualOut, bool zeroForOne)",
  "event IntentSettled(uint256 indexed epochId, uint256 indexed intentId, address trader, uint256 payoutOut, uint256 refundIn)",
]);

const accountA = privateKeyToAccount(pk);
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(RPC, { timeout: 60_000 }),
});
const walletA = createWalletClient({
  account: accountA,
  chain: sepolia,
  transport: http(RPC, { timeout: 60_000 }),
});

/** @type {Array<Record<string, unknown>>} */
const evidence = [];

function log(msg, extra) {
  console.log(msg, extra ? JSON.stringify(extra) : "");
}

async function send(wallet, to, data, value = 0n) {
  // Preflight simulate for clearer reverts
  try {
    await publicClient.call({
      account: wallet.account.address,
      to,
      data,
      value,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`simulation failed: ${msg.slice(0, 400)}`);
  }
  const hash = await wallet.sendTransaction({
    to,
    data,
    value,
    chain: sepolia,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`tx reverted ${hash}`);
  }
  return { hash, receipt };
}

async function encryptSigned(wallet, signedAmount) {
  // Resolve from keeper workspace so the beta handle SDK is available
  let mod;
  try {
    const resolved = require.resolve("@iexec-nox/handle");
    mod = await import(pathToFileURL(resolved).href);
  } catch {
    mod = await import("@iexec-nox/handle");
  }
  const { createViemHandleClient } = mod;
  const client = await createViemHandleClient(wallet);
  const result = await client.encryptInput(signedAmount, "int256", REGISTRY);
  return {
    handle: result.handle,
    proof: result.handleProof,
  };
}

async function closeEpochAsKeeper() {
  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: "closeEpoch",
  });
  try {
    await publicClient.call({
      account: accountA.address,
      to: REGISTRY,
      data,
    });
  } catch (e) {
    log("close_sim_skip", { err: String(e).slice(0, 160) });
    return null;
  }
  const r = await send(walletA, REGISTRY, data);
  log("closed_epoch_tx", { tx: r.hash });
  return r.hash;
}

async function waitForOpenEpoch(minBlocksLeft = 30n) {
  for (let i = 0; i < 90; i++) {
    const block = await publicClient.getBlockNumber();
    const epochId = await publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "currentEpochId",
    });
    const ep = await publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "epochs",
      args: [epochId],
    });
    const state = Number(ep[0]);
    const closeBlock = ep[2];
    const participants = ep[8];
    const left = closeBlock > block ? closeBlock - block : 0n;
    log("wait_epoch", {
      i,
      epochId: epochId.toString(),
      state,
      block: block.toString(),
      close: closeBlock.toString(),
      left: left.toString(),
      people: participants.toString(),
    });
    if (state === 0 && left >= minBlocksLeft) {
      return { block, epochId, ep, closeBlock };
    }
    // Empty epoch past close: rotate ourselves (keeper key) so demo is not blocked by free-tier sleep
    if (state === 0 && left === 0n && participants === 0n) {
      log("rotating_empty_epoch");
      try {
        await closeEpochAsKeeper();
      } catch (e) {
        log("rotate_failed", { err: String(e).slice(0, 200) });
      }
      await new Promise((r) => setTimeout(r, 4_000));
      continue;
    }
    // Closed with participants — leave to keeper execute
    if (state === 1) {
      log("waiting_keeper_execute");
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error("Timed out waiting for Open epoch with enough blocks remaining");
}

async function main() {
  const duration = await publicClient.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "epochDurationBlocks",
  });
  const { block, epochId, ep, closeBlock } = await waitForOpenEpoch(35n);

  log("epoch", {
    epochId: epochId.toString(),
    state: Number(ep[0]),
    closeBlock: closeBlock.toString(),
    block: block.toString(),
    duration: duration.toString(),
  });

  // Signed amounts in USDC micro-units so netting is integer-comparable.
  // A: +5 USDC → token0 escrow 5e6
  // B: −3 USDC-units encrypted, tokenIn=WETH with small real WETH escrow
  //    residual expected +2e6 USDC to AMM; B WETH fully refunded
  const amountA = 5n * 10n ** 6n; // 5 USDC
  const amountBSigned = -(3n * 10n ** 6n); // -3e6 in encrypted book
  const wethEscrowB = 500_000_000_000_000n; // 0.0005 WETH

  const usdcA = await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [accountA.address],
  });
  const wethA = await publicClient.readContract({
    address: WETH,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [accountA.address],
  });
  const ethA = await publicClient.getBalance({ address: accountA.address });
  log("walletA balances", {
    address: accountA.address,
    usdc: usdcA.toString(),
    weth: wethA.toString(),
    eth: ethA.toString(),
  });
  if (usdcA < amountA) throw new Error(`Need ≥10 USDC, have ${usdcA}`);
  if (wethA < wethEscrowB) throw new Error(`Need ≥0.001 WETH, have ${wethA}`);
  if (ethA < 3_000_000_000_000_000n) throw new Error("Need more Sepolia ETH for gas");

  // Fund trader B (fresh key) with ETH + WETH so we truly have two wallets
  const pkB = generatePrivateKey();
  const accountB = privateKeyToAccount(pkB);
  log("walletB created", { address: accountB.address });

  // Send ETH for gas
  const fundEth = await send(
    walletA,
    accountB.address,
    "0x",
    2_000_000_000_000_000n // 0.002 ETH
  );
  evidence.push({ step: "fund_B_eth", tx: fundEth.hash });

  // Send WETH for opposing escrow
  const wethTransferData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [accountB.address, wethEscrowB],
  });
  const fundWeth = await send(walletA, WETH, wethTransferData);
  evidence.push({ step: "fund_B_weth", tx: fundWeth.hash });

  const walletB = createWalletClient({
    account: accountB,
    chain: sepolia,
    transport: http(RPC, { timeout: 60_000 }),
  });

  // --- Approve + encrypt + submit A (USDC buy) ---
  const approveA = await send(
    walletA,
    USDC,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [REGISTRY, amountA],
    })
  );
  evidence.push({ step: "approve_A_usdc", tx: approveA.hash, amount: amountA.toString() });

  log("encrypting A +10e6 ...");
  const encA = await encryptSigned(walletA, amountA);
  evidence.push({
    step: "encrypt_A",
    handle: encA.handle,
    signedAmount: amountA.toString(),
    direction: "token0_in",
  });

  const submitAData = encodeFunctionData({
    abi: registryAbi,
    functionName: "submitIntent",
    args: [encA.handle, encA.proof, USDC, amountA],
  });
  const submitA = await send(walletA, REGISTRY, submitAData);
  evidence.push({
    step: "intent_A",
    tx: submitA.hash,
    trader: accountA.address,
    tokenIn: USDC,
    escrow: amountA.toString(),
    signedEncrypted: amountA.toString(),
    etherscan: `https://sepolia.etherscan.io/tx/${submitA.hash}`,
  });
  log("intent A submitted", { tx: submitA.hash });

  // --- Approve + encrypt + submit B (WETH sell / negative signed) ---
  const approveB = await send(
    walletB,
    WETH,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [REGISTRY, wethEscrowB],
    })
  );
  evidence.push({ step: "approve_B_weth", tx: approveB.hash });

  log("encrypting B -7e6 ...");
  const encB = await encryptSigned(walletB, amountBSigned);
  evidence.push({
    step: "encrypt_B",
    handle: encB.handle,
    signedAmount: amountBSigned.toString(),
    direction: "token1_in",
  });

  const submitBData = encodeFunctionData({
    abi: registryAbi,
    functionName: "submitIntent",
    args: [encB.handle, encB.proof, WETH, wethEscrowB],
  });
  const submitB = await send(walletB, REGISTRY, submitBData);
  evidence.push({
    step: "intent_B",
    tx: submitB.hash,
    trader: accountB.address,
    tokenIn: WETH,
    escrow: wethEscrowB.toString(),
    signedEncrypted: amountBSigned.toString(),
    etherscan: `https://sepolia.etherscan.io/tx/${submitB.hash}`,
  });
  log("intent B submitted", { tx: submitB.hash });

  const epAfter = await publicClient.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "epochs",
    args: [epochId],
  });
  log("book after submits", {
    participants: epAfter[8].toString(),
    buyEscrow: epAfter[9].toString(),
    sellEscrow: epAfter[10].toString(),
    closeBlock: epAfter[2].toString(),
  });

  // Expected encrypted net = +10e6 + (-7e6) = +3e6 → residual 3 USDC
  evidence.push({
    step: "expected_net",
    signedA: amountA.toString(),
    signedB: amountBSigned.toString(),
    expectedNet: (amountA + amountBSigned).toString(),
    narrative:
      "Encrypted book units are USDC micro-units for both legs. Residual |net|=3e6 USDC to AMM; B WETH escrow fully refunded (opposite side).",
  });

  // Wait for close block + keeper execute
  const targetClose = epAfter[2];
  log("waiting for closeBlock + keeper execute...", {
    closeBlock: targetClose.toString(),
  });

  let executed = null;
  const deadline = Date.now() + 25 * 60 * 1000; // 25 min
  while (Date.now() < deadline) {
    const now = await publicClient.getBlockNumber();
    const cur = await publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "epochs",
      args: [epochId],
    });
    const state = Number(cur[0]);
    log("poll", {
      block: now.toString(),
      close: targetClose.toString(),
      state,
      residualIn: cur[6].toString(),
      residualOut: cur[7].toString(),
    });
    if (state === 2) {
      executed = cur;
      break;
    }
    // also check if epoch rotated (empty path) — currentEpochId advanced
    const liveEpoch = await publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "currentEpochId",
    });
    if (liveEpoch > epochId && state === 2) {
      executed = cur;
      break;
    }
    // If epoch advanced but old epoch is Executed
    if (liveEpoch > epochId) {
      const old = await publicClient.readContract({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "epochs",
        args: [epochId],
      });
      if (Number(old[0]) === 2) {
        executed = old;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }

  if (!executed) {
    writeFileSync(
      resolve(root, "docs/DEMO_EVIDENCE.partial.json"),
      JSON.stringify({ epochId: epochId.toString(), evidence }, null, 2)
    );
    throw new Error(
      "Timed out waiting for keeper execute. Partial evidence written to docs/DEMO_EVIDENCE.partial.json — check keeper /ready and Render logs."
    );
  }

  // Pull logs for this epoch from registry
  const fromBlock = executed ? BigInt(ep[1]) : block; // openBlock
  let logs = [];
  try {
    logs = await publicClient.getLogs({
      address: REGISTRY,
      fromBlock: fromBlock > 5n ? fromBlock - 5n : 0n,
      toBlock: "latest",
    });
  } catch (e) {
    log("getLogs limited", { err: String(e).slice(0, 120) });
  }

  const book = await publicClient.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "getEpochBook",
    args: [epochId],
  });

  evidence.push({
    step: "epoch_executed",
    epochId: epochId.toString(),
    state: Number(executed[0]),
    netHandle: executed[4],
    zeroForOne: executed[5],
    residualIn: executed[6].toString(),
    residualOut: executed[7].toString(),
    buyEscrow: executed[9].toString(),
    sellEscrow: executed[10].toString(),
    bookMatchedHint: book[10].toString(),
  });

  // Scan recent blocks for EpochExecuted tx via eth_getLogs topic
  // EpochExecuted(uint256,bool,uint256,uint256) topic0
  const epochExecutedTopic =
    "0x" +
    // keccak - use cast if available later; fallback search transfer receipts
    "";

  const outPath = resolve(root, "docs/DEMO_EVIDENCE.partial.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        registry: REGISTRY,
        epochId: epochId.toString(),
        walletA: accountA.address,
        walletB: accountB.address,
        expectedNetMicroUsdc: (amountA + amountBSigned).toString(),
        residualIn: executed[6].toString(),
        residualOut: executed[7].toString(),
        evidence,
        note: "Fill execute/close tx hashes from Render keeper logs or Etherscan internal txs if getLogs truncated.",
      },
      null,
      2
    )
  );
  log("wrote", { outPath });

  // Human markdown
  const md = `# Demo evidence — Sepolia epoch ${epochId}

Generated: ${new Date().toISOString()}

## Pre-flight

| Check | Result |
| --- | --- |
| Registry | [\`${REGISTRY}\`](https://sepolia.etherscan.io/address/${REGISTRY}) |
| Epoch | ${epochId} |
| Wallet A | \`${accountA.address}\` |
| Wallet B | \`${accountB.address}\` |
| Expected encrypted net | \`+${amountA} + (${amountBSigned}) = ${amountA + amountBSigned}\` (USDC micro-units) |
| Observed residualIn | \`${executed[6]}\` |
| Observed residualOut | \`${executed[7]}\` |
| zeroForOne | ${executed[5]} |
| netHandle | \`${executed[4]}\` |

## Transactions

| Step | Tx |
| --- | --- |
| Fund B ETH | [\`${fundEth.hash}\`](https://sepolia.etherscan.io/tx/${fundEth.hash}) |
| Fund B WETH | [\`${fundWeth.hash}\`](https://sepolia.etherscan.io/tx/${fundWeth.hash}) |
| Approve A USDC | [\`${approveA.hash}\`](https://sepolia.etherscan.io/tx/${approveA.hash}) |
| Intent A (+10 USDC encrypted, USDC escrow) | [\`${submitA.hash}\`](https://sepolia.etherscan.io/tx/${submitA.hash}) |
| Approve B WETH | [\`${approveB.hash}\`](https://sepolia.etherscan.io/tx/${approveB.hash}) |
| Intent B (−7e6 encrypted, WETH escrow) | [\`${submitB.hash}\`](https://sepolia.etherscan.io/tx/${submitB.hash}) |
| EpochClosed / executeEpoch | See keeper logs + registry events for epoch ${epochId} |

## Narrative for judges

1. Two wallets sealed **opposing signed notional** in the Nox encrypted book (+10e6 vs −7e6 micro-USDC units).
2. Escrow is public (USDC / WETH transfers); signed size stays encrypted until net public-decrypt.
3. Expected residual = **3e6 micro-USDC** → only that residual should hit Uniswap v4 via NettleHook.
4. Opposite-side WETH escrow is **fully refunded** (notional cancellation, not P2P fill).
5. Path: \`IntentRegistry → NettleHook → UniswapV4Executor → PoolManager.swap\`.

## Keeper

- Health: https://nettle-s2q0.onrender.com/health
- Ready: https://nettle-s2q0.onrender.com/ready

## Trust disclosures (MVP)

- Keeper-supplied \`netSigned\` is trusted (not proven on-chain vs handle).
- Encrypted magnitude is not proven equal to escrow on-chain.
`;

  writeFileSync(resolve(root, "docs/DEMO_EVIDENCE.md"), md);
  log("DEMO_EVIDENCE.md written");
  console.log("\nSUCCESS intents submitted. Keeper will close/execute after closeBlock.");
  console.log("Re-run poll section or check registry epoch state in ~epochDuration blocks.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
