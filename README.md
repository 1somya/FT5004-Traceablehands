# TraceableHands 🤝

> **Donate. Track. Know.**  
> A trustless charity DApp that locks donations in escrow and releases funds to vendors only upon goal attainment and community audit verification.

---

## What it does

TraceableHands solves a fundamental problem in charitable giving: **donors have no way to verify their money created real-world impact.**

The platform works in three stages:

1. **Donate** — Donors contribute USDC stablecoins to a milestone. Funds are locked in the smart contract.
2. **Goal reached** — When the funding goal is met, **50% is automatically released** to the vendor (e.g. a food supplier). No human approval needed — the contract does it trustlessly.
3. **Audit & complete** — Randomly selected auditors verify real-world delivery. Upon sufficient approvals, the **remaining 50% is released**. Evidence hashes are stored permanently on-chain via IPFS.

Vendors build an **on-chain reputation score** with every completed milestone, creating a transparent trust layer that grows over time.

---

## Why Blockchain?

A centralized database can show transparency, but someone still controls it — replacing "trust the charity" with "trust the platform." Blockchain removes that dependency:

- Fund movements are **immutable and publicly verifiable** by anyone
- Smart contract logic is **deterministic** — no human can intercept or redirect funds
- Vendor reputation scores **cannot be edited** by any administrator
- Anyone can audit the full transaction history on Etherscan

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contracts | Solidity ^0.8.20 |
| Development framework | Hardhat |
| Contract libraries | OpenZeppelin (ERC-20, ReentrancyGuard) |
| Frontend | React |
| Blockchain connection | ethers.js v6 |
| Wallet | MetaMask |
| Testnet | Sepolia (Ethereum) |
| File storage | IPFS (evidence CIDs stored on-chain) |
| Testing | Hardhat + Mocha + Chai |

---

## Deployed Contracts (Sepolia Testnet)

| Contract | Address |
|---|---|
| TraceableHands | See `deployed-addresses.json` |
| MockUSDC | See `deployed-addresses.json` |

View on [Sepolia Etherscan](https://sepolia.etherscan.io)

---

## Installation Guide

### Prerequisites

- [Node.js](https://nodejs.org) v18 or higher
- [MetaMask](https://metamask.io) browser extension
- An [Alchemy](https://alchemy.com) account (free) for Sepolia RPC

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/traceablehands.git
cd traceablehands
```

### 2. Install dependencies

```bash
# Install Hardhat and contract dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### 3. Set up environment variables

Create a `.env` file in the project root:

```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
PRIVATE_KEY=your_metamask_private_key
```

> ⚠️ Never commit your `.env` file. It is already in `.gitignore`.

### 4. Compile contracts

```bash
npx hardhat compile
```

### 5. Run tests

```bash
npx hardhat test
```

All tests should pass with green checkmarks.

### 6. Deploy to Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

This saves contract addresses to `deployed-addresses.json`.

### 7. Copy contract files to frontend

```bash
cp deployed-addresses.json frontend/src/contracts/
cp artifacts/contracts/TraceableHands.sol/TraceableHands.json frontend/src/contracts/
cp artifacts/contracts/MockUSDC.sol/MockUSDC.json frontend/src/contracts/
```

### 8. Start the frontend

```bash
cd frontend
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## How to Use

### As a Donor

1. Click **Connect Wallet** — MetaMask will auto-switch to Sepolia
2. Click **Get 1000 Test USDC** to get test tokens
3. Browse milestones and enter a donation amount
4. Confirm two MetaMask transactions (approve + donate)
5. Watch the milestone progress bar update in real time

### As a Charity

1. Connect your wallet
2. Fill in the **Create a Milestone** form with goal, vendor address, description, and duration
3. Confirm the MetaMask transaction
4. Share your milestone with donors

### As an Auditor

1. Connect your wallet
2. Click **Register as Auditor**
3. When a milestone reaches **Audit Pending** state, upload evidence to IPFS and paste the CID
4. Click **Approve Delivery** or **Reject Delivery**
5. Once enough auditors approve, the final 50% releases automatically

### Claiming a Refund

If a milestone fails or the deadline passes without reaching the goal, donors can click **Claim Refund** to recover their contribution.

---

## Smart Contract Architecture

```
TraceableHands.sol
├── createMilestone(goal, vendorAddress, description, durationDays)
│   └── Stores milestone on-chain, sets auditor threshold based on vendor reputation
├── donate(milestoneId, amount)
│   └── Accepts USDC, triggers 50% release when goal is reached
├── registerAsAuditor()
│   └── Adds caller to auditor pool
├── verify(milestoneId, approved, evidenceCID)
│   └── Records vote; releases final 50% when threshold met
├── claimRefund(milestoneId)
│   └── Returns donations if goal not met or audit failed
└── reputationScore[vendorAddress]
    └── Increments on each completed milestone
```

**State machine:**
```
Funding → AuditPending → Completed
                       → Failed → (refunds available)
Funding (deadline passed) → (refunds available)
```

---

## Features

- [x] USDC stablecoin donations (no ETH price volatility)
- [x] Automatic 50/50 escrow split on goal attainment
- [x] On-chain auditor registration and voting
- [x] IPFS evidence CID stored permanently on-chain
- [x] Vendor reputation system (affects future audit thresholds)
- [x] Donor refund mechanism for failed/expired milestones
- [x] Full transaction history on Sepolia Etherscan
- [x] MetaMask auto-network switching to Sepolia
- [ ] Randomized auditor selection from donor pool (stretch goal)
- [ ] Multi-milestone charity profiles (stretch goal)

---

## Team

| Name | Matric Number | Role |
|---|---|---|
| Agrawal Somya | A0326590B | Smart contracts, deployment |
| Yang Wenshuo | A0332464H | Frontend, ethers.js integration |
| Phua Qiuxuan | A0328352E | Testing, documentation |

**Course:** FT5004 Programming for Blockchain Applications  
**Group:** 3 (Team 8888)  
**Professor:** Prof Aidan Kwon

---

## License

MIT
