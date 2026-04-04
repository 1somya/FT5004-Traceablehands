// This script deploys both contracts to whatever network you specify.
// Run it with: npx hardhat run scripts/deploy.js --network hardhat
// Or for testnet: npx hardhat run scripts/deploy.js --network sepolia

const { ethers } = require("hardhat");

async function main() {
  // Get the deployer's wallet (the first account in your config)
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with wallet:", deployer.address);

  // Show your wallet balance so you know you have enough ETH for gas
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Wallet balance:", ethers.formatEther(balance), "ETH");

  // ---- Step 1: Deploy MockUSDC ----
  console.log("\nDeploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  const mockUSDCAddress = await mockUSDC.getAddress();
  console.log("MockUSDC deployed to:", mockUSDCAddress);

  // ---- Step 2: Deploy TraceableHands ----
  console.log("\nDeploying TraceableHands...");
  const TraceableHands = await ethers.getContractFactory("TraceableHands");
  const traceableHands = await TraceableHands.deploy(mockUSDCAddress);
  await traceableHands.waitForDeployment();
  const traceableHandsAddress = await traceableHands.getAddress();
  console.log("TraceableHands deployed to:", traceableHandsAddress);

  // ---- Save addresses to a file ----
  // We write these addresses to a JSON file so the frontend can read them.
  const fs = require("fs");
  const addresses = {
    mockUSDC: mockUSDCAddress,
    traceableHands: traceableHandsAddress,
    network: (await ethers.provider.getNetwork()).name,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    "deployed-addresses.json",
    JSON.stringify(addresses, null, 2)
  );
  console.log("\nAddresses saved to deployed-addresses.json");
  console.log("Deployment complete!");
}

// Standard pattern for running async scripts in Hardhat
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});