/**
 * Create a Uniswap V4 pool with IL Protection Hook attached
 *
 * Steps:
 * 1. Initialize a new pool on V4 PoolManager with our hook
 * 2. Add initial liquidity
 * 3. The hook will start protecting LPs from IL automatically
 */

const hre = require("hardhat");
require("dotenv").config();

const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const HOOK_ADDRESS = "0x5330fe57f714966545Ff6FfAE402118BBc619480";

// Arbitrum tokens
const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

// V4 uses DYNAMIC_FEE_FLAG for hooks that override fees
const DYNAMIC_FEE_FLAG = 0x800000; // Bit 23

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("="  .repeat(60));
  console.log("  Create Uniswap V4 Pool with IL Protection Hook");
  console.log("=" .repeat(60));
  console.log(`  Deployer: ${deployer.address}`);

  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`  Balance: ${hre.ethers.formatEther(bal)} ETH`);
  console.log(`  Hook: ${HOOK_ADDRESS}`);

  // PoolManager interface
  const poolManagerAbi = [
    "function initialize(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) external returns (int24 tick)",
  ];

  const poolManager = new hre.ethers.Contract(POOL_MANAGER, poolManagerAbi, deployer);

  // Sort tokens (V4 requires currency0 < currency1)
  let currency0, currency1;
  if (USDC.toLowerCase() < WETH.toLowerCase()) {
    currency0 = USDC;
    currency1 = WETH;
  } else {
    currency0 = WETH;
    currency1 = USDC;
  }

  console.log(`\n  Currency0: ${currency0}`);
  console.log(`  Currency1: ${currency1}`);

  // Pool key
  const fee = DYNAMIC_FEE_FLAG; // Dynamic fee controlled by hook
  const tickSpacing = 60; // Standard for 0.3% fee tier

  const poolKey = {
    currency0: currency0,
    currency1: currency1,
    fee: fee,
    tickSpacing: tickSpacing,
    hooks: HOOK_ADDRESS,
  };

  // Initial price: ETH/USDC ~ $2100
  // sqrtPriceX96 = sqrt(price) * 2^96
  // For USDC/WETH pair where USDC is token0:
  // price = USDC_per_WETH = 2100
  // sqrtPrice = sqrt(2100) * 2^96 = ~45.83 * 79228162514264337593543950336
  // = ~3,631,405,299,806,987,076,902,879,232

  // Simpler: use tick-based price
  // tick = log(sqrt(price)) / log(sqrt(1.0001))
  // For price 2100: tick = log(2100) / log(1.0001) = ~76,532

  // sqrtPriceX96 for price ~2100 USDC per ETH
  // Using: sqrtPriceX96 = sqrt(2100 * 10^12) * 2^96 (adjusting for decimals: USDC=6, WETH=18)
  // Actually for V4: price = token1/token0 in raw units
  // If currency0=USDC(6dec), currency1=WETH(18dec):
  // raw_price = (1 WETH in raw) / (2100 USDC in raw) = 10^18 / (2100 * 10^6) = 10^12 / 2100
  // sqrtPriceX96 = sqrt(10^12/2100) * 2^96

  const priceRatio = 1e12 / 2100; // ~476190476
  const sqrtPrice = Math.sqrt(priceRatio);
  const sqrtPriceX96 = BigInt(Math.floor(sqrtPrice * (2 ** 96)));

  console.log(`\n  Fee: 0x${fee.toString(16)} (dynamic)`);
  console.log(`  Tick spacing: ${tickSpacing}`);
  console.log(`  sqrtPriceX96: ${sqrtPriceX96}`);
  console.log(`  Implied price: ~$${(Number(sqrtPriceX96) / (2**96))**2 * 1e12 / 1e6} USDC/WETH`);

  // Initialize pool
  console.log(`\n  Initializing pool...`);

  try {
    const tx = await poolManager.initialize(
      [currency0, currency1, fee, tickSpacing, HOOK_ADDRESS],
      sqrtPriceX96,
      { gasLimit: 1000000 }
    );

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Pool initialized!`);
    console.log(`  Gas used: ${receipt.gasUsed}`);
    console.log(`  Block: ${receipt.blockNumber}`);

    // Save pool info
    const fs = require("fs");
    const poolInfo = {
      hook: HOOK_ADDRESS,
      poolManager: POOL_MANAGER,
      currency0: currency0,
      currency1: currency1,
      fee: fee,
      tickSpacing: tickSpacing,
      sqrtPriceX96: sqrtPriceX96.toString(),
      initTx: receipt.hash,
      block: receipt.blockNumber,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync("pool_info.json", JSON.stringify(poolInfo, null, 2));
    console.log(`\n  Saved to pool_info.json`);

    console.log(`\n  POOL CREATED!`);
    console.log(`  Hook: ${HOOK_ADDRESS}`);
    console.log(`  Pair: WETH/USDC with IL Protection`);
    console.log(`\n  Next: Add liquidity to the pool`);

  } catch (e) {
    console.log(`  Error: ${e.message}`);

    if (e.message.includes("already initialized")) {
      console.log(`  Pool already exists!`);
    } else if (e.message.includes("insufficient funds")) {
      console.log(`  Not enough ETH for gas`);
    } else {
      console.log(`\n  Full error:`, e.reason || e.data || "unknown");
      console.log(`\n  This might fail because:`);
      console.log(`  1. PoolManager address might be different on Arbitrum`);
      console.log(`  2. Hook address flags might not match exactly`);
      console.log(`  3. Fee/tickSpacing combination might not be valid`);
      console.log(`\n  Check: https://arbiscan.io/address/${POOL_MANAGER}`);
    }
  }
}

main().catch(console.error);
