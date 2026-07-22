/** Production IntentRegistry (Nox) — no mock fields */
export const intentRegistryAbi = [
  {
    type: "function",
    name: "currentEpochId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "epochs",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "state", type: "uint8" },
      { name: "openBlock", type: "uint64" },
      { name: "closeBlock", type: "uint64" },
      { name: "netEncrypted", type: "bytes32" },
      { name: "netHandle", type: "bytes32" },
      { name: "zeroForOne", type: "bool" },
      { name: "absAmountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
      { name: "participantCount", type: "uint256" },
      { name: "buyEscrow", type: "uint256" },
      { name: "sellEscrow", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "submitIntent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "inputHandle", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
      { name: "tokenIn", type: "address" },
      { name: "escrowAmount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTraderIntentIds",
    stateMutability: "view",
    inputs: [
      { name: "trader", type: "address" },
      { name: "epochId", type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "intents",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [
      { name: "trader", type: "address" },
      { name: "amount", type: "bytes32" },
      { name: "tokenIn", type: "address" },
      { name: "escrowed", type: "uint256" },
      { name: "settled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getIntentHandle",
    stateMutability: "view",
    inputs: [
      { name: "epochId", type: "uint256" },
      { name: "intentId", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "getNetHandle",
    stateMutability: "view",
    inputs: [{ name: "epochId", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "closeEpoch",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "executeEpoch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "netSigned", type: "int256" },
      { name: "minAmountOut", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "EpochExecuted",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "zeroForOne", type: "bool", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "IntentSubmitted",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "intentId", type: "uint256", indexed: true },
      { name: "trader", type: "address", indexed: true },
      { name: "handle", type: "bytes32", indexed: false },
      { name: "tokenIn", type: "address", indexed: false },
      { name: "escrowed", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EpochClosed",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "netHandle", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "function",
    name: "getEpochBook",
    stateMutability: "view",
    inputs: [{ name: "epochId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "state", type: "uint8" },
          { name: "openBlock", type: "uint64" },
          { name: "closeBlock", type: "uint64" },
          { name: "netHandle", type: "bytes32" },
          { name: "zeroForOne", type: "bool" },
          { name: "residualIn", type: "uint256" },
          { name: "residualOut", type: "uint256" },
          { name: "participantCount", type: "uint256" },
          { name: "buyEscrow", type: "uint256" },
          { name: "sellEscrow", type: "uint256" },
          { name: "matchedHint", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getEpochIntentIds",
    stateMutability: "view",
    inputs: [{ name: "epochId", type: "uint256" }],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "event",
    name: "BatchMatched",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "buyEscrow", type: "uint256", indexed: false },
      { name: "sellEscrow", type: "uint256", indexed: false },
      { name: "residualIn", type: "uint256", indexed: false },
      { name: "residualOut", type: "uint256", indexed: false },
      { name: "zeroForOne", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "IntentSettled",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "intentId", type: "uint256", indexed: true },
      { name: "trader", type: "address", indexed: false },
      { name: "payoutOut", type: "uint256", indexed: false },
      { name: "refundIn", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Local Hardhat only — never used when NEXT_PUBLIC_DEMO_MODE=false */
export const mockRegistryAbi = [
  {
    type: "function",
    name: "currentEpochId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getEpoch",
    stateMutability: "view",
    inputs: [{ name: "epochId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "state", type: "uint8" },
          { name: "openBlock", type: "uint64" },
          { name: "closeBlock", type: "uint64" },
          { name: "netSigned", type: "int256" },
          { name: "netHandle", type: "bytes32" },
          { name: "zeroForOne", type: "bool" },
          { name: "absAmountIn", type: "uint256" },
          { name: "amountOut", type: "uint256" },
          { name: "participantCount", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "submitIntent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "signedAmount", type: "int256" },
      { name: "escrowAmount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTraderIntentIds",
    stateMutability: "view",
    inputs: [
      { name: "trader", type: "address" },
      { name: "epochId", type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getIntent",
    stateMutability: "view",
    inputs: [
      { name: "epochId", type: "uint256" },
      { name: "intentId", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "trader", type: "address" },
          { name: "handle", type: "bytes32" },
          { name: "signedAmount", type: "int256" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "escrowed", type: "uint256" },
          { name: "settled", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "publicDecryptNet",
    stateMutability: "view",
    inputs: [{ name: "epochId", type: "uint256" }],
    outputs: [
      { name: "netSigned", type: "int256" },
      { name: "netHandle", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "EpochExecuted",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "zeroForOne", type: "bool", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
    ],
  },
] as const;

export const mockAmmAbi = [
  {
    type: "function",
    name: "reserve0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "reserve1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;
