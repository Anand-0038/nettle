// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBatchExecutor {
    function executeNetSwap(bool zeroForOne, uint256 amountIn, uint256 minAmountOut)
        external
        returns (uint256 amountOut);
}
