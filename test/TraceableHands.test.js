// We use Hardhat's built-in testing framework (ethers.js + Mocha + Chai).
// Mocha provides describe() and it() for structuring tests.
// Chai provides expect() for assertions.
const { expect } = require("chai");
const { ethers } = require("hardhat");

// describe() groups related tests together.
// Think of it as a chapter heading.
describe("TraceableHands", function () {

  // These variables are shared across all tests in this block.
  let traceableHands;  // The main contract instance
  let mockUSDC;        // The fake token contract instance
  let owner;           // The deployer wallet (us)
  let charity;         // A test wallet acting as the charity
  let vendor;          // A test wallet acting as the vendor
  let donor1;          // Test wallets acting as donors
  let donor2;
  let auditor1;        // Test wallets acting as auditors

  // beforeEach() runs BEFORE every single test.
  // This gives each test a fresh, clean state.
  // Without this, state from one test would bleed into the next.
  beforeEach(async function () {

    // ethers.getSigners() gives us test wallet addresses.
    // Hardhat automatically creates 20 of them, funded with fake ETH.
    [owner, charity, vendor, donor1, donor2, auditor1] = await ethers.getSigners();

    // Deploy MockUSDC first, because TraceableHands needs its address.
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();

    // Deploy the main contract, passing the MockUSDC address.
    const TraceableHands = await ethers.getContractFactory("TraceableHands");
    traceableHands = await TraceableHands.deploy(await mockUSDC.getAddress());
    await traceableHands.waitForDeployment();

    // Give donor1 and donor2 some test USDC to work with.
    // We use the faucet() function we wrote in MockUSDC.
    // 1000 USDC = 1000 * 10^6 (because 6 decimals)
    const oneThousandUSDC = ethers.parseUnits("1000", 6);
    await mockUSDC.connect(donor1).faucet(oneThousandUSDC);
    await mockUSDC.connect(donor2).faucet(oneThousandUSDC);
  });

  // ============================================================
  // TEST GROUP 1: Deployment
  // ============================================================
  describe("Deployment", function () {
    it("Should set the correct donation token address", async function () {
      // We check that the contract stored the right USDC address.
      expect(await traceableHands.donationToken()).to.equal(
        await mockUSDC.getAddress()
      );
    });

    it("Should set the deployer as owner", async function () {
      expect(await traceableHands.owner()).to.equal(owner.address);
    });

    it("Should start with zero milestones", async function () {
      expect(await traceableHands.milestoneCount()).to.equal(0);
    });
  });

  // ============================================================
  // TEST GROUP 2: createMilestone()
  // ============================================================
  describe("createMilestone()", function () {

    it("Should create a milestone with correct data", async function () {
      const goalAmount = ethers.parseUnits("500", 6); // 500 USDC
      const duration = 30; // 30 days

      // The charity creates a milestone.
      // .connect(charity) means this call comes FROM the charity wallet.
      await traceableHands.connect(charity).createMilestone(
        goalAmount,
        vendor.address,
        "Buy 500 meals for flood victims",
        duration
      );

      // Fetch the created milestone and check its fields.
      const milestone = await traceableHands.getMilestone(0);

      expect(milestone.charity).to.equal(charity.address);
      expect(milestone.vendorAddress).to.equal(vendor.address);
      expect(milestone.goalAmount).to.equal(goalAmount);
      expect(milestone.currentBalance).to.equal(0);
      expect(milestone.state).to.equal(0); // 0 = Funding state
    });

    it("Should reject a milestone with goal of zero", async function () {
      // We use revertedWith to check that the function throws
      // the correct error message when given bad input.
      await expect(
        traceableHands.connect(charity).createMilestone(
          0, // Bad: goal of zero
          vendor.address,
          "Test milestone",
          30
        )
      ).to.be.revertedWith("Goal amount must be greater than zero");
    });

    it("Should increment milestoneCount after creation", async function () {
      await traceableHands.connect(charity).createMilestone(
        ethers.parseUnits("100", 6),
        vendor.address,
        "First milestone",
        10
      );
      await traceableHands.connect(charity).createMilestone(
        ethers.parseUnits("200", 6),
        vendor.address,
        "Second milestone",
        10
      );

      expect(await traceableHands.milestoneCount()).to.equal(2);
    });
  });

  // ============================================================
  // TEST GROUP 3: donate()
  // ============================================================
  describe("donate()", function () {
    // Before each donation test, create a milestone to donate to.
    beforeEach(async function () {
      await traceableHands.connect(charity).createMilestone(
        ethers.parseUnits("500", 6),
        vendor.address,
        "Test milestone for donations",
        30
      );
    });

    it("Should accept a valid donation and update balance", async function () {
      const donationAmount = ethers.parseUnits("100", 6); // 100 USDC

      // IMPORTANT: Before donating, the donor must approve the contract.
      // This is the ERC-20 flow: donor says "I allow TraceableHands
      // to spend up to 100 USDC on my behalf."
      await mockUSDC.connect(donor1).approve(
        await traceableHands.getAddress(),
        donationAmount
      );

      // Now donate.
      await traceableHands.connect(donor1).donate(0, donationAmount);

      // Check the milestone balance increased.
      const milestone = await traceableHands.getMilestone(0);
      expect(milestone.currentBalance).to.equal(donationAmount);

      // Check donor1's contribution was recorded.
      expect(
        await traceableHands.donorContributions(0, donor1.address)
      ).to.equal(donationAmount);
    });

    it("Should release 50% to vendor when goal is reached", async function () {
      const goal = ethers.parseUnits("500", 6);
      const vendorBalanceBefore = await mockUSDC.balanceOf(vendor.address);

      // Approve and donate the full goal amount.
      await mockUSDC.connect(donor1).approve(await traceableHands.getAddress(), goal);
      await traceableHands.connect(donor1).donate(0, goal);

      const vendorBalanceAfter = await mockUSDC.balanceOf(vendor.address);

      // Vendor should have received exactly 50% of goal.
      expect(vendorBalanceAfter - vendorBalanceBefore).to.equal(goal / 2n);

      // Milestone state should now be AuditPending (state = 1).
      const milestone = await traceableHands.getMilestone(0);
      expect(milestone.state).to.equal(1); // AuditPending
    });
  });

  // ============================================================
  // TEST GROUP 4: Full happy path (donation → audit → completion)
  // ============================================================
  describe("Full flow: donate → audit → complete", function () {
    it("Should complete a milestone end-to-end", async function () {
      const goal = ethers.parseUnits("200", 6);

      // Step 1: Create milestone
      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Full flow test", 30
      );

      // Step 2: Donate full amount
      await mockUSDC.connect(donor1).approve(await traceableHands.getAddress(), goal);
      await traceableHands.connect(donor1).donate(0, goal);

      // State should be AuditPending now
      expect((await traceableHands.getMilestone(0)).state).to.equal(1);

      // Step 3: Register auditors
      await traceableHands.connect(auditor1).registerAsAuditor();
      // Register more auditors as needed... for MVP new vendor needs 3.
      // For this test let's use the charity as the second and donor2 as third.
      await traceableHands.connect(charity).registerAsAuditor();
      await traceableHands.connect(donor2).registerAsAuditor();

      // Step 4: Auditors vote to approve
      const fakeCID = "QmTestIPFSHashABC123";
      await traceableHands.connect(auditor1).verify(0, true, fakeCID);
      await traceableHands.connect(charity).verify(0, true, fakeCID);
      await traceableHands.connect(donor2).verify(0, true, fakeCID);

      // Step 5: Milestone should now be Completed
      const milestone = await traceableHands.getMilestone(0);
      expect(milestone.state).to.equal(2); // Completed

      // Step 6: Vendor reputation should be 1
      expect(await traceableHands.getVendorReputation(vendor.address)).to.equal(1);
    });
  });

  // ============================================================
  // TEST GROUP 5: Refund mechanism
  // ============================================================
  describe("claimRefund()", function () {
    it("Should allow refund when milestone fails", async function () {
      const goal = ethers.parseUnits("500", 6);
      const donation = ethers.parseUnits("100", 6);

      // Create milestone and donate (without reaching goal)
      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Refund test", 30
      );
      await mockUSDC.connect(donor1).approve(await traceableHands.getAddress(), donation);
      await traceableHands.connect(donor1).donate(0, donation);

      // Fast-forward time past the deadline using Hardhat's time helper.
      // This simulates the blockchain moving forward in time.
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]); // 31 days in seconds
      await ethers.provider.send("evm_mine"); // Mine a new block to apply the time change

      const balanceBefore = await mockUSDC.balanceOf(donor1.address);

      // Donor claims their refund
      await traceableHands.connect(donor1).claimRefund(0);

      const balanceAfter = await mockUSDC.balanceOf(donor1.address);

      // Donor should have gotten their 100 USDC back
      expect(balanceAfter - balanceBefore).to.equal(donation);
    });
  });
});