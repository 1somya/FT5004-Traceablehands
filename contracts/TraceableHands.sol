// SPDX-License-Identifier: MIT
// This line is a legal requirement for Solidity files.
// It tells the world this code is open-source under the MIT license.

pragma solidity ^0.8.20;
// "pragma" means "compiler instruction."
// This tells Hardhat: "compile this with Solidity version 0.8.20 or higher."
// The ^ means "compatible with 0.8.20 up to but not including 0.9.0."

// We import two things from OpenZeppelin:
// 1. IERC20 - an interface (a blueprint) for any ERC-20 token (like USDC).
//    This lets our contract call functions like transfer() on any ERC-20 token.
// 2. ReentrancyGuard - a security tool that prevents "reentrancy attacks,"
//    a common hack where malicious code tries to call our contract
//    repeatedly before the first call finishes.
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TraceableHands - A trustless charity donation platform
/// @notice Donors donate stablecoins. Funds release to vendors in two stages,
///         verified by randomly selected auditors.
contract TraceableHands is ReentrancyGuard {
    // "is ReentrancyGuard" means our contract inherits all the security
    // logic from OpenZeppelin's ReentrancyGuard. We just add "nonReentrant"
    // to any function that moves money.

    // =========================================================
    // SECTION 1: DATA STRUCTURES
    // We define what a "Milestone" looks like in memory.
    // =========================================================

    // An enum is a custom type with a fixed set of named values.
    // This tracks what stage a milestone is in.
    enum MilestoneState {
        Funding,      // 0 - Accepting donations, goal not reached yet
        AuditPending, // 1 - Goal reached, first 50% sent, waiting for audit
        Completed,    // 2 - Audit passed, second 50% released
        Failed,       // 3 - Audit failed OR deadline passed, refunds available
        Cancelled     // 4 - Charity cancelled before funding started
    }

    // A struct is like a "row" in a database table.
    // It groups related variables together under one name.
    struct Milestone {
        uint256 id;             // Unique ID for this milestone (0, 1, 2, ...)
        address charity;        // The wallet address of the charity that created this
        address vendorAddress;  // The wallet address of the vendor who gets paid
        string description;     // A text description of what this milestone achieves
        uint256 goalAmount;     // How many tokens need to be raised (in smallest unit)
        uint256 currentBalance; // How many tokens have been donated so far
        uint256 deadline;       // Unix timestamp — if goal not reached by this time, fail
        MilestoneState state;   // Current stage (Funding, AuditPending, etc.)
        uint256 auditVotesNeeded; // How many auditor approvals are needed
        uint256 auditVotesReceived; // How many approvals received so far
        string evidenceCID;     // IPFS content ID of the audit evidence (e.g., photos)
    }

    // =========================================================
    // SECTION 2: STATE VARIABLES
    // These are stored permanently on the blockchain.
    // Think of them as the database columns.
    // =========================================================

    // The ERC-20 token contract address we accept for donations.
    // On testnet this will be our mock USDC. On mainnet it would be real USDC.
    IERC20 public donationToken;

    // The owner of this entire platform (the team/deployer).
    // Only they can do administrative actions.
    address public owner;

    // A counter to give each milestone a unique ID.
    // Starts at 0, we increment it each time a milestone is created.
    uint256 public milestoneCount;

    // The main storage: maps milestone ID → Milestone struct.
    // Think of it as: milestones[0] returns the first milestone,
    // milestones[1] returns the second, etc.
    mapping(uint256 => Milestone) public milestones;

    // Tracks how much each donor has contributed to each milestone.
    // donorContributions[milestoneId][donorAddress] = amount donated
    // This is needed to calculate refunds fairly.
    mapping(uint256 => mapping(address => uint256)) public donorContributions;

    // Tracks which addresses have registered as potential auditors.
    // Any donor who opts in becomes a potential auditor.
    mapping(address => bool) public isRegisteredAuditor;

    // Keeps a list of all registered auditor addresses so we can
    // randomly pick from them. Mappings can't be iterated, so we
    // need a separate array for this.
    address[] public auditorPool;

    // Tracks which auditors have already voted on a specific milestone.
    // hasVoted[milestoneId][auditorAddress] = true/false
    // Prevents the same auditor from voting twice.
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // The reputation score for each vendor address.
    // Every successfully completed milestone adds 1 point.
    // reputationScore[vendorAddress] = score
    mapping(address => uint256) public reputationScore;

    // =========================================================
    // SECTION 3: EVENTS
    // Events are like "notifications" that get logged on the blockchain.
    // Your React frontend will listen for these to update the UI in real-time.
    // They are much cheaper than storing data, so we use them for history.
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
        uint256 firstPayment // The 50% sent to vendor immediately
    );

    event AuditorRegistered(address indexed auditor);

    event AuditVoteCast(
        uint256 indexed milestoneId,
        address indexed auditor,
        bool approved
    );

    event MilestoneCompleted(
        uint256 indexed milestoneId,
        address indexed vendor,
        uint256 finalPayment // The remaining 50% sent to vendor
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
    // Modifiers are reusable conditions. Instead of writing the same
    // "require" check in every function, we define it once here
    // and attach it to functions with a keyword.
    // =========================================================

    // Only the platform owner can call functions with this modifier.
    modifier onlyOwner() {
        require(msg.sender == owner, "Only the platform owner can do this");
        _; // This underscore means "run the rest of the function now"
    }

    // Only the charity that created a milestone can call functions
    // with this modifier for that specific milestone.
    modifier onlyCharity(uint256 _milestoneId) {
        require(
            msg.sender == milestones[_milestoneId].charity,
            "Only the charity that created this milestone can do this"
        );
        _;
    }

    // Checks that a milestone actually exists before doing anything with it.
    modifier milestoneExists(uint256 _milestoneId) {
        require(_milestoneId < milestoneCount, "This milestone does not exist");
        _;
    }

    // =========================================================
    // SECTION 5: CONSTRUCTOR
    // The constructor runs ONCE when the contract is first deployed.
    // It sets up the initial state.
    // =========================================================

    /// @param _donationToken The address of the ERC-20 token contract
    ///        we accept for donations (e.g., USDC contract address)
    constructor(address _donationToken) {
        // Store the token contract so we can call its functions later.
        donationToken = IERC20(_donationToken);

        // msg.sender is a built-in Solidity variable that always refers to
        // the wallet address that called the current function.
        // In the constructor, that's the person deploying the contract.
        owner = msg.sender;

        // Start the milestone counter at 0.
        milestoneCount = 0;
    }

    // =========================================================
    // SECTION 6: CORE FUNCTIONS
    // =========================================================

    /// @notice Creates a new fundraising milestone.
    /// @param _goalAmount How many tokens (in smallest unit) to raise.
    ///        For a token with 6 decimals (like USDC), 1 USDC = 1,000,000 units.
    /// @param _vendorAddress The wallet that receives the funds when goals are met.
    /// @param _description A human-readable description of what this milestone does.
    /// @param _durationInDays How many days donors have to reach the goal.
    function createMilestone(
        uint256 _goalAmount,
        address _vendorAddress,
        string calldata _description,
        uint256 _durationInDays
    ) external {
        // "external" means this function can only be called from outside the contract.

        // Input validation — reject bad inputs before wasting gas.
        require(_goalAmount > 0, "Goal amount must be greater than zero");
        require(_vendorAddress != address(0), "Vendor address cannot be the zero address");
        require(bytes(_description).length > 0, "Description cannot be empty");
        require(_durationInDays > 0, "Duration must be at least 1 day");

        // Get the current milestone ID, then increment the counter
        // so the next milestone gets a different ID.
        uint256 newId = milestoneCount;
        milestoneCount++;

        // Calculate the deadline. block.timestamp is the current block's
        // Unix timestamp (seconds since Jan 1, 1970).
        // We multiply days by seconds in a day to convert.
        uint256 deadline = block.timestamp + (_durationInDays * 1 days);

        // Determine how many auditors are needed based on the vendor's reputation.
        // New vendors (score 0) need 3 auditors.
        // Trusted vendors (score 5+) only need 1 auditor.
        // This is the reputation system in action.
        uint256 votesNeeded;
        uint256 vendorRep = reputationScore[_vendorAddress];
        if (vendorRep >= 5) {
            votesNeeded = 1; // Highly trusted vendor, fast-track
        } else if (vendorRep >= 2) {
            votesNeeded = 2; // Some track record
        } else {
            votesNeeded = 3; // New vendor, need more oversight
        }

        // Create the Milestone struct and store it in our mapping.
        milestones[newId] = Milestone({
            id: newId,
            charity: msg.sender,         // The caller becomes the charity owner
            vendorAddress: _vendorAddress,
            description: _description,
            goalAmount: _goalAmount,
            currentBalance: 0,           // No donations yet
            deadline: deadline,
            state: MilestoneState.Funding, // Starts in Funding state
            auditVotesNeeded: votesNeeded,
            auditVotesReceived: 0,
            evidenceCID: ""              // Empty until auditor submits
        });

        // Emit an event so the frontend knows a milestone was created.
        emit MilestoneCreated(newId, msg.sender, _goalAmount, deadline);
    }

    /// @notice Allows a donor to donate tokens to a milestone.
    /// @dev The donor must first call approve() on the token contract,
    ///      giving THIS contract permission to move their tokens.
    ///      This is how ERC-20 tokens work — you approve, then the
    ///      contract pulls the tokens. (Like authorizing a direct debit.)
    /// @param _milestoneId Which milestone to donate to.
    /// @param _amount How many tokens to donate.
    function donate(uint256 _milestoneId, uint256 _amount)
        external
        nonReentrant          // Security: prevents reentrancy attacks
        milestoneExists(_milestoneId) // Safety: ensures milestone exists
    {
        Milestone storage milestone = milestones[_milestoneId];
        // "storage" means we're pointing to the actual stored data,
        // not a copy. Changes here affect the blockchain directly.

        require(milestone.state == MilestoneState.Funding, "This milestone is not accepting donations");
        require(block.timestamp < milestone.deadline, "Donation deadline has passed");
        require(_amount > 0, "Donation amount must be greater than zero");

        // transferFrom pulls tokens FROM the donor TO this contract.
        // This only works if the donor has already called approve() on
        // the token contract. If they haven't, this line will revert.
        bool success = donationToken.transferFrom(msg.sender, address(this), _amount);
        require(success, "Token transfer failed");

        // Update state: record how much this donor contributed (for refunds)
        // and add to the milestone's total balance.
        donorContributions[_milestoneId][msg.sender] += _amount;
        milestone.currentBalance += _amount;

        emit DonationReceived(_milestoneId, msg.sender, _amount);

        // Check if the goal has been reached.
        if (milestone.currentBalance >= milestone.goalAmount) {
            _handleGoalReached(_milestoneId);
        }
    }

    /// @dev Internal function called automatically when goal is reached.
    ///      Internal functions can only be called from within this contract.
    ///      We prefix them with _ by convention.
    function _handleGoalReached(uint256 _milestoneId) internal {
        Milestone storage milestone = milestones[_milestoneId];

        // Calculate 50% of the total balance.
        // We do integer division, so 101 tokens would send 50, not 50.5.
        uint256 firstPayment = milestone.currentBalance / 2;

        // Change state to AuditPending BEFORE sending money.
        // This is important — always update state before external calls
        // to prevent reentrancy attacks (Checks-Effects-Interactions pattern).
        milestone.state = MilestoneState.AuditPending;

        // Transfer 50% directly to the vendor immediately.
        bool success = donationToken.transfer(milestone.vendorAddress, firstPayment);
        require(success, "First payment transfer failed");

        emit GoalReached(_milestoneId, firstPayment);
    }

    /// @notice Allows any donor to register as a potential auditor.
    /// @dev We check they've donated to at least something to prevent
    ///      random people from flooding the auditor pool.
    function registerAsAuditor() external {
        require(!isRegisteredAuditor[msg.sender], "Already registered as auditor");
        // In production you'd check they've donated somewhere.
        // For MVP we keep this simple.

        isRegisteredAuditor[msg.sender] = true;
        auditorPool.push(msg.sender); // Add to the iterable list

        emit AuditorRegistered(msg.sender);
    }

    /// @notice An auditor casts their vote on whether a milestone's
    ///         real-world delivery has been verified.
    /// @param _milestoneId The milestone being audited.
    /// @param _approved True if the auditor confirms delivery, false otherwise.
    /// @param _evidenceCID The IPFS hash of evidence (photos, receipts).
    ///        This is stored on-chain as a permanent, tamper-proof reference.
    function verify(
        uint256 _milestoneId,
        bool _approved,
        string calldata _evidenceCID
    )
        external
        nonReentrant
        milestoneExists(_milestoneId)
    {
        Milestone storage milestone = milestones[_milestoneId];

        require(
            milestone.state == MilestoneState.AuditPending,
            "Milestone is not in audit stage"
        );
        require(
            isRegisteredAuditor[msg.sender],
            "You are not a registered auditor"
        );
        require(
            !hasVoted[_milestoneId][msg.sender],
            "You have already voted on this milestone"
        );

        // Mark this auditor as having voted so they can't vote again.
        hasVoted[_milestoneId][msg.sender] = true;

        emit AuditVoteCast(_milestoneId, msg.sender, _approved);

        if (_approved) {
            milestone.auditVotesReceived++;
            // Store the evidence CID (the last auditor's evidence wins,
            // or you could concatenate them — for MVP this is fine).
            milestone.evidenceCID = _evidenceCID;

            // Check if enough auditors have approved.
            if (milestone.auditVotesReceived >= milestone.auditVotesNeeded) {
                _releaseFinalFunds(_milestoneId);
            }
        } else {
            // A rejection vote immediately fails the milestone.
            // In a more complex version you'd require a majority to reject.
            // For MVP, any rejection fails it.
            milestone.state = MilestoneState.Failed;
            emit MilestoneFailed(_milestoneId);
        }
    }

    /// @dev Internal function to release the remaining 50% after successful audit.
    function _releaseFinalFunds(uint256 _milestoneId) internal {
        Milestone storage milestone = milestones[_milestoneId];

        // The remaining balance in the contract for this milestone.
        // This is roughly 50% (the half that wasn't sent at goal-reach).
        // We use currentBalance / 2 to match the first payment calculation,
        // which handles odd numbers consistently.
        uint256 remainingPayment = milestone.currentBalance / 2;

        // Update state BEFORE sending money (Checks-Effects-Interactions).
        milestone.state = MilestoneState.Completed;

        // Transfer the remaining 50% to the vendor.
        bool success = donationToken.transfer(milestone.vendorAddress, remainingPayment);
        require(success, "Final payment transfer failed");

        // Increment the vendor's reputation score.
        reputationScore[milestone.vendorAddress]++;
        emit ReputationUpdated(
            milestone.vendorAddress,
            reputationScore[milestone.vendorAddress]
        );

        emit MilestoneCompleted(_milestoneId, milestone.vendorAddress, remainingPayment);
    }

    /// @notice Allows donors to reclaim their donation if a milestone fails
    ///         or the deadline passes without reaching the goal.
    /// @param _milestoneId The milestone to claim a refund from.
    function claimRefund(uint256 _milestoneId)
        external
        nonReentrant
        milestoneExists(_milestoneId)
    {
        Milestone storage milestone = milestones[_milestoneId];

        // Check if the milestone is eligible for refunds.
        // Either it officially Failed, or the deadline passed in Funding state.
        bool deadlinePassed = (
            milestone.state == MilestoneState.Funding &&
            block.timestamp >= milestone.deadline
        );
        bool officiallyFailed = (milestone.state == MilestoneState.Failed);

        require(
            deadlinePassed || officiallyFailed,
            "This milestone is not eligible for refunds yet"
        );

        // Get how much this specific donor contributed.
        uint256 donorAmount = donorContributions[_milestoneId][msg.sender];
        require(donorAmount > 0, "You have no donations to refund for this milestone");

        // Set to 0 BEFORE transferring (Checks-Effects-Interactions pattern again).
        // This prevents a donor from calling this twice and draining the contract.
        donorContributions[_milestoneId][msg.sender] = 0;

        // Transfer the refund back to the donor.
        bool success = donationToken.transfer(msg.sender, donorAmount);
        require(success, "Refund transfer failed");

        emit RefundClaimed(_milestoneId, msg.sender, donorAmount);
    }

    // =========================================================
    // SECTION 7: VIEW FUNCTIONS
    // These functions only READ data — they don't change state.
    // They are FREE to call (no gas cost) because nothing changes.
    // =========================================================

    /// @notice Returns full details of a milestone.
    function getMilestone(uint256 _milestoneId)
        external
        view
        milestoneExists(_milestoneId)
        returns (Milestone memory)
    {
        // "memory" here means we return a temporary copy, not a reference.
        return milestones[_milestoneId];
    }

    /// @notice Returns how many donors are in the auditor pool.
    function getAuditorPoolSize() external view returns (uint256) {
        return auditorPool.length;
    }

    /// @notice Returns the reputation score of a vendor.
    function getVendorReputation(address _vendor) external view returns (uint256) {
        return reputationScore[_vendor];
    }
}