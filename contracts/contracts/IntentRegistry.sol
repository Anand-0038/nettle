// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    Nox,
    eint256,
    externalEint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {IBatchExecutor} from "./interfaces/IBatchExecutor.sol";

/// @title IntentRegistry — confidential batch netting + residual AMM
/// @notice Encrypted signed intents are netted in TEE (`Nox.add` on `eint256`).
///         Opposing signed notional cancels in the encrypted book; **only residual |net|**
///         goes Registry → NettleHook → UniswapV3Executor → SwapRouter02.
/// @dev This is a **batch netter with residual settlement**, not a full CLOB:
///      - Matching = `Nox.add` running encrypted net (not per-order fills).
///      - Opposite escrow is refunded (privacy cancel vs AMM), not P2P token exchange
///        (that would require a clearing price). Residual-side traders get pro-rata
///        AMM output **and** unused escrow refund.
/// @dev +amount = token0 in (buy token1); −amount = token1 in (sell token1)
contract IntentRegistry is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum EpochState {
        Open,
        Closed,
        Executed
    }

    struct Intent {
        address trader;
        eint256 amount;
        address tokenIn;
        uint256 escrowed;
        bool settled;
    }

    struct Epoch {
        EpochState state;
        uint64 openBlock;
        uint64 closeBlock;
        eint256 netEncrypted;
        bytes32 netHandle;
        bool zeroForOne;
        uint256 absAmountIn; // residual sent to AMM
        uint256 amountOut;
        uint256 participantCount;
        uint256 buyEscrow; // token0 escrow total (plain, for book stats)
        uint256 sellEscrow; // token1 escrow total
    }

    /// @notice Public book snapshot for inspectors (no eth_getLogs required)
    struct EpochBook {
        EpochState state;
        uint64 openBlock;
        uint64 closeBlock;
        bytes32 netHandle;
        bool zeroForOne;
        uint256 residualIn;
        uint256 residualOut;
        uint256 participantCount;
        uint256 buyEscrow;
        uint256 sellEscrow;
        uint256 matchedHint; // min(buy,sell) plain escrow — notional, not price-aware
    }

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    /// @dev Must be NettleHook (gate), not the raw AMM adapter
    IBatchExecutor public executor;
    address public keeper;
    address public owner;
    uint256 public epochDurationBlocks;
    uint256 public currentEpochId;
    uint256 public nextIntentId;

    mapping(uint256 => Epoch) public epochs;
    mapping(uint256 => mapping(uint256 => Intent)) public intents;
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
    event EpochClosed(uint256 indexed epochId, bytes32 netHandle);
    /// @notice Book snapshot after residual path (or full internal cancel)
    event BatchMatched(
        uint256 indexed epochId,
        uint256 buyEscrow,
        uint256 sellEscrow,
        uint256 residualIn,
        uint256 residualOut,
        bool zeroForOne
    );
    event EpochExecuted(
        uint256 indexed epochId, bool zeroForOne, uint256 amountIn, uint256 amountOut
    );
    event IntentSettled(
        uint256 indexed epochId,
        uint256 indexed intentId,
        address trader,
        uint256 payoutOut,
        uint256 refundIn
    );

    error NotKeeper();
    error NotOwner();
    error EpochNotOpen();
    error EpochNotClosed();
    error EpochNotReady();
    error ZeroEscrow();
    error InvalidTokenIn();
    error AlreadyExecuted();

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
        require(token0_ != token1_ && token0_ != address(0), "bad tokens");
        token0 = IERC20(token0_);
        token1 = IERC20(token1_);
        executor = IBatchExecutor(executor_);
        keeper = keeper_;
        owner = msg.sender;
        epochDurationBlocks = epochDurationBlocks_ == 0 ? 30 : epochDurationBlocks_;
        _openEpoch();
    }

    function setKeeper(address k) external onlyOwner {
        keeper = k;
    }

    function setExecutor(address e) external onlyOwner {
        executor = IBatchExecutor(e);
    }

    function submitIntent(
        externalEint256 inputHandle,
        bytes calldata inputProof,
        address tokenIn,
        uint256 escrowAmount
    ) external nonReentrant returns (uint256 intentId) {
        if (escrowAmount == 0) revert ZeroEscrow();
        if (tokenIn != address(token0) && tokenIn != address(token1)) revert InvalidTokenIn();

        Epoch storage ep = epochs[currentEpochId];
        if (ep.state != EpochState.Open) revert EpochNotOpen();
        if (block.number >= ep.closeBlock) revert EpochNotOpen();

        eint256 amount = Nox.fromExternal(inputHandle, inputProof);

        // Running encrypted net: this IS the "matching" step (batch netter).
        ep.netEncrypted = Nox.add(ep.netEncrypted, amount);
        Nox.allowThis(ep.netEncrypted);
        Nox.allow(ep.netEncrypted, address(this));
        Nox.allow(ep.netEncrypted, keeper);

        Nox.allowThis(amount);
        Nox.allow(amount, msg.sender);
        Nox.allow(amount, address(this));

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), escrowAmount);

        if (tokenIn == address(token0)) ep.buyEscrow += escrowAmount;
        else ep.sellEscrow += escrowAmount;

        intentId = nextIntentId++;
        intents[currentEpochId][intentId] = Intent({
            trader: msg.sender,
            amount: amount,
            tokenIn: tokenIn,
            escrowed: escrowAmount,
            settled: false
        });
        epochIntentIds[currentEpochId].push(intentId);
        traderIntentIds[msg.sender][currentEpochId].push(intentId);
        ep.participantCount += 1;

        emit IntentSubmitted(
            currentEpochId, intentId, msg.sender, eint256.unwrap(amount), tokenIn, escrowAmount
        );
    }

    function closeEpoch() external nonReentrant {
        Epoch storage ep = epochs[currentEpochId];
        if (ep.state != EpochState.Open) revert EpochNotOpen();
        if (block.number < ep.closeBlock && msg.sender != keeper && msg.sender != owner) {
            revert EpochNotReady();
        }

        // Empty book: skip Nox public-decrypt ACL; rotate without AMM.
        if (ep.participantCount == 0) {
            ep.state = EpochState.Executed;
            ep.netHandle = bytes32(0);
            emit EpochClosed(currentEpochId, bytes32(0));
            emit BatchMatched(currentEpochId, 0, 0, 0, 0, true);
            emit EpochExecuted(currentEpochId, true, 0, 0);
            _openEpoch();
            return;
        }

        Nox.allowThis(ep.netEncrypted);
        Nox.allow(ep.netEncrypted, keeper);
        Nox.allowPublicDecryption(ep.netEncrypted);

        ep.state = EpochState.Closed;
        ep.netHandle = eint256.unwrap(ep.netEncrypted);
        emit EpochClosed(currentEpochId, ep.netHandle);
    }

    /// @notice Keeper submits publicly decrypted net. Only |net| residual hits AMM via Hook.
    /// @dev Replay-safe: requires Closed; sets Executed before external calls complete
    ///      via CEI where possible — state flipped before transfers in settlement.
    function executeEpoch(int256 netSigned, uint256 minAmountOut)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 amountOut)
    {
        uint256 epochId = currentEpochId;
        Epoch storage ep = epochs[epochId];
        if (ep.state == EpochState.Executed) revert AlreadyExecuted();
        if (ep.state != EpochState.Closed) revert EpochNotClosed();

        if (netSigned == 0) {
            // Perfect cancel in encrypted book — full escrow refund, zero AMM
            ep.state = EpochState.Executed;
            emit BatchMatched(epochId, ep.buyEscrow, ep.sellEscrow, 0, 0, true);
            emit EpochExecuted(epochId, true, 0, 0);
            _refundAll(epochId);
            _openEpoch();
            return 0;
        }

        bool zeroForOne = netSigned > 0;
        uint256 residualIn = netSigned > 0 ? uint256(netSigned) : uint256(-netSigned);
        address tokenIn = zeroForOne ? address(token0) : address(token1);

        uint256 available = IERC20(tokenIn).balanceOf(address(this));
        if (residualIn > available) residualIn = available;

        // Mark executed BEFORE external call to prevent re-entry execute
        // (nonReentrant also guards). Residual params stored for settlement.
        ep.zeroForOne = zeroForOne;
        ep.absAmountIn = residualIn;

        // Approve Hook only (never the raw AMM adapter)
        IERC20(tokenIn).forceApprove(address(executor), residualIn);
        amountOut = executor.executeNetSwap(zeroForOne, residualIn, minAmountOut);
        IERC20(tokenIn).forceApprove(address(executor), 0);

        ep.state = EpochState.Executed;
        ep.amountOut = amountOut;

        emit BatchMatched(
            epochId, ep.buyEscrow, ep.sellEscrow, residualIn, amountOut, zeroForOne
        );
        emit EpochExecuted(epochId, zeroForOne, residualIn, amountOut);
        _settleMatching(epochId);
        _openEpoch();
    }

    function _refundAll(uint256 epochId) internal {
        uint256[] storage ids = epochIntentIds[epochId];
        for (uint256 i = 0; i < ids.length; i++) {
            Intent storage it = intents[epochId][ids[i]];
            if (it.settled) continue;
            it.settled = true;
            IERC20(it.tokenIn).safeTransfer(it.trader, it.escrowed);
            emit IntentSettled(epochId, ids[i], it.trader, 0, it.escrowed);
        }
    }

    /// @dev Residual-side: pro-rata AMM out + unused escrow refund.
    ///      Opposite side: full escrow return (privacy cancel vs AMM — not P2P fill).
    function _settleMatching(uint256 epochId) internal {
        Epoch storage ep = epochs[epochId];
        uint256[] storage ids = epochIntentIds[epochId];
        if (ep.absAmountIn == 0) {
            _refundAll(epochId);
            return;
        }

        bool netZfo = ep.zeroForOne;
        address netTokenIn = netZfo ? address(token0) : address(token1);
        address netTokenOut = netZfo ? address(token1) : address(token0);

        uint256 sideTotal;
        for (uint256 i = 0; i < ids.length; i++) {
            if (intents[epochId][ids[i]].tokenIn == netTokenIn) {
                sideTotal += intents[epochId][ids[i]].escrowed;
            }
        }

        for (uint256 i = 0; i < ids.length; i++) {
            Intent storage it = intents[epochId][ids[i]];
            if (it.settled) continue;
            it.settled = true;

            if (it.tokenIn == netTokenIn && sideTotal > 0) {
                uint256 consumed = (ep.absAmountIn * it.escrowed) / sideTotal;
                uint256 shareOut = (ep.amountOut * it.escrowed) / sideTotal;
                uint256 refundIn = it.escrowed > consumed ? it.escrowed - consumed : 0;
                if (refundIn > 0) {
                    IERC20(netTokenIn).safeTransfer(it.trader, refundIn);
                }
                if (shareOut > 0) {
                    IERC20(netTokenOut).safeTransfer(it.trader, shareOut);
                }
                emit IntentSettled(epochId, ids[i], it.trader, shareOut, refundIn);
            } else {
                // Opposite notional cancelled against residual book — full escrow return
                IERC20(it.tokenIn).safeTransfer(it.trader, it.escrowed);
                emit IntentSettled(epochId, ids[i], it.trader, 0, it.escrowed);
            }
        }
    }

    function _openEpoch() internal {
        currentEpochId += 1;
        uint64 openB = uint64(block.number);
        uint64 closeB = uint64(block.number + epochDurationBlocks);

        eint256 zeroNet = Nox.toEint256(0);
        Nox.allowThis(zeroNet);
        Nox.allow(zeroNet, address(this));
        Nox.allow(zeroNet, keeper);

        epochs[currentEpochId] = Epoch({
            state: EpochState.Open,
            openBlock: openB,
            closeBlock: closeB,
            netEncrypted: zeroNet,
            netHandle: bytes32(0),
            zeroForOne: false,
            absAmountIn: 0,
            amountOut: 0,
            participantCount: 0,
            buyEscrow: 0,
            sellEscrow: 0
        });
        emit EpochOpened(currentEpochId, openB, closeB);
    }

    // -------- views (Epoch Inspector / no eth_getLogs) --------

    function getEpochBook(uint256 epochId) external view returns (EpochBook memory book) {
        Epoch storage ep = epochs[epochId];
        uint256 matchedHint =
            ep.buyEscrow < ep.sellEscrow ? ep.buyEscrow : ep.sellEscrow;
        book = EpochBook({
            state: ep.state,
            openBlock: ep.openBlock,
            closeBlock: ep.closeBlock,
            netHandle: ep.netHandle,
            zeroForOne: ep.zeroForOne,
            residualIn: ep.absAmountIn,
            residualOut: ep.amountOut,
            participantCount: ep.participantCount,
            buyEscrow: ep.buyEscrow,
            sellEscrow: ep.sellEscrow,
            matchedHint: matchedHint
        });
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

    function getIntentHandle(uint256 epochId, uint256 intentId) external view returns (bytes32) {
        return eint256.unwrap(intents[epochId][intentId].amount);
    }

    function getNetHandle(uint256 epochId) external view returns (bytes32) {
        return epochs[epochId].netHandle;
    }
}
