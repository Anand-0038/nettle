// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    IPoolManager,
    IUnlockCallback,
    PoolKey,
    ModifyLiquidityParams,
    Currency,
    CurrencyLibrary,
    BalanceDelta,
    BalanceDeltaLibrary
} from "../interfaces/v4/IV4Types.sol";

/// @dev One-shot helper for Sepolia demo liquidity (full-range) on a v4 pool.
/// Not part of the production residual path — deploy-time only.
contract V4LiquidityBootstrap is IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable poolManager;
    address public owner;

    error OnlyOwner();
    error OnlyPM();

    constructor(address poolManager_) {
        poolManager = IPoolManager(poolManager_);
        owner = msg.sender;
    }

    function bootstrap(
        PoolKey calldata key,
        uint256 amount0Max,
        uint256 amount1Max,
        int256 liquidityDelta,
        int24 tickLower,
        int24 tickUpper
    ) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (amount0Max > 0) {
            IERC20(Currency.unwrap(key.currency0)).safeTransferFrom(
                msg.sender, address(this), amount0Max
            );
        }
        if (amount1Max > 0) {
            IERC20(Currency.unwrap(key.currency1)).safeTransferFrom(
                msg.sender, address(this), amount1Max
            );
        }
        poolManager.unlock(
            abi.encode(key, liquidityDelta, tickLower, tickUpper, amount0Max, amount1Max)
        );
        // return leftovers
        _returnDust(Currency.unwrap(key.currency0), msg.sender);
        _returnDust(Currency.unwrap(key.currency1), msg.sender);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPM();
        (
            PoolKey memory key,
            int256 liquidityDelta,
            int24 tickLower,
            int24 tickUpper,
            ,
        ) = abi.decode(data, (PoolKey, int256, int24, int24, uint256, uint256));

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0) _settle(key.currency0, uint256(int256(-d0)));
        if (d1 < 0) _settle(key.currency1, uint256(int256(-d1)));
        if (d0 > 0) poolManager.take(key.currency0, address(this), uint256(int256(d0)));
        if (d1 > 0) poolManager.take(key.currency1, address(this), uint256(int256(d1)));
        return "";
    }

    function _settle(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        IERC20(currency.toAddress()).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _returnDust(address token, address to) internal {
        uint256 b = IERC20(token).balanceOf(address(this));
        if (b > 0) IERC20(token).safeTransfer(to, b);
    }
}
