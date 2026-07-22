// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBatchExecutor} from "./interfaces/IBatchExecutor.sol";

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

/// @notice Residual AMM adapter — unmatched net only.
/// Path: IntentRegistry → NettleHook → this → SwapRouter02
/// Output is sent to `settlement` (IntentRegistry) for trader payouts.
contract UniswapV3Executor is IBatchExecutor {
    using SafeERC20 for IERC20;

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    ISwapRouter02 public immutable router;
    uint24 public immutable poolFee;

    address public hook;
    address public settlement;

    error OnlyHook();
    error NotConfigured();
    error ZeroAmount();

    constructor(address token0_, address token1_, address router_, uint24 poolFee_) {
        token0 = IERC20(token0_);
        token1 = IERC20(token1_);
        router = ISwapRouter02(router_);
        poolFee = poolFee_;
    }

    function configure(address hook_, address settlement_) external {
        require(hook == address(0) || msg.sender == settlement, "locked");
        hook = hook_;
        settlement = settlement_;
    }

    function executeNetSwap(bool zeroForOne, uint256 amountIn, uint256 minAmountOut)
        external
        override
        returns (uint256 amountOut)
    {
        if (msg.sender != hook) revert OnlyHook();
        if (settlement == address(0) || hook == address(0)) revert NotConfigured();
        if (amountIn == 0) revert ZeroAmount();

        address tokenIn = zeroForOne ? address(token0) : address(token1);
        address tokenOut = zeroForOne ? address(token1) : address(token0);

        // Pull residual from Hook (which already pulled from Registry)
        IERC20(tokenIn).safeTransferFrom(hook, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(router), amountIn);

        amountOut = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: settlement,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );

        // Reset router allowance
        IERC20(tokenIn).forceApprove(address(router), 0);
    }
}
