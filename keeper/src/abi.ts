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
    name: "closeEpoch",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "executeEpoch",
    stateMutability: "nonpayable",
    inputs: [{ name: "minAmountOut", type: "uint256" }],
    outputs: [{ type: "uint256" }],
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
] as const;

export const noxRegistryAbi = [
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
    ],
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
    type: "function",
    name: "getNetHandle",
    stateMutability: "view",
    inputs: [{ name: "epochId", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;
