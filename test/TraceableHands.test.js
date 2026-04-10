const { expect } = require("chai");
const { ethers } = require("hardhat");

// VoteType enum values (must match Solidity enum order)
const VOTE_APPROVE           = 0;
const VOTE_NEEDS_MORE_PROOF  = 1;
const VOTE_REJECT            = 2;

// MilestoneState enum values (must match Solidity enum order)
const STATE_FUNDING       = 0;
const STATE_PROOF_PENDING = 1;
const STATE_VOTING_OPEN   = 2;
const STATE_COMPLETED     = 3;
const STATE_FAILED        = 4;

describe("TraceableHands", function () {

  let traceableHands;
  let mockUSDC;
  let owner;
  let charity;
  let vendor;
  let donor1;
  let donor2;
  let donor3;

  beforeEach(async function () {
    [owner, charity, vendor, donor1, donor2, donor3] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();

    const TraceableHands = await ethers.getContractFactory("TraceableHands");
    traceableHands = await TraceableHands.deploy(await mockUSDC.getAddress());
    await traceableHands.waitForDeployment();

    const oneThousandUSDC = ethers.parseUnits("1000", 6);
    await mockUSDC.connect(donor1).faucet(oneThousandUSDC);
    await mockUSDC.connect(donor2).faucet(oneThousandUSDC);
    await mockUSDC.connect(donor3).faucet(oneThousandUSDC);
  });

  // ============================================================
  // TEST GROUP 1: Deployment
  // ============================================================
  describe("Deployment", function () {
    it("Should set the correct donation token address", async function () {
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
      const goalAmount = ethers.parseUnits("500", 6);

      await traceableHands.connect(charity).createMilestone(
        goalAmount,
        vendor.address,
        "Buy 500 meals for flood victims",
        30
      );

      const milestone = await traceableHands.getMilestone(0);

      expect(milestone.charity).to.equal(charity.address);
      expect(milestone.vendorAddress).to.equal(vendor.address);
      expect(milestone.goalAmount).to.equal(goalAmount);
      expect(milestone.currentBalance).to.equal(0);
      expect(milestone.state).to.equal(STATE_FUNDING);
      expect(milestone.donorCount).to.equal(0);
    });

    it("Should reject a milestone with goal of zero", async function () {
      await expect(
        traceableHands.connect(charity).createMilestone(
          0, vendor.address, "Test milestone", 30
        )
      ).to.be.revertedWith("Goal amount must be greater than zero");
    });

    it("Should increment milestoneCount after creation", async function () {
      await traceableHands.connect(charity).createMilestone(
        ethers.parseUnits("100", 6), vendor.address, "First", 10
      );
      await traceableHands.connect(charity).createMilestone(
        ethers.parseUnits("200", 6), vendor.address, "Second", 10
      );

      expect(await traceableHands.milestoneCount()).to.equal(2);
    });
  });

  // ============================================================
  // TEST GROUP 3: donate()
  // ============================================================
  describe("donate()", function () {
    beforeEach(async function () {
      await traceableHands.connect(charity).createMilestone(
        ethers.parseUnits("500", 6),
        vendor.address,
        "Test milestone for donations",
        30
      );
    });

    it("Should accept a valid donation and update balance", async function () {
      const donationAmount = ethers.parseUnits("100", 6);

      await mockUSDC.connect(donor1).approve(
        await traceableHands.getAddress(), donationAmount
      );
      await traceableHands.connect(donor1).donate(0, donationAmount);

      const milestone = await traceableHands.getMilestone(0);
      expect(milestone.currentBalance).to.equal(donationAmount);
      expect(await traceableHands.donorContributions(0, donor1.address)).to.equal(donationAmount);
    });

    it("Should track unique donor count correctly", async function () {
      const amount = ethers.parseUnits("100", 6);

      await mockUSDC.connect(donor1).approve(await traceableHands.getAddress(), amount * 2n);
      await traceableHands.connect(donor1).donate(0, amount);
      await traceableHands.connect(donor1).donate(0, amount); // second donation from same donor

      const milestone = await traceableHands.getMilestone(0);
      expect(milestone.donorCount).to.equal(1); // still 1 unique donor
    });

    it("Should release 50% to vendor and move to ProofPending when goal is reached", async function () {
      const goal = ethers.parseUnits("500", 6);
      const vendorBalanceBefore = await mockUSDC.balanceOf(vendor.address);

      await mockUSDC.connect(donor1).approve(await traceableHands.getAddress(), goal);
      await traceableHands.connect(donor1).donate(0, goal);

      const vendorBalanceAfter = await mockUSDC.balanceOf(vendor.address);
      expect(vendorBalanceAfter - vendorBalanceBefore).to.equal(goal / 2n);

      const milestone = await traceableHands.getMilestone(0);
      expect(milestone.state).to.equal(STATE_PROOF_PENDING);
      expect(milestone.firstPaymentSent).to.equal(true);
    });
  });

  // ============================================================
  // TEST GROUP 4: submitProof()
  // ============================================================
  describe("submitProof()", function () {
    beforeEach(async function () {
      // Create milestone and reach goal so we're in ProofPending
      const goal = ethers.parseUnits("200", 6);
      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Proof test", 30
      );
      await mockUSDC.connect(donor1).approve(await traceableHands.getAddress(), goal);
      await traceableHands.connect(donor1).donate(0, goal);
    });

    it("Should allow the vendor to submit proof and open voting", async function () {
      const fakeCID = "QmTestIPFSHashABC123";
      await traceableHands.connect(vendor).submitProof(0, fakeCID);

      const milestone = await traceableHands.getMilestone(0);
      expect(milestone.state).to.equal(STATE_VOTING_OPEN);
      expect(milestone.proofCID).to.equal(fakeCID);
    });

    it("Should allow the charity to submit proof", async function () {
      await traceableHands.connect(charity).submitProof(0, "QmCharityCID");

      const milestone = await traceableHands.getMilestone(0);
      expect(milestone.state).to.equal(STATE_VOTING_OPEN);
    });

    it("Should reject proof submission from a random address", async function () {
      await expect(
        traceableHands.connect(donor1).submitProof(0, "QmFakeCID")
      ).to.be.revertedWith("Only the charity or vendor can submit proof");
    });

    it("Should reject an empty CID", async function () {
      await expect(
        traceableHands.connect(vendor).submitProof(0, "")
      ).to.be.revertedWith("Proof CID cannot be empty");
    });
  });

  // ============================================================
  // TEST GROUP 5: crowdVote() — happy path (Approve)
  // ============================================================
  describe("crowdVote() — approve path", function () {
    it("Should complete a milestone end-to-end with a single donor", async function () {
      const goal = ethers.parseUnits("200", 6);

      // Step 1: Create milestone
      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Full flow test", 30
      );

      // Step 2: donor1 donates the full goal → 50% sent, state = ProofPending
      await mockUSDC.connect(donor1).approve(await traceableHands.getAddress(), goal);
      await traceableHands.connect(donor1).donate(0, goal);
      expect((await traceableHands.getMilestone(0)).state).to.equal(STATE_PROOF_PENDING);

      // Step 3: Vendor submits proof → state = VotingOpen
      const fakeCID = "QmTestProofCID";
      await traceableHands.connect(vendor).submitProof(0, fakeCID);
      expect((await traceableHands.getMilestone(0)).state).to.equal(STATE_VOTING_OPEN);

      // Step 4: donor1 votes Approve
      // donorCount = 1, requiredVoters = min(3, 1) = 1 → decision reached immediately
      const vendorBalanceBefore = await mockUSDC.balanceOf(vendor.address);
      await traceableHands.connect(donor1).crowdVote(0, VOTE_APPROVE);

      // Step 5: Milestone should be Completed
      const milestone = await traceableHands.getMilestone(0);
      expect(milestone.state).to.equal(STATE_COMPLETED);

      // Step 6: Vendor received the remaining 50%
      const vendorBalanceAfter = await mockUSDC.balanceOf(vendor.address);
      expect(vendorBalanceAfter - vendorBalanceBefore).to.equal(goal / 2n);

      // Step 7: Vendor reputation incremented
      expect(await traceableHands.getVendorReputation(vendor.address)).to.equal(1);
    });

    it("Should require MIN_VOTERS (3) before deciding when enough donors exist", async function () {
      const goal = ethers.parseUnits("300", 6);

      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Three donor test", 30
      );

      // Three donors each donate 100 USDC
      const each = ethers.parseUnits("100", 6);
      for (const donor of [donor1, donor2, donor3]) {
        await mockUSDC.connect(donor).approve(await traceableHands.getAddress(), each);
        await traceableHands.connect(donor).donate(0, each);
      }
      // Goal reached → ProofPending
      expect((await traceableHands.getMilestone(0)).state).to.equal(STATE_PROOF_PENDING);

      await traceableHands.connect(vendor).submitProof(0, "QmThreeVotersCID");

      // First vote alone should NOT finalise (only 1 of 3 required voters)
      await traceableHands.connect(donor1).crowdVote(0, VOTE_APPROVE);
      expect((await traceableHands.getMilestone(0)).state).to.equal(STATE_VOTING_OPEN);

      // Second vote alone should NOT finalise (2 of 3 required, but 2*2=4 > 3, so majority reached)
      // Actually 2 approve out of 2 votes → 2*2=4 > 2, but we need totalVotes >= requiredVoters(3)
      await traceableHands.connect(donor2).crowdVote(0, VOTE_APPROVE);
      expect((await traceableHands.getMilestone(0)).state).to.equal(STATE_VOTING_OPEN);

      // Third vote reaches quorum and majority → Completed
      await traceableHands.connect(donor3).crowdVote(0, VOTE_APPROVE);
      expect((await traceableHands.getMilestone(0)).state).to.equal(STATE_COMPLETED);
    });
  });

  // ============================================================
  // TEST GROUP 6: crowdVote() — reject path
  // ============================================================
  describe("crowdVote() — reject path", function () {
    it("Should fail a milestone when majority rejects", async function () {
      const goal = ethers.parseUnits("300", 6);

      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Reject test", 30
      );

      const each = ethers.parseUnits("100", 6);
      for (const donor of [donor1, donor2, donor3]) {
        await mockUSDC.connect(donor).approve(await traceableHands.getAddress(), each);
        await traceableHands.connect(donor).donate(0, each);
      }

      await traceableHands.connect(vendor).submitProof(0, "QmRejectCID");

      // 2 reject votes out of 3 = majority reject
      await traceableHands.connect(donor1).crowdVote(0, VOTE_REJECT);
      await traceableHands.connect(donor2).crowdVote(0, VOTE_REJECT);
      await traceableHands.connect(donor3).crowdVote(0, VOTE_APPROVE);

      expect((await traceableHands.getMilestone(0)).state).to.equal(STATE_FAILED);
    });

    it("Should prevent a non-donor from voting", async function () {
      const goal = ethers.parseUnits("200", 6);

      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Non-donor test", 30
      );
      await mockUSDC.connect(donor1).approve(await traceableHands.getAddress(), goal);
      await traceableHands.connect(donor1).donate(0, goal);
      await traceableHands.connect(vendor).submitProof(0, "QmCID");

      // donor2 did NOT donate, so cannot vote
      await expect(
        traceableHands.connect(donor2).crowdVote(0, VOTE_APPROVE)
      ).to.be.revertedWith("Only donors to this milestone can vote");
    });

    it("Should prevent a donor from voting twice in the same round", async function () {
      const goal = ethers.parseUnits("200", 6);

      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Double vote test", 30
      );

      // Two donors so donorCount=2, requiredVoters=min(3,2)=2.
      // donor1's first vote alone won't finalise the milestone, keeping VotingOpen
      // so we can verify the duplicate-vote guard fires on the second attempt.
      const half = goal / 2n;
      await mockUSDC.connect(donor1).approve(await traceableHands.getAddress(), half);
      await traceableHands.connect(donor1).donate(0, half);
      await mockUSDC.connect(donor2).approve(await traceableHands.getAddress(), half);
      await traceableHands.connect(donor2).donate(0, half);

      await traceableHands.connect(vendor).submitProof(0, "QmCID");

      await traceableHands.connect(donor1).crowdVote(0, VOTE_APPROVE);

      await expect(
        traceableHands.connect(donor1).crowdVote(0, VOTE_REJECT)
      ).to.be.revertedWith("You have already voted in this round");
    });
  });

  // ============================================================
  // TEST GROUP 7: crowdVote() — needs more proof path
  // ============================================================
  describe("crowdVote() — needs-more-proof path", function () {
    it("Should reset voting and allow vendor to re-submit when majority votes NeedsMoreProof", async function () {
      const goal = ethers.parseUnits("300", 6);

      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Re-submit test", 30
      );

      const each = ethers.parseUnits("100", 6);
      for (const donor of [donor1, donor2, donor3]) {
        await mockUSDC.connect(donor).approve(await traceableHands.getAddress(), each);
        await traceableHands.connect(donor).donate(0, each);
      }

      await traceableHands.connect(vendor).submitProof(0, "QmWeakProofCID");

      // 2 out of 3 vote NeedsMoreProof → majority
      await traceableHands.connect(donor1).crowdVote(0, VOTE_NEEDS_MORE_PROOF);
      await traceableHands.connect(donor2).crowdVote(0, VOTE_NEEDS_MORE_PROOF);
      await traceableHands.connect(donor3).crowdVote(0, VOTE_APPROVE);

      // State should reset to ProofPending, proofRound incremented to 1
      const m = await traceableHands.getMilestone(0);
      expect(m.state).to.equal(STATE_PROOF_PENDING);
      expect(m.proofRound).to.equal(1);
      expect(m.approveVotes).to.equal(0);
      expect(m.needsMoreProofVotes).to.equal(0);
      expect(m.rejectVotes).to.equal(0);
      expect(m.proofCID).to.equal("");

      // Vendor re-submits with stronger proof
      await traceableHands.connect(vendor).submitProof(0, "QmStrongerProofCID");
      expect((await traceableHands.getMilestone(0)).state).to.equal(STATE_VOTING_OPEN);

      // Donors can vote again in round 1 (old hasVoted entries are for round 0)
      await traceableHands.connect(donor1).crowdVote(0, VOTE_APPROVE);
      await traceableHands.connect(donor2).crowdVote(0, VOTE_APPROVE);
      await traceableHands.connect(donor3).crowdVote(0, VOTE_APPROVE);
      expect((await traceableHands.getMilestone(0)).state).to.equal(STATE_COMPLETED);
    });

    it("Should fail after MAX_PROOF_ROUNDS (3) consecutive NeedsMoreProof outcomes", async function () {
      const goal = ethers.parseUnits("300", 6);

      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Max rounds test", 30
      );

      const each = ethers.parseUnits("100", 6);
      for (const donor of [donor1, donor2, donor3]) {
        await mockUSDC.connect(donor).approve(await traceableHands.getAddress(), each);
        await traceableHands.connect(donor).donate(0, each);
      }

      const th = traceableHands;

      // Repeat NeedsMoreProof for rounds 0, 1 (proofRound reaches 2 after round 0,
      // reaches 3 after round 1 — but MAX_PROOF_ROUNDS = 3, so round+1 >= 3 fails on
      // the third trigger when proofRound = 2)
      for (let round = 0; round < 2; round++) {
        await th.connect(vendor).submitProof(0, `QmRound${round}CID`);
        await th.connect(donor1).crowdVote(0, VOTE_NEEDS_MORE_PROOF);
        await th.connect(donor2).crowdVote(0, VOTE_NEEDS_MORE_PROOF);
        await th.connect(donor3).crowdVote(0, VOTE_APPROVE);
        // State resets to ProofPending, proofRound increments
      }

      // Now proofRound = 2, which is the last allowed round (proofRound+1 = 3 = MAX_PROOF_ROUNDS)
      await th.connect(vendor).submitProof(0, "QmRound2CID");
      await th.connect(donor1).crowdVote(0, VOTE_NEEDS_MORE_PROOF);
      await th.connect(donor2).crowdVote(0, VOTE_NEEDS_MORE_PROOF);
      await th.connect(donor3).crowdVote(0, VOTE_APPROVE);

      // Should now be Failed since max rounds exhausted
      expect((await th.getMilestone(0)).state).to.equal(STATE_FAILED);
    });
  });

  // ============================================================
  // TEST GROUP 8: claimRefund()
  // ============================================================
  describe("claimRefund()", function () {
    it("Should allow full refund when deadline passes without reaching goal", async function () {
      const goal = ethers.parseUnits("500", 6);
      const donation = ethers.parseUnits("100", 6);

      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Refund test", 30
      );
      await mockUSDC.connect(donor1).approve(await traceableHands.getAddress(), donation);
      await traceableHands.connect(donor1).donate(0, donation);

      // Fast-forward past deadline
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");

      const balanceBefore = await mockUSDC.balanceOf(donor1.address);
      await traceableHands.connect(donor1).claimRefund(0);
      const balanceAfter = await mockUSDC.balanceOf(donor1.address);

      // Full donation returned (50% was never sent — goal not reached)
      expect(balanceAfter - balanceBefore).to.equal(donation);
    });

    it("Should refund only 50% of donation when 50% was already sent to vendor", async function () {
      const goal = ethers.parseUnits("300", 6);
      const each = ethers.parseUnits("100", 6);

      await traceableHands.connect(charity).createMilestone(
        goal, vendor.address, "Half-refund test", 30
      );

      // Three donors reach the goal → 50% sent to vendor
      for (const donor of [donor1, donor2, donor3]) {
        await mockUSDC.connect(donor).approve(await traceableHands.getAddress(), each);
        await traceableHands.connect(donor).donate(0, each);
      }

      // Vendor submits proof, crowd votes to reject
      await traceableHands.connect(vendor).submitProof(0, "QmRefundCID");
      await traceableHands.connect(donor1).crowdVote(0, VOTE_REJECT);
      await traceableHands.connect(donor2).crowdVote(0, VOTE_REJECT);
      await traceableHands.connect(donor3).crowdVote(0, VOTE_APPROVE);

      // Milestone failed — donor1 can claim a partial refund
      const balanceBefore = await mockUSDC.balanceOf(donor1.address);
      await traceableHands.connect(donor1).claimRefund(0);
      const balanceAfter = await mockUSDC.balanceOf(donor1.address);

      // Should get back 50% of their 100 USDC = 50 USDC
      expect(balanceAfter - balanceBefore).to.equal(each / 2n);
    });
  });
});
