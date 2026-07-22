// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBatchExecutor} from "../../interfaces/IBatchExecutor.sol";

/// @dev Local Hardhat stand-in for Uniswap. Sepolia uses UniswapV3Executor.
contract MockAMM is IBatchExecutor {
    using SafeERC20 for IERC20;

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    uint256 public reserve0;
    uint256 public reserve1;

    event Swap(bool zeroForOne, uint256 amountIn, uint256 amountOut);

    constructor(address token0_, address token1_) {
        token0 = IERC20(token0_);
        token1 = IERC20(token1_);
    }

    function seed(uint256 amount0, uint256 amount1) external {
        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);
        reserve0 += amount0;
        reserve1 += amount1;
    }

    function executeNetSwap(bool zeroForOne, uint256 amountIn, uint256 minAmountOut)
        external
        override
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "zero");
        if (zeroForOne) {
            amountOut = getAmountOut(amountIn, reserve0, reserve1);
            require(amountOut >= minAmountOut, "slippage");
            token0.safeTransferFrom(msg.sender, address(this), amountIn);
            reserve0 += amountIn;
            reserve1 -= amountOut;
            token1.safeTransfer(msg.sender, amountOut);
        } else {
            amountOut = getAmountOut(amountIn, reserve1, reserve0);
            require(amountOut >= minAmountOut, "slippage");
            token1.safeTransferFrom(msg.sender, address(this), amountIn);
            reserve1 += amountIn;
            reserve0 -= amountOut;
            token0.safeTransfer(msg.sender, amountOut);
        }
        emit Swap(zeroForOne, amountIn, amountOut);
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256)
    {
        require(reserveIn > 0 && reserveOut > 0, "empty");
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }
}
