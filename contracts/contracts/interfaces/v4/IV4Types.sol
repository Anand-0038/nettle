// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Minimal Uniswap v4 types — enough for residual PoolManager swaps.
/// Full v4-core is borrowed at the interface boundary (not reimplemented).

type Currency is address;
type PoolId is bytes32;
type BalanceDelta is int256;
type BeforeSwapDelta is int256;

struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified; // negative = exact input
    uint160 sqrtPriceLimitX96;
}

struct ModifyLiquidityParams {
    int24 tickLower;
    int24 tickUpper;
    int256 liquidityDelta;
    bytes32 salt;
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
        external
        returns (BalanceDelta swapDelta);
    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata hookData)
        external
        returns (BalanceDelta callerDelta, BalanceDelta feesAccrued);
    function sync(Currency currency) external;
    function take(Currency currency, address to, uint256 amount) external;
    function settle() external payable returns (uint256 paid);
    function clear(Currency currency, uint256 amount) external;
    function extsload(bytes32 slot) external view returns (bytes32);
}

library CurrencyLibrary {
    function wrap(address a) internal pure returns (Currency) {
        return Currency.wrap(a);
    }

    function toAddress(Currency c) internal pure returns (address) {
        return Currency.unwrap(c);
    }
}

library BalanceDeltaLibrary {
    function amount0(BalanceDelta balanceDelta) internal pure returns (int128 _amount0) {
        assembly {
            _amount0 := sar(128, balanceDelta)
        }
    }

    function amount1(BalanceDelta balanceDelta) internal pure returns (int128 _amount1) {
        assembly {
            _amount1 := signextend(15, balanceDelta)
        }
    }
}

library PoolIdLibrary {
    function toId(PoolKey memory poolKey) internal pure returns (PoolId) {
        return PoolId.wrap(keccak256(abi.encode(poolKey)));
    }
}

/// @dev Sqrt price limits used by v4 (same as v3)
library TickMath {
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
}

/// @notice Hook permission flags (must match address low bits when hooks ≠ 0)
library Hooks {
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 internal constant BEFORE_SWAP_FLAG = 1 << 7;
    uint160 internal constant AFTER_SWAP_FLAG = 1 << 6;

    function hasPermission(address hooks, uint160 flag) internal pure returns (bool) {
        return uint160(uint256(uint160(hooks))) & flag != 0;
    }

    function validateHookAddress(address hooks, uint160 flags) internal pure returns (bool) {
        return uint160(uint256(uint160(hooks))) & ALL_HOOK_MASK == flags & ALL_HOOK_MASK;
    }
}
