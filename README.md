# TraceableHands 🤝

> **Donate. Track. Know.**  
> A trustless charity DApp that locks donations in escrow and releases funds to vendors only upon crowd-verified proof of delivery.

---

## What it does

TraceableHands solves a fundamental problem in charitable giving: **donors have no way to verify their money created real-world impact.**

The platform works in five stages:

1. **Donate** — Donors contribute USDC stablecoins to a milestone. Funds are locked in the smart contract (escrow).
2. **Goal reached** — When the funding goal is met, **50% is automatically released** to the vendor. No human approval — the contract does it trustlessly.
3. **Vendor submits proof** — The vendor (or charity) uploads delivery evidence (photos, receipts) to IPFS and records the content hash on-chain.
4. **Crowd audit** — Every donor who contributed to the milestone can cast one of three votes: **Approve**, **Needs More Proof**, or **Reject**.
5. **Resolution** — Once a majority (>50%) of active voters agree, the outcome executes automatically:
   - Majority **Approve** → remaining 50% released to vendor, reputation score incremented
   - Majority **Reject** → milestone fails, donors reclaim their share of remaining escrow
   - Majority **Needs More Proof** → vendor can re-submit (up to 3 rounds total); if rounds exhausted, milestone fails

Vendors build an **on-chain reputation score** with every completed milestone.

---

## Why Blockchain?

A centralized database can show transparency, but someone still controls it — replacing "trust the charity" with "trust the platform." Blockchain removes that dependency:

- Fund movements are **immutable and publicly verifiable** by anyone
- Smart contract logic is **deterministic** — no human can intercept or redirect funds
- Vendor reputation scores **cannot be edited** by any administrator
- Crowd vote records are **permanent and tamper-proof**
- Anyone can audit the full transaction history on Etherscan

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contracts | Solidity ^0.8.20 |
| Development framework | Hardhat (with `viaIR: true` for optimizer) |
| Contract libraries | OpenZeppelin (ERC-20, ReentrancyGuard) |
| Frontend | React |
| Blockchain connection | ethers.js v6 |
| Wallet | MetaMask |
| Testnet | Sepolia (Ethereum) |
| File storage | IPFS (proof CIDs stored on-chain) |
| Testing | Hardhat + Mocha + Chai (22 tests) |

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
git clone https://github.com/YOUR_USERNAME/FT5004-Traceablehands.git
cd FT5004-Traceablehands
```

### 2. Install dependencies

```bash
npm install
cd frontend && npm install && cd ..
```

### 3. Set up environment variables

Create `.env` in the project root:

```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
PRIVATE_KEY=your_metamask_private_key
```

> ⚠️ Never commit `.env`. It is already in `.gitignore`.

### 4. Compile, test, deploy

```bash
npx hardhat compile
npx hardhat test          # all 22 tests should pass
npx hardhat run scripts/deploy.js --network sepolia
```

### 5. Copy ABIs to frontend and start

```bash
cp deployed-addresses.json frontend/src/contracts/
cp artifacts/contracts/TraceableHands.sol/TraceableHands.json frontend/src/contracts/
cp artifacts/contracts/MockUSDC.sol/MockUSDC.json frontend/src/contracts/
cd frontend && npm start
```

Open [http://localhost:3000](http://localhost:3000).

---

## How to Use

### As a Charity

1. Connect wallet → go to the **Create** tab
2. Fill in goal amount, vendor address, description, and deadline duration
3. Confirm the MetaMask transaction

### As a Donor

1. Click **Connect Wallet** — MetaMask auto-switches to Sepolia
2. Click **Get 1000 Test USDC** in the sidebar
3. Find a milestone in **Funding** state and enter a donation amount
4. Confirm two MetaMask transactions: approve spend + donate

### As a Vendor (submitting proof)

1. When your milestone moves to **Proof Pending** state, upload your delivery evidence (photos, receipts) to IPFS via [Pinata](https://pinata.cloud)
2. Copy the IPFS CID
3. On the milestone card, paste the CID and click **Submit Proof & Open Voting**

### As a Donor (voting)

1. When a milestone you donated to moves to **Voting Open** state, the voting panel appears on the card
2. Review the submitted IPFS proof (click the link to view)
3. Cast one vote:
   - **Approve** — proof is satisfactory, release remaining funds
   - **Needs More Proof** — evidence is insufficient, vendor should re-submit
   - **Reject** — delivery did not happen, keep remaining funds for refund
4. Once enough donors vote and a majority (>50%) agree, the outcome executes automatically

### Claiming a Refund

If a milestone fails (majority reject) or the fundraising deadline passes without reaching the goal, donors can click **Claim Refund**.

> ⚠️ If the goal was already reached (50% sent to vendor), refunds cover only your proportional share of the remaining 50%.

---

## Multi-Account Testing

### Solo (one browser)

Create multiple accounts in MetaMask (Account icon → Add a new Ethereum account). Each gets a different address. Suggested roles:

| Account | Role |
|---|---|
| Account 1 | Charity — creates the milestone |
| Account 2 | Vendor — paste address when creating; submits proof |
| Account 3 | Donor 1 — donates and votes |
| Account 4 | Donor 2 — donates and votes |

### With a friend (same WiFi)

Find your local IP: `ipconfig getifaddr en0`  
Start frontend with: `HOST=0.0.0.0 npm start`  
Friend opens `http://YOUR_LOCAL_IP:3000` on their device.

### With a friend (any network)

```bash
brew install ngrok
ngrok http 3000
```
Share the public ngrok URL. Your friend needs MetaMask + Sepolia ETH.

---

## Smart Contract Architecture

```
TraceableHands.sol
├── createMilestone(goal, vendorAddress, description, durationDays)
│   └── Creates milestone in Funding state
├── donate(milestoneId, amount)
│   └── Locks USDC in escrow; on goal reached → sends 50% to vendor, state → ProofPending
├── submitProof(milestoneId, proofCID)
│   └── Charity or vendor uploads IPFS proof; state → VotingOpen
├── crowdVote(milestoneId, voteType)
│   └── Donor casts Approve/NeedsMoreProof/Reject vote
│       ├── Majority Approve  → releases final 50%, state → Completed
│       ├── Majority Reject   → state → Failed (refunds available)
│       └── Majority NeedsMoreProof → resets votes, state → ProofPending (max 3 rounds)
└── claimRefund(milestoneId)
    └── Returns donor's share if deadline passed or milestone failed
```

**State machine:**
```
Funding ──(goal reached)──▶ ProofPending ──(proof uploaded)──▶ VotingOpen
                                                 ▲                   │
                                                 │ (needs more proof) │
                                                 └───────────────────┤
                                                                     │
                                         Completed ◀──(majority approve)
                                                                     │
                                            Failed ◀──(majority reject / max rounds)
                                              │
                                      (refunds available)
```

---

## Features

- [x] USDC stablecoin donations (no ETH price volatility)
- [x] Automatic 50/50 escrow split on goal attainment
- [x] Vendor/charity proof submission via IPFS
- [x] Crowd auditing — every donor earns one vote
- [x] Three-way vote: Approve / Needs More Proof / Reject
- [x] Up to 3 proof re-submission rounds before auto-fail
- [x] Correct partial refund when first 50% already released
- [x] IPFS proof CID stored permanently on-chain
- [x] Vendor reputation score incremented on each completion
- [x] Full transaction history on Sepolia Etherscan
- [x] MetaMask auto-network switching to Sepolia
- [x] 22 automated tests (Hardhat + Mocha + Chai)
- [ ] Weighted voting by donation amount (stretch goal)
- [ ] Voting deadline / auto-finalize (stretch goal)
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
