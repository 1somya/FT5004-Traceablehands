// Load environment variables from .env file
require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        // The optimizer reduces gas costs by simplifying bytecode.
        // 200 runs is a good balance between deploy cost and call cost.
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // "hardhat" is the built-in local test network.
    // It resets completely every time you run tests — perfect for testing.
    hardhat: {},

    // Sepolia is the Ethereum test network.
    // We only deploy here when we're confident the contract works locally.
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY], // Your wallet signs deployments
    },
  },
};