// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBatchExecutor} from "../interfaces/IBatchExecutor.sol";
import {
    IPoolManager,
    PoolKey,
    SwapParams,
    BalanceDelta,
    Hooks
} from "../interfaces/v4/IV4Types.sol";

/// @title NettleHook — load-bearing gate + Uniswap v4 IHooks
/// @notice Two roles:
///   1) Batch gate: IntentRegistry → executeNetSwap → UniswapV4Executor → PoolManager
///   2) Pool hooks: beforeSwap / afterSwap when PoolKey.hooks == this (permissioned address)
/// @dev Hook permission flags (BEFORE_SWAP | AFTER_SWAP) must match low bits of this address
///      when used as PoolKey.hooks — deploy via CREATE2 HookMiner (see deploy-sepolia.ts).
contract NettleHook is IBatchExecutor {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    IBatchExecutor public immutable ammExecutor; // UniswapV4Executor
    IERC20 public immutable token0;
    IERC20 public immutable token1;

    address public registry;
    address public keeper;

    /// @notice Last residual validated (inspector)
    uint256 public lastResidualIn;
    uint256 public lastMinOut;
    bool public lastZeroForOne;
    uint256 public lastAmountOut;
    uint64 public lastExecutedAt;

    /// @dev Must match CREATE2-mined address bits
    uint160 public constant HOOK_FLAGS =
        uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

    error NotRegistry();
    error NotKeeper();
    error NotPoolManager();
    error UnauthorizedSwap();
    error ZeroAmount();
    error Slippage();
    error InvalidHookAddress();

    event RegistrySet(address indexed registry);
    event KeeperUpdated(address indexed keeper);
    event BatchSwapValidated(
        address indexed registry,
        bool zeroForOne,
        uint256 residualIn,
        uint256 minOut,
        uint256 amountOut
    );
    event V4BeforeSwap(
        address indexed sender, bool zeroForOne, int256 amountSpecified, bytes hookData
    );
    event V4AfterSwap(address indexed sender, int128 delta0, int128 delta1);

    constructor(
        address poolManager_,
        address ammExecutor_,
        address token0_,
        address token1_,
        address keeper_
    ) {
        require(
            poolManager_ != address(0) && ammExecutor_ != address(0) && token0_ != address(0),
            "zero"
        );
        poolManager = IPoolManager(poolManager_);
        ammExecutor = IBatchExecutor(ammExecutor_);
        token0 = IERC20(token0_);
        token1 = IERC20(token1_);
        keeper = keeper_;

        // When used as PoolKey.hooks, address low bits must encode flags.
        // CREATE2 deploy mines a salt so this passes; plain CREATE may use flags=0 pool only.
        // We do not force-revert here so local tests without mining still compile/deploy.
    }

    /// @notice Only the keeper may set (or update) the registry — no first-caller race.
    function setRegistry(address registry_) external {
        if (msg.sender != keeper) revert NotKeeper();
        require(registry_ != address(0), "zero registry");
        registry = registry_;
        emit RegistrySet(registry_);
    }

    function setKeeper(address k) external {
        if (msg.sender != keeper) revert NotKeeper();
        require(k != address(0), "zero keeper");
        keeper = k;
        emit KeeperUpdated(k);
    }

    // -------------------------------------------------------------------------
    // Role 1: batch residual gate (IBatchExecutor)
    // -------------------------------------------------------------------------

    /// @inheritdoc IBatchExecutor
    function executeNetSwap(bool zeroForOne, uint256 amountIn, uint256 minAmountOut)
        external
        override
        returns (uint256 amountOut)
    {
        if (registry == address(0) || msg.sender != registry) revert NotRegistry();
        if (amountIn == 0) revert ZeroAmount();

        address tokenIn = zeroForOne ? address(token0) : address(token1);

        IERC20(tokenIn).safeTransferFrom(registry, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(ammExecutor), amountIn);

        amountOut = ammExecutor.executeNetSwap(zeroForOne, amountIn, minAmountOut);

        IERC20(tokenIn).forceApprove(address(ammExecutor), 0);
        if (amountOut < minAmountOut) revert Slippage();

        lastResidualIn = amountIn;
        lastMinOut = minAmountOut;
        lastZeroForOne = zeroForOne;
        lastAmountOut = amountOut;
        lastExecutedAt = uint64(block.number);

        emit BatchSwapValidated(registry, zeroForOne, amountIn, minAmountOut, amountOut);
    }

    // -------------------------------------------------------------------------
    // Role 2: Uniswap v4 pool hooks (called by PoolManager during swap)
    // -------------------------------------------------------------------------

    /// @notice v4 beforeSwap — reject unauthorized residual / non-executor swaps when we are pool hooks
    function beforeSwap(
        address sender,
        PoolKey calldata,
        SwapParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4, int256, uint24) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        // Only residual executor (or keeper/registry for tests) may swap through hooked pool
        if (sender != address(ammExecutor) && sender != keeper && sender != registry) {
            revert UnauthorizedSwap();
        }
        if (params.amountSpecified == 0) revert ZeroAmount();

        emit V4BeforeSwap(sender, params.zeroForOne, params.amountSpecified, hookData);

        // No fee override, no before-swap delta
        return (this.beforeSwap.selector, int256(0), 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata,
        SwapParams calldata,
        BalanceDelta delta,
        bytes calldata
    ) external returns (bytes4, int128) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        int128 d0;
        int128 d1;
        assembly {
            d0 := sar(128, delta)
            d1 := signextend(15, delta)
        }
        emit V4AfterSwap(sender, d0, d1);
        return (this.afterSwap.selector, 0);
    }

    function getHookPermissions() external pure returns (uint160) {
        return HOOK_FLAGS;
    }

    /// @notice Whether this address encoding matches required v4 hook flags
    function hasValidHookAddress() external view returns (bool) {
        return Hooks.validateHookAddress(address(this), HOOK_FLAGS);
    }
}
