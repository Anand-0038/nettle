// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBatchExecutor} from "../../interfaces/IBatchExecutor.sol";

/// @dev Local Hardhat only. Production: IntentRegistry.sol (real Nox).
contract MockIntentRegistry {
    using SafeERC20 for IERC20;

    enum EpochState {
        Open,
        Closed,
        Executed
    }

    struct Intent {
        address trader;
        bytes32 handle;
        int256 signedAmount; // mock-only: real registry never stores this
        address tokenIn;
        address tokenOut;
        uint256 escrowed;
        bool settled;
    }

    struct Epoch {
        EpochState state;
        uint64 openBlock;
        uint64 closeBlock;
        int256 netSigned; // mock public net after close
        bytes32 netHandle;
        bool zeroForOne;
        uint256 absAmountIn;
        uint256 amountOut;
        uint256 participantCount;
    }

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    IBatchExecutor public executor;
    address public keeper;
    address public owner;

    uint256 public epochDurationBlocks;
    uint256 public currentEpochId;
    uint256 public nextIntentId;

    mapping(uint256 => Epoch) public epochs;
    mapping(uint256 => mapping(uint256 => Intent)) public intents; // epoch => intentId => Intent
    mapping(uint256 => uint256[]) public epochIntentIds;
    mapping(address => mapping(uint256 => uint256[])) public traderIntentIds;

    event EpochOpened(uint256 indexed epochId, uint64 openBlock, uint64 closeBlock);
    event IntentSubmitted(
        uint256 indexed epochId,
        uint256 indexed intentId,
        address indexed trader,
        bytes32 handle,
        address tokenIn,
        uint256 escrowed
    );
    event EpochClosed(uint256 indexed epochId, bytes32 netHandle, int256 netSigned);
    event EpochExecuted(
        uint256 indexed epochId, bool zeroForOne, uint256 amountIn, uint256 amountOut
    );
    event IntentSettled(uint256 indexed epochId, uint256 indexed intentId, address trader, uint256 payout);

    error NotKeeper();
    error NotOwner();
    error EpochNotOpen();
    error EpochNotClosed();
    error EpochNotReady();
    error InvalidPair();
    error ZeroAmount();
    error AlreadySettled();

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address token0_,
        address token1_,
        address executor_,
        address keeper_,
        uint256 epochDurationBlocks_
    ) {
        require(token0_ != token1_, "same token");
        token0 = IERC20(token0_);
        token1 = IERC20(token1_);
        executor = IBatchExecutor(executor_);
        keeper = keeper_;
        owner = msg.sender;
        epochDurationBlocks = epochDurationBlocks_ == 0 ? 20 : epochDurationBlocks_;
        _openEpoch();
    }

    function setKeeper(address k) external onlyOwner {
        require(k != address(0), "zero keeper");
        keeper = k;
    }

    function setExecutor(address e) external onlyOwner {
        require(e != address(0), "zero executor");
        executor = IBatchExecutor(e);
    }

    /// @notice Submit a mock-encrypted signed amount.
    /// @param signedAmount positive => buy token1 with token0 (zeroForOne);
    ///                     negative => sell token1 for token0.
    /// @param escrowAmount absolute tokens locked from tokenIn (must equal |signedAmount| in mock).
    function submitIntent(int256 signedAmount, uint256 escrowAmount) external returns (uint256 intentId) {
        if (signedAmount == 0 || escrowAmount == 0) revert ZeroAmount();
        Epoch storage ep = epochs[currentEpochId];
        if (ep.state != EpochState.Open) revert EpochNotOpen();
        if (block.number >= ep.closeBlock) revert EpochNotOpen();

        uint256 absAmount = signedAmount > 0 ? uint256(signedAmount) : uint256(-signedAmount);
        require(absAmount == escrowAmount, "escrow mismatch");

        address tokenIn = signedAmount > 0 ? address(token0) : address(token1);
        address tokenOut = signedAmount > 0 ? address(token1) : address(token0);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), escrowAmount);

        // Opaque handle for UI / event logs (not real Nox crypto)
        bytes32 handle = keccak256(
            abi.encodePacked(msg.sender, currentEpochId, nextIntentId, signedAmount, block.timestamp)
        );

        intentId = nextIntentId++;
        intents[currentEpochId][intentId] = Intent({
            trader: msg.sender,
            handle: handle,
            signedAmount: signedAmount,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            escrowed: escrowAmount,
            settled: false
        });
        epochIntentIds[currentEpochId].push(intentId);
        traderIntentIds[msg.sender][currentEpochId].push(intentId);
        ep.participantCount += 1;
        ep.netSigned += signedAmount;

        emit IntentSubmitted(currentEpochId, intentId, msg.sender, handle, tokenIn, escrowAmount);
    }

    /// @notice Close epoch: mark net as "publicly decryptable" (mock: emit netSigned).
    function closeEpoch() external {
        Epoch storage ep = epochs[currentEpochId];
        if (ep.state != EpochState.Open) revert EpochNotOpen();
        if (block.number < ep.closeBlock && msg.sender != keeper && msg.sender != owner) {
            revert EpochNotReady();
        }

        ep.state = EpochState.Closed;
        ep.netHandle = keccak256(abi.encodePacked("net", currentEpochId, ep.netSigned));
        emit EpochClosed(currentEpochId, ep.netHandle, ep.netSigned);
    }

    /// @notice Keeper executes ONE net swap against the AMM, then opens the next epoch.
    /// @notice Keeper executes residual. Optional `netOverride` simulates a malicious keeper
    ///         lying about the decrypted net (MVP trust assumption for production Nox path).
    function executeEpoch(uint256 minAmountOut) external onlyKeeper returns (uint256 amountOut) {
        return _executeEpoch(minAmountOut, type(int256).min);
    }

    function executeEpochWithNet(int256 netOverride, uint256 minAmountOut)
        external
        onlyKeeper
        returns (uint256 amountOut)
    {
        return _executeEpoch(minAmountOut, netOverride);
    }

    function _executeEpoch(uint256 minAmountOut, int256 netOverride)
        internal
        returns (uint256 amountOut)
    {
        Epoch storage ep = epochs[currentEpochId];
        if (ep.state != EpochState.Closed) revert EpochNotClosed();
        if (ep.state == EpochState.Executed) revert AlreadySettled();

        int256 net = netOverride == type(int256).min ? ep.netSigned : netOverride;
        if (net == 0) {
            ep.state = EpochState.Executed;
            ep.absAmountIn = 0;
            ep.amountOut = 0;
            // refund all when zero net
            uint256[] storage ids0 = epochIntentIds[currentEpochId];
            for (uint256 i = 0; i < ids0.length; i++) {
                Intent storage it = intents[currentEpochId][ids0[i]];
                if (it.settled) continue;
                it.settled = true;
                IERC20(it.tokenIn).safeTransfer(it.trader, it.escrowed);
                emit IntentSettled(currentEpochId, ids0[i], it.trader, 0);
            }
            emit EpochExecuted(currentEpochId, true, 0, 0);
            _openEpoch();
            return 0;
        }

        bool zeroForOne = net > 0;
        uint256 amountIn = net > 0 ? uint256(net) : uint256(-net);
        address tokenIn = zeroForOne ? address(token0) : address(token1);

        uint256 available = IERC20(tokenIn).balanceOf(address(this));
        if (amountIn > available) amountIn = available;

        IERC20(tokenIn).forceApprove(address(executor), amountIn);
        amountOut = executor.executeNetSwap(zeroForOne, amountIn, minAmountOut);

        ep.state = EpochState.Executed;
        ep.zeroForOne = zeroForOne;
        ep.absAmountIn = amountIn;
        ep.amountOut = amountOut;

        emit EpochExecuted(currentEpochId, zeroForOne, amountIn, amountOut);
        _settleEpoch(currentEpochId);
        _openEpoch();
    }

    function _settleEpoch(uint256 epochId) internal {
        Epoch storage ep = epochs[epochId];
        uint256[] storage ids = epochIntentIds[epochId];
        if (ep.absAmountIn == 0 || ids.length == 0) {
            for (uint256 i = 0; i < ids.length; i++) {
                Intent storage it = intents[epochId][ids[i]];
                if (it.settled) continue;
                it.settled = true;
                IERC20(it.tokenIn).safeTransfer(it.trader, it.escrowed);
                emit IntentSettled(epochId, ids[i], it.trader, it.escrowed);
            }
            return;
        }

        // Residual side: pro-rata AMM out + unused escrow refund.
        // Opposite side: full refund (notional cancel vs AMM, not P2P fill).
        bool netZeroForOne = ep.zeroForOne;
        address netTokenIn = netZeroForOne ? address(token0) : address(token1);
        address outTok = netZeroForOne ? address(token1) : address(token0);
        uint256 sideTotal;
        uint256 residualSideCount;
        for (uint256 i = 0; i < ids.length; i++) {
            Intent storage it = intents[epochId][ids[i]];
            bool intentZeroForOne = it.signedAmount > 0;
            if (intentZeroForOne == netZeroForOne) {
                sideTotal += it.escrowed;
                residualSideCount += 1;
            }
        }

        uint256 consumedAllocated;
        uint256 outAllocated;
        uint256 residualSeen;

        for (uint256 i = 0; i < ids.length; i++) {
            Intent storage it = intents[epochId][ids[i]];
            if (it.settled) continue;
            it.settled = true;
            bool intentZeroForOne = it.signedAmount > 0;
            if (intentZeroForOne == netZeroForOne && sideTotal > 0) {
                residualSeen += 1;
                uint256 consumed;
                uint256 shareOut;
                if (residualSeen == residualSideCount) {
                    consumed = ep.absAmountIn - consumedAllocated;
                    shareOut = ep.amountOut - outAllocated;
                } else {
                    consumed = (ep.absAmountIn * it.escrowed) / sideTotal;
                    shareOut = (ep.amountOut * it.escrowed) / sideTotal;
                    consumedAllocated += consumed;
                    outAllocated += shareOut;
                }
                if (consumed > it.escrowed) consumed = it.escrowed;
                uint256 refundIn = it.escrowed > consumed ? it.escrowed - consumed : 0;
                if (refundIn > 0) IERC20(netTokenIn).safeTransfer(it.trader, refundIn);
                if (shareOut > 0) IERC20(outTok).safeTransfer(it.trader, shareOut);
                emit IntentSettled(epochId, ids[i], it.trader, shareOut);
            } else {
                IERC20(it.tokenIn).safeTransfer(it.trader, it.escrowed);
                emit IntentSettled(epochId, ids[i], it.trader, it.escrowed);
            }
        }
    }

    function _openEpoch() internal {
        currentEpochId += 1;
        uint64 openB = uint64(block.number);
        uint64 closeB = uint64(block.number + epochDurationBlocks);
        epochs[currentEpochId] = Epoch({
            state: EpochState.Open,
            openBlock: openB,
            closeBlock: closeB,
            netSigned: 0,
            netHandle: bytes32(0),
            zeroForOne: false,
            absAmountIn: 0,
            amountOut: 0,
            participantCount: 0
        });
        emit EpochOpened(currentEpochId, openB, closeB);
    }

    // -------- views for UI --------

    function getEpoch(uint256 epochId) external view returns (Epoch memory) {
        return epochs[epochId];
    }

    function getEpochIntentIds(uint256 epochId) external view returns (uint256[] memory) {
        return epochIntentIds[epochId];
    }

    function getTraderIntentIds(address trader, uint256 epochId)
        external
        view
        returns (uint256[] memory)
    {
        return traderIntentIds[trader][epochId];
    }

    function getIntent(uint256 epochId, uint256 intentId) external view returns (Intent memory) {
        return intents[epochId][intentId];
    }

    /// @notice Mock "user decrypt" — returns the trader's own signed amount if caller is trader.
    function decryptOwnIntent(uint256 epochId, uint256 intentId)
        external
        view
        returns (int256 signedAmount, bytes32 handle)
    {
        Intent storage it = intents[epochId][intentId];
        require(it.trader == msg.sender, "not yours");
        return (it.signedAmount, it.handle);
    }

    /// @notice Mock publicDecrypt of net after close
    function publicDecryptNet(uint256 epochId) external view returns (int256 netSigned, bytes32 netHandle) {
        Epoch storage ep = epochs[epochId];
        require(
            ep.state == EpochState.Closed || ep.state == EpochState.Executed, "not public"
        );
        return (ep.netSigned, ep.netHandle);
    }
}
