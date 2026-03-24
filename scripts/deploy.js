/**
 * Deploy IL Protection Hook V4
 *
 * V4 hooks need to be deployed at specific addresses where
 * the least significant bits encode which hooks are active.
 *
 * Our hooks: afterInitialize (bit 12) + afterAddLiquidity (bit 10) + beforeSwap (bit 7)
 * Required flags: 0x1480
 *
 * Uses CREATE2 to mine an address with correct flags.
 */

const hre = require("hardhat");

// CREATE2 deployer (same on all chains)
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

// Hook flags
const AFTER_INITIALIZE = 1 << 12;      // 0x1000
const AFTER_ADD_LIQUIDITY = 1 << 10;   // 0x0400
const BEFORE_SWAP = 1 << 7;            // 0x0080

const REQUIRED_FLAGS = AFTER_INITIALIZE | AFTER_ADD_LIQUIDITY | BEFORE_SWAP; // 0x1480

// Uniswap V4 PoolManager addresses per chain
const POOL_MANAGERS = {
  1:     "0x000000000004444c5dc75cB358380D2e3dE08A90", // Ethereum
  42161: "0x000000000004444c5dc75cB358380D2e3dE08A90", // Arbitrum
  8453:  "0x000000000004444c5dc75cB358380D2e3dE08A90", // Base
  10:    "0x000000000004444c5dc75cB358380D2e3dE08A90", // Optimism
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  console.log("="  .repeat(60));
  console.log("  IL Protection Hook V4 - Deployment");
  console.log("=" .repeat(60));
  console.log(`  Chain: ${chainId}`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`  Required address flags: 0x${REQUIRED_FLAGS.toString(16)}`);

  const poolManager = POOL_MANAGERS[Number(chainId)];
  if (!poolManager) {
    throw new Error(`No PoolManager for chain ${chainId}`);
  }
  console.log(`  PoolManager: ${poolManager}`);

  // Get contract bytecode
  const Hook = await hre.ethers.getContractFactory("ILProtectionHookV4");
  const constructorArgs = hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["address"],
    [poolManager]
  );
  const creationCode = Hook.bytecode + constructorArgs.slice(2);
  const codeHash = hre.ethers.keccak256(creationCode);

  console.log(`\n  Mining CREATE2 salt for address with flags 0x${REQUIRED_FLAGS.toString(16)}...`);

  // Mine salt
  let salt;
  let hookAddress;
  const FLAG_MASK = 0x3FFF; // Lower 14 bits

  for (let i = 0; i < 10000000; i++) {
    // Random salt
    const testSalt = hre.ethers.keccak256(
      hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [deployer.address, i]
      )
    );

    // Compute CREATE2 address
    const addr = hre.ethers.getCreate2Address(CREATE2_DEPLOYER, testSalt, codeHash);
    const addrNum = BigInt(addr);
    const flags = Number(addrNum & BigInt(FLAG_MASK));

    // Check if flags match
    if ((flags & REQUIRED_FLAGS) === REQUIRED_FLAGS) {
      // Make sure NO unwanted flags are set
      const unwanted = flags & ~REQUIRED_FLAGS;
      if (unwanted === 0) {
        salt = testSalt;
        hookAddress = addr;
        console.log(`  Found! Salt index: ${i}`);
        console.log(`  Salt: ${salt}`);
        console.log(`  Hook address: ${hookAddress}`);
        console.log(`  Flags: 0x${flags.toString(16)} (required: 0x${REQUIRED_FLAGS.toString(16)})`);
        break;
      }
    }

    if (i % 100000 === 0 && i > 0) {
      console.log(`  Tried ${i} salts...`);
    }
  }

  if (!salt) {
    console.log("  Could not find valid salt in 10M attempts");
    console.log("  Try running again or increase attempts");
    return;
  }

  // Deploy via CREATE2
  console.log(`\n  Deploying via CREATE2...`);

  const create2Deployer = new hre.ethers.Contract(
    CREATE2_DEPLOYER,
    ["function deploy(uint256 amount, bytes32 salt, bytes memory bytecode) public returns (address)"],
    deployer
  );

  try {
    const tx = await create2Deployer.deploy(0, salt, creationCode, {
      gasLimit: 5000000,
    });
    const receipt = await tx.wait();

    console.log(`  Deployed!`);
    console.log(`  TX: ${receipt.hash}`);
    console.log(`  Hook address: ${hookAddress}`);
    console.log(`  Gas used: ${receipt.gasUsed}`);

    // Save deployment info
    const fs = require("fs");
    fs.writeFileSync("deployment.json", JSON.stringify({
      chain: Number(chainId),
      hook: hookAddress,
      poolManager: poolManager,
      deployer: deployer.address,
      salt: salt,
      flags: `0x${REQUIRED_FLAGS.toString(16)}`,
      timestamp: new Date().toISOString(),
    }, null, 2));

    console.log(`\n  Saved to deployment.json`);
    console.log(`\n  NEXT STEPS:`);
    console.log(`  1. Create a pool with this hook attached`);
    console.log(`  2. The hook will automatically protect LPs from IL`);
    console.log(`  3. Monitor fee adjustments via events`);

  } catch (e) {
    console.log(`  Deploy failed: ${e.message}`);
    console.log(`\n  Alternative: Deploy on testnet first`);
    console.log(`  npx hardhat run scripts/deploy.js --network arbitrum_sepolia`);
  }
}

main().catch(console.error);
