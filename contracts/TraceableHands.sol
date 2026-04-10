// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TraceableHands - Trustless charity platform with crowd auditing
/// @notice Donors fund milestones in escrow. Once the goal is reached, 50% is released
///         to the vendor immediately. The vendor uploads proof of delivery to IPFS.
///         Donors then vote to approve, request more proof, or reject. If a majority
///         approves, the remaining 50% is released. This is crowd auditing — no
///         trusted third-party auditor is needed.
contract TraceableHands is ReentrancyGuard {

    // =========================================================
    // SECTION 1: DATA STRUCTURES
    // =========================================================

    /// @dev Tracks what stage a milestone is in.
    enum MilestoneState {
        Funding,       // 0 — Accepting donations, goal not reached yet
        ProofPending,  // 1 — Goal reached, 50% sent, waiting for vendor/charity to upload proof
        VotingOpen,    // 2 — Proof submitted, donors are now voting
        Completed,     // 3 — Majority approved, remaining 50% released to vendor
        Failed,        // 4 — Majority rejected OR max proof rounds exceeded
        Cancelled      // 5 — Cancelled before funding completed
    }

    /// @dev The three voting options donors can choose from.
    enum VoteType {
        Approve,        // 0 — Proof is valid, release remaining funds
        NeedsMoreProof, // 1 — Proof is insufficient, vendor should resubmit
        Reject          // 2 — Delivery did not happen, keep remaining funds locked for refund
    }

    /// @dev Max number of times a vendor can re-submit proof before the milestone fails.
    uint8 public constant MAX_PROOF_ROUNDS = 3;

    /// @dev Minimum number of donors who must vote before a decision is reached.
    ///      If fewer than MIN_VOTERS donors exist, all donors must vote.
    uint256 public constant MIN_VOTERS = 3;

    struct Milestone {
        uint256 id;
        address charity;        // Address that created this milestone
        address vendorAddress;  // Address that receives the funds
        string description;
        uint256 goalAmount;
        uint256 currentBalance; // Total donated so far
        uint256 deadline;       // Unix timestamp for fundraising deadline
        MilestoneState state;

        bool firstPaymentSent;  // True once the first 50% has been sent to vendor

        string proofCID;        // IPFS CID of the vendor's proof of delivery
        uint8 proofRound;       // How many proof submission rounds have occurred (0-indexed)

        uint256 approveVotes;       // Number of Approve votes this round
        uint256 needsMoreProofVotes; // Number of NeedsMoreProof votes this round
        uint256 rejectVotes;        // Number of Reject votes this round
        uint256 totalVoters;        // Unique voters this round

        uint256 donorCount;     // How many unique addresses have donated
    }

    // =========================================================
    // SECTION 2: STATE VARIABLES
    // =========================================================

    IERC20 public donationToken;
    address public owner;
    uint256 public milestoneCount;

    mapping(uint256 => Milestone) public milestones;

    // How much each donor contributed to each milestone.
    // donorContributions[milestoneId][donorAddress] = amount
    mapping(uint256 => mapping(address => uint256)) public donorContributions;

    // Prevents double-voting. Keyed by milestone, proof round, and voter address.
    // This resets naturally when proofRound increments — no need to clear old entries.
    // hasVoted[milestoneId][proofRound][voterAddress] = true/false
    mapping(uint256 => mapping(uint8 => mapping(address => bool))) public hasVoted;

    // Vendor reputation: incremented by 1 for each successfully completed milestone.
    mapping(address => uint256) public reputationScore;

    // =========================================================
    // SECTION 3: EVENTS
    // =========================================================

    event MilestoneCreated(
        uint256 indexed milestoneId,
        address indexed charity,
        uint256 goalAmount,
        uint256 deadline
    );

    event DonationReceived(
        uint256 indexed milestoneId,
        address indexed donor,
        uint256 amount
    );

    event GoalReached(
        uint256 indexed milestoneId,
        uint256 firstPayment
    );

    event ProofSubmitted(
        uint256 indexed milestoneId,
        address indexed submitter,
        string proofCID,
        uint8 round
    );

    event VoteCast(
        uint256 indexed milestoneId,
        address indexed voter,
        VoteType voteType
    );

    /// @dev Emitted when majority votes NeedsMoreProof and voting resets.
    event NeedsMoreProofTriggered(
        uint256 indexed milestoneId,
        uint8 newRound
    );

    event MilestoneCompleted(
        uint256 indexed milestoneId,
        address indexed vendor,
        uint256 finalPayment
    );

    event MilestoneFailed(uint256 indexed milestoneId);

    event RefundClaimed(
        uint256 indexed milestoneId,
        address indexed donor,
        uint256 amount
    );

    event ReputationUpdated(address indexed vendor, uint256 newScore);

    // =========================================================
    // SECTION 4: MODIFIERS
    // =========================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "Only the platform owner can do this");
        _;
    }

    modifier milestoneExists(uint256 _milestoneId) {
        require(_milestoneId < milestoneCount, "This milestone does not exist");
        _;
    }

    // =========================================================
    // SECTION 5: CONSTRUCTOR
    // =========================================================

    constructor(address _donationToken) {
        donationToken = IERC20(_donationToken);
        owner = msg.sender;
        milestoneCount = 0;
    }

    // =========================================================
    // SECTION 6: CORE FUNCTIONS
    // =========================================================

    /// @notice Anyone can create a fundraising milestone.
    function createMilestone(
        uint256 _goalAmount,
        address _vendorAddress,
        string calldata _description,
        uint256 _durationInDays
    ) external {
        require(_goalAmount > 0, "Goal amount must be greater than zero");
        require(_vendorAddress != address(0), "Vendor address cannot be the zero address");
        require(bytes(_description).length > 0, "Description cannot be empty");
        require(_durationInDays > 0, "Duration must be at least 1 day");

        uint256 newId = milestoneCount++;
        uint256 deadline = block.timestamp + (_durationInDays * 1 days);

        milestones[newId] = Milestone({
            id: newId,
            charity: msg.sender,
            vendorAddress: _vendorAddress,
            description: _description,
            goalAmount: _goalAmount,
            currentBalance: 0,
            deadline: deadline,
            state: MilestoneState.Funding,
            firstPaymentSent: false,
            proofCID: "",
            proofRound: 0,
            approveVotes: 0,
            needsMoreProofVotes: 0,
            rejectVotes: 0,
            totalVoters: 0,
            donorCount: 0
        });

        emit MilestoneCreated(newId, msg.sender, _goalAmount, deadline);
    }

    /// @notice Donate tokens to a milestone.
    ///         The donor must first call approve() on the token contract.
    function donate(uint256 _milestoneId, uint256 _amount)
        external
        nonReentrant
        milestoneExists(_milestoneId)
    {
        Milestone storage milestone = milestones[_milestoneId];

        require(milestone.state == MilestoneState.Funding, "This milestone is not accepting donations");
        require(block.timestamp < milestone.deadline, "Donation deadline has passed");
        require(_amount > 0, "Donation amount must be greater than zero");

        bool success = donationToken.transferFrom(msg.sender, address(this), _amount);
        require(success, "Token transfer failed");

        // Track unique donor count
        if (donorContributions[_milestoneId][msg.sender] == 0) {
            milestone.donorCount++;
        }

        donorContributions[_milestoneId][msg.sender] += _amount;
        milestone.currentBalance += _amount;

        emit DonationReceived(_milestoneId, msg.sender, _amount);

        if (milestone.currentBalance >= milestone.goalAmount) {
            _handleGoalReached(_milestoneId);
        }
    }

    /// @dev Called internally when a donation pushes the balance to the goal.
    ///      Sends 50% to vendor immediately and waits for proof submission.
    function _handleGoalReached(uint256 _milestoneId) internal {
        Milestone storage milestone = milestones[_milestoneId];

        uint256 firstPayment = milestone.currentBalance / 2;

        // Update state BEFORE external call (Checks-Effects-Interactions)
        milestone.state = MilestoneState.ProofPending;
        milestone.firstPaymentSent = true;

        bool success = donationToken.transfer(milestone.vendorAddress, firstPayment);
        require(success, "First payment transfer failed");

        emit GoalReached(_milestoneId, firstPayment);
    }

    /// @notice The vendor or charity uploads proof of delivery (an IPFS CID).
    ///         This opens the voting period for donors.
    /// @param _milestoneId The milestone to submit proof for.
    /// @param _proofCID The IPFS content ID (e.g., "QmXxx...") of the evidence file.
    function submitProof(uint256 _milestoneId, string calldata _proofCID)
        external
        milestoneExists(_milestoneId)
    {
        Milestone storage milestone = milestones[_milestoneId];

        require(
            msg.sender == milestone.charity || msg.sender == milestone.vendorAddress,
            "Only the charity or vendor can submit proof"
        );
        require(
            milestone.state == MilestoneState.ProofPending,
            "Milestone is not awaiting proof"
        );
        require(bytes(_proofCID).length > 0, "Proof CID cannot be empty");

        milestone.proofCID = _proofCID;
        milestone.state = MilestoneState.VotingOpen;

        emit ProofSubmitted(_milestoneId, msg.sender, _proofCID, milestone.proofRound);
    }

    /// @notice Any donor who contributed to this milestone can vote on the submitted proof.
    ///         Each address can only vote once per proof round.
    ///         A majority (>50%) of votes cast decides the outcome.
    ///         Decisions are checked after MIN_VOTERS have voted.
    /// @param _milestoneId The milestone to vote on.
    /// @param _voteType 0=Approve, 1=NeedsMoreProof, 2=Reject
    function crowdVote(uint256 _milestoneId, VoteType _voteType)
        external
        nonReentrant
        milestoneExists(_milestoneId)
    {
        Milestone storage milestone = milestones[_milestoneId];

        require(
            milestone.state == MilestoneState.VotingOpen,
            "Voting is not open for this milestone"
        );
        require(
            donorContributions[_milestoneId][msg.sender] > 0,
            "Only donors to this milestone can vote"
        );
        require(
            !hasVoted[_milestoneId][milestone.proofRound][msg.sender],
            "You have already voted in this round"
        );

        hasVoted[_milestoneId][milestone.proofRound][msg.sender] = true;
        milestone.totalVoters++;

        if (_voteType == VoteType.Approve) {
            milestone.approveVotes++;
        } else if (_voteType == VoteType.NeedsMoreProof) {
            milestone.needsMoreProofVotes++;
        } else {
            milestone.rejectVotes++;
        }

        emit VoteCast(_milestoneId, msg.sender, _voteType);
        _checkVoteOutcome(_milestoneId);
    }

    /// @dev Checks if a vote majority has been reached after each new vote.
    ///      Uses "strictly more than half" threshold (>50%).
    ///      Only evaluates after MIN_VOTERS have voted (or all donors if fewer exist).
    function _checkVoteOutcome(uint256 _milestoneId) internal {
        Milestone storage m = milestones[_milestoneId];
        uint256 totalVotes = m.approveVotes + m.needsMoreProofVotes + m.rejectVotes;

        // Wait until we have enough voters for a meaningful decision.
        // If there are fewer total donors than MIN_VOTERS, require all of them to vote.
        uint256 requiredVoters = m.donorCount < MIN_VOTERS ? m.donorCount : MIN_VOTERS;
        if (totalVotes < requiredVoters) return;

        // Check for strict majority (more than half the votes cast).
        // Using "* 2 >" instead of "> / 2" avoids integer rounding errors.
        if (m.approveVotes * 2 > totalVotes) {
            // Majority approves — release remaining 50% to vendor
            _releaseFinalFunds(_milestoneId);

        } else if (m.rejectVotes * 2 > totalVotes) {
            // Majority rejects — mark failed, remaining 50% is refundable
            m.state = MilestoneState.Failed;
            emit MilestoneFailed(_milestoneId);

        } else if (m.needsMoreProofVotes * 2 > totalVotes) {
            // Majority wants more proof
            if (m.proofRound + 1 >= MAX_PROOF_ROUNDS) {
                // Max proof rounds exhausted — fail the milestone
                m.state = MilestoneState.Failed;
                emit MilestoneFailed(_milestoneId);
            } else {
                // Increment round, reset votes, let vendor re-submit
                // hasVoted entries from old round are ignored automatically
                // because hasVoted is keyed by (milestoneId, proofRound, address)
                m.proofRound++;
                m.approveVotes = 0;
                m.needsMoreProofVotes = 0;
                m.rejectVotes = 0;
                m.totalVoters = 0;
                m.proofCID = "";
                m.state = MilestoneState.ProofPending;
                emit NeedsMoreProofTriggered(_milestoneId, m.proofRound);
            }
        }
        // If no option has a majority yet, voting remains open.
    }

    /// @dev Releases the remaining 50% to the vendor and marks the milestone complete.
    function _releaseFinalFunds(uint256 _milestoneId) internal {
        Milestone storage milestone = milestones[_milestoneId];

        uint256 remainingPayment = milestone.currentBalance / 2;

        milestone.state = MilestoneState.Completed;

        bool success = donationToken.transfer(milestone.vendorAddress, remainingPayment);
        require(success, "Final payment transfer failed");

        reputationScore[milestone.vendorAddress]++;
        emit ReputationUpdated(milestone.vendorAddress, reputationScore[milestone.vendorAddress]);
        emit MilestoneCompleted(_milestoneId, milestone.vendorAddress, remainingPayment);
    }

    /// @notice Donors claim a refund if:
    ///         (a) the fundraising deadline passed without reaching the goal, or
    ///         (b) the crowd voted to reject the delivery.
    ///
    ///         IMPORTANT: If the goal was reached and 50% was already sent to the vendor,
    ///         donors can only recover their proportional share of the remaining 50%.
    function claimRefund(uint256 _milestoneId)
        external
        nonReentrant
        milestoneExists(_milestoneId)
    {
        Milestone storage milestone = milestones[_milestoneId];

        bool deadlinePassed = (
            milestone.state == MilestoneState.Funding &&
            block.timestamp >= milestone.deadline
        );
        bool officiallyFailed = (milestone.state == MilestoneState.Failed);

        require(
            deadlinePassed || officiallyFailed,
            "This milestone is not eligible for refunds yet"
        );

        uint256 donorAmount = donorContributions[_milestoneId][msg.sender];
        require(donorAmount > 0, "You have no donations to refund for this milestone");

        donorContributions[_milestoneId][msg.sender] = 0;

        // If 50% was already sent to the vendor, only refund the donor's
        // proportional share of the remaining 50% (= their donation / 2).
        uint256 refundAmount = milestone.firstPaymentSent ? donorAmount / 2 : donorAmount;

        bool success = donationToken.transfer(msg.sender, refundAmount);
        require(success, "Refund transfer failed");

        emit RefundClaimed(_milestoneId, msg.sender, refundAmount);
    }

    // =========================================================
    // SECTION 7: VIEW FUNCTIONS
    // =========================================================

    function getMilestone(uint256 _milestoneId)
        external
        view
        milestoneExists(_milestoneId)
        returns (Milestone memory)
    {
        return milestones[_milestoneId];
    }

    function getVendorReputation(address _vendor) external view returns (uint256) {
        return reputationScore[_vendor];
    }
}
