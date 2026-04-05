// This script registers an auditor and casts a vote directly on Sepolia
// Run with: npx hardhat run scripts/interact.js --network sepolia

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Using wallet:", deployer.address);

  // Read the deployed address from our saved file
  const addresses = require("../deployed-addresses.json");
  console.log("TraceableHands address:", addresses.traceableHands);

  // Get the contract instance
  const TH = await ethers.getContractFactory("TraceableHands");
  const th = TH.attach(addresses.traceableHands);

  // ---- Step 1: Register as auditor ----
  console.log("\nRegistering as auditor...");
  try {
    const tx1 = await th.registerAsAuditor();
    await tx1.wait();
    console.log("Registered as auditor!");
  } catch (err) {
    // If already registered, skip gracefully
    console.log("Already registered as auditor, skipping...");
  }

  // ---- Step 2: Cast approval vote ----
  console.log("\nCasting audit vote...");
  try {
    const tx2 = await th.verify(0, true, "QmTestEvidenceHash123");
    await tx2.wait();
    console.log("Vote cast successfully!");
  } catch (err) {
    console.log("Vote error:", err.message);
  }

  // ---- Step 3: Check results ----
  console.log("\nChecking results...");
  const milestone = await th.getMilestone(0);
  const stateNames = ["Funding", "AuditPending", "Completed", "Failed", "Cancelled"];
  console.log("Milestone state:", stateNames[Number(milestone.state)]);

  const rep = await th.getVendorReputation(deployer.address);
  console.log("Vendor reputation:", rep.toString());

  if (Number(milestone.state) === 2) {
    console.log("\nMilestone COMPLETED! Full flow working end to end.");
  } else {
    console.log("\nMilestone not completed yet. State:", Number(milestone.state));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
