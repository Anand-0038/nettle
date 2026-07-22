# Contract verification (Sepolia)

Judges should open the contract and read source. Prefer **Sourcify** (free) or Etherscan API.

## Addresses (current)

| Contract | Address |
| --- | --- |
| UniswapV3Executor | `0xa9ac1f6d358cf4e13eb958a8df01e12c6afb0df6` |
| NettleHook | `0x7732a8ad6824dc2f49a34d03b14056facf301b4d` |
| IntentRegistry | `0xc600403ab7d0d086637751c571793156247736ef` |

## Constructor args

**UniswapV3Executor** `(token0, token1, router, poolFee)`:

- token0 = USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- token1 = WETH `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
- router = SwapRouter02 `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`
- poolFee = `3000`

**NettleHook** `(poolManager, ammExecutor, token0, token1, keeper)`:

- poolManager = `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`
- ammExecutor = UniswapV3Executor address above
- token0 / token1 = same
- keeper = `0xFB76C4B6912bCF358752Fb4b4b15B959EfaDD915`

**IntentRegistry** `(token0, token1, executor, keeper, epochDurationBlocks)`:

- executor = **NettleHook** address (not the AMM adapter)
- keeper = same burner
- epochDurationBlocks = `50`

## Encode (foundry)

```bash
# Executor
cast abi-encode "constructor(address,address,address,uint24)" \
  0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
  0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14 \
  0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E \
  3000

# Hook (replace EXECUTOR)
cast abi-encode "constructor(address,address,address,address,address)" \
  0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 \
  0xa9ac1f6d358cf4e13eb958a8df01e12c6afb0df6 \
  0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
  0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14 \
  0xFB76C4B6912bCF358752Fb4b4b15B959EfaDD915

# Registry (executor = HOOK)
cast abi-encode "constructor(address,address,address,address,uint256)" \
  0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
  0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14 \
  0x7732a8ad6824dc2f49a34d03b14056facf301b4d \
  0xFB76C4B6912bCF358752Fb4b4b15B959EfaDD915 \
  50
```

## UI verify (fastest)

1. Open each address on [Sepolia Etherscan](https://sepolia.etherscan.io)
2. Contract → **Verify and Publish** → Solidity (Single file or Standard JSON)
3. Compiler **0.8.36**, optimization **200**, **viaIR = true**
4. Paste flattened source or Standard JSON from `contracts/artifacts/build-info`

Hardhat build-info after `pnpm compile`:

```text
contracts/artifacts/build-info/*.json
```

## Sourcify

```bash
# If you use forge project later:
# forge verify-contract --chain sepolia --verifier sourcify <ADDR> <ContractName>
```

Or drag Standard JSON to https://sourcify.dev/#/verifier

After verify, paste green check links into submission notes.
