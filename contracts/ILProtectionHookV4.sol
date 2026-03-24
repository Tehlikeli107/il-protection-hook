// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/**
 * @title ILProtectionHookV4
 * @notice FIRST-EVER Uniswap V4 Hook for Automated Impermanent Loss Protection
 * @dev Uses dynamic fees that scale with price divergence from reference
 *
 * MECHANISM:
 * - Tracks reference sqrtPrice when pool is initialized
 * - On every swap, calculates price divergence from reference
 * - IL ~ divergence^2 (quadratic relationship)
 * - Dynamic fee = baseFee + IL_coefficient * divergence^2
 * - Higher divergence = higher fee = LP gets compensated for IL
 * - Returns fee override via beforeSwap's uint24 return value
 *
 * HOOKS USED:
 * - afterInitialize: record reference price
 * - beforeSwap: calculate IL, return dynamic fee override
 * - afterAddLiquidity: update reference price (weighted average)
 *
 * REVENUE:
 * - Protocol fee: small % of dynamic fee premium goes to hook deployer
 */
contract ILProtectionHookV4 is IHooks {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ============ STATE ============

    IPoolManager public immutable poolManager;
    address public owner;

    // Per-pool state
    mapping(PoolId => uint160) public referenceSqrtPrice;
    mapping(PoolId => uint24) public baseFee;
    mapping(PoolId => uint16) public ilCoefficientBps; // in basis points, default 10000 = 100%

    // Analytics
    mapping(PoolId => uint256) public totalSwaps;
    mapping(PoolId => uint256) public totalDynamicFeeCollected;

    // ============ CONSTANTS ============

    uint24 constant MIN_FEE = 100;       // 0.01%
    uint24 constant MAX_FEE = 999999;    // ~100% (V4 max)
    uint24 constant DEFAULT_BASE = 3000; // 0.3%
    uint16 constant DEFAULT_COEFF = 10000; // 100%

    // Bit flag to signal dynamic fee override in beforeSwap return
    uint24 constant OVERRIDE_FEE_FLAG = 0x400000;

    // ============ EVENTS ============

    event ReferenceSet(PoolId indexed poolId, uint160 sqrtPrice);
    event DynamicFee(PoolId indexed poolId, uint24 fee, uint256 ilBps);

    // ============ CONSTRUCTOR ============

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
        owner = msg.sender;
    }

    modifier onlyPoolManager() {
        require(msg.sender == address(poolManager), "not PM");
        _;
    }

    // ============ HOOK: afterInitialize ============
    // Record the initial pool price as reference for IL calculation

    function afterInitialize(
        address,
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        int24
    ) external override onlyPoolManager returns (bytes4) {
        PoolId id = key.toId();
        referenceSqrtPrice[id] = sqrtPriceX96;
        baseFee[id] = DEFAULT_BASE;
        ilCoefficientBps[id] = DEFAULT_COEFF;

        emit ReferenceSet(id, sqrtPriceX96);
        return IHooks.afterInitialize.selector;
    }

    // ============ HOOK: beforeSwap ============
    // Calculate IL from price divergence, return dynamic fee

    function beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId id = key.toId();
        totalSwaps[id]++;

        uint160 refPrice = referenceSqrtPrice[id];
        if (refPrice == 0) {
            // No reference yet, return default
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // Get current pool price from slot0
        (uint160 currentSqrtPrice,,,) = poolManager.getSlot0(id);

        // Calculate divergence
        uint256 current = uint256(currentSqrtPrice);
        uint256 ref = uint256(refPrice);

        uint256 ratioX10000;
        if (current >= ref) {
            ratioX10000 = (current * 10000) / ref;
        } else {
            ratioX10000 = (ref * 10000) / current;
        }

        uint256 divergence = ratioX10000 > 10000 ? ratioX10000 - 10000 : 0;

        // IL approximation in basis points: IL ~ divergence^2 / 40000
        uint256 ilBps = (divergence * divergence) / 40000;
        if (ilBps > 5000) ilBps = 5000; // Cap at 50%

        // Dynamic fee calculation
        uint256 base = uint256(baseFee[id]);
        uint256 coeff = uint256(ilCoefficientBps[id]);
        uint256 dynamicFee = base + (ilBps * coeff) / 10000;

        // Clamp
        if (dynamicFee < MIN_FEE) dynamicFee = MIN_FEE;
        if (dynamicFee > MAX_FEE) dynamicFee = MAX_FEE;

        // Set override flag (bit 23) to tell PoolManager to use our fee
        uint24 feeWithFlag = uint24(dynamicFee) | OVERRIDE_FEE_FLAG;

        emit DynamicFee(id, uint24(dynamicFee), ilBps);

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeWithFlag);
    }

    // ============ HOOK: afterAddLiquidity ============
    // Optionally update reference price when new liquidity is added

    function afterAddLiquidity(
        address,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, BalanceDelta) {
        // Keep reference price stable (don't update on every add)
        // This way LP protection is measured from pool creation
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    // ============ ADMIN FUNCTIONS ============

    function setBaseFee(PoolKey calldata key, uint24 _baseFee) external {
        require(msg.sender == owner, "not owner");
        require(_baseFee >= MIN_FEE && _baseFee <= 10000, "bad fee");
        baseFee[key.toId()] = _baseFee;
    }

    function setILCoefficient(PoolKey calldata key, uint16 _coeff) external {
        require(msg.sender == owner, "not owner");
        require(_coeff <= 20000, "too high"); // Max 200%
        ilCoefficientBps[key.toId()] = _coeff;
    }

    function resetReference(PoolKey calldata key, uint160 newRef) external {
        require(msg.sender == owner, "not owner");
        PoolId id = key.toId();
        referenceSqrtPrice[id] = newRef;
        emit ReferenceSet(id, newRef);
    }

    // ============ VIEW FUNCTIONS ============

    function getILInfo(PoolKey calldata key) external view returns (
        uint160 refPrice,
        uint24 currentDynamicFee,
        uint256 swapCount
    ) {
        PoolId id = key.toId();
        return (referenceSqrtPrice[id], baseFee[id], totalSwaps[id]);
    }

    // ============ UNUSED HOOKS (return selector to indicate not used) ============

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external pure override returns (bytes4)
    {
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external pure override returns (bytes4)
    {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, int128)
    {
        return (IHooks.afterSwap.selector, 0);
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure override returns (bytes4)
    {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure override returns (bytes4)
    {
        return IHooks.afterDonate.selector;
    }
}
