// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBatchExecutor} from "./interfaces/IBatchExecutor.sol";
import {
    IPoolManager,
    IUnlockCallback,
    PoolKey,
    SwapParams,
    Currency,
    CurrencyLibrary,
    BalanceDelta,
    BalanceDeltaLibrary,
    TickMath
} from "./interfaces/v4/IV4Types.sol";

/// @title UniswapV4Executor — residual volume via PoolManager.swap
/// @notice Path: IntentRegistry → NettleHook → this → PoolManager.unlock → swap
/// @dev Borrows Uniswap v4 singleton liquidity; builds residual-only settlement.
contract UniswapV4Executor is IBatchExecutor, IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable poolManager;
    IERC20 public immutable token0;
    IERC20 public immutable token1;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;

    address public hook; // NettleHook (batch gate + optional pool hooks)
    address public settlement; // IntentRegistry
    address public poolHooks; // hooks field in PoolKey (often same as NettleHook, or address(0))

    error OnlyHook();
    error OnlyPoolManager();
    error NotConfigured();
    error ZeroAmount();
    error Slippage();

    event ResidualV4Swap(
        bool zeroForOne, uint256 amountIn, uint256 amountOut, address poolHooks
    );

    constructor(
        address poolManager_,
        address token0_,
        address token1_,
        uint24 poolFee_,
        int24 tickSpacing_
    ) {
        require(poolManager_ != address(0) && token0_ != token1_, "bad");
        poolManager = IPoolManager(poolManager_);
        token0 = IERC20(token0_);
        token1 = IERC20(token1_);
        poolFee = poolFee_;
        tickSpacing = tickSpacing_;
    }

    function configure(address hook_, address settlement_, address poolHooks_) external {
        require(hook == address(0) || msg.sender == settlement, "locked");
        hook = hook_;
        settlement = settlement_;
        poolHooks = poolHooks_;
    }

    /// @inheritdoc IBatchExecutor
    function executeNetSwap(bool zeroForOne, uint256 amountIn, uint256 minAmountOut)
        external
        override
        returns (uint256 amountOut)
    {
        if (msg.sender != hook) revert OnlyHook();
        if (settlement == address(0) || hook == address(0)) revert NotConfigured();
        if (amountIn == 0) revert ZeroAmount();

        // Pull residual from Hook
        address tokenIn = zeroForOne ? address(token0) : address(token1);
        IERC20(tokenIn).safeTransferFrom(hook, address(this), amountIn);

        bytes memory result = poolManager.unlock(
            abi.encode(zeroForOne, amountIn, minAmountOut)
        );
        amountOut = abi.decode(result, (uint256));
        if (amountOut < minAmountOut) revert Slippage();

        emit ResidualV4Swap(zeroForOne, amountIn, amountOut, poolHooks);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        (bool zeroForOne, uint256 amountIn, uint256 minAmountOut) =
            abi.decode(data, (bool, uint256, uint256));

        PoolKey memory key = _poolKey();
        // exact input: amountSpecified is negative
        int256 amountSpecified = -int256(amountIn);
        uint160 limit = zeroForOne
            ? TickMath.MIN_SQRT_RATIO + 1
            : TickMath.MAX_SQRT_RATIO - 1;

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: limit
            }),
            // hookData: tag residual path for NettleHook.beforeSwap
            abi.encode(settlement, amountIn, minAmountOut)
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();

        // Pay what we owe; take what we are owed → settlement (registry)
        if (d0 < 0) {
            _settle(key.currency0, uint256(int256(-d0)));
        }
        if (d1 < 0) {
            _settle(key.currency1, uint256(int256(-d1)));
        }

        uint256 amountOut;
        if (zeroForOne) {
            // paid token0, receive token1
            require(d1 > 0, "no out");
            amountOut = uint256(int256(d1));
            poolManager.take(key.currency1, settlement, amountOut);
        } else {
            require(d0 > 0, "no out");
            amountOut = uint256(int256(d0));
            poolManager.take(key.currency0, settlement, amountOut);
        }

        return abi.encode(amountOut);
    }

    function _settle(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        IERC20(currency.toAddress()).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _poolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: poolFee,
            tickSpacing: tickSpacing,
            hooks: poolHooks
        });
    }

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey();
    }
}
