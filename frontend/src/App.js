import { useState } from "react";
import { ethers } from "ethers";

import TraceableHandsABI from "./contracts/TraceableHands.json";
import MockUSDCABI from "./contracts/MockUSDC.json";
import deployedAddresses from "./contracts/deployed-addresses.json";

// States match the Solidity enum: Funding(0), ProofPending(1), VotingOpen(2),
// Completed(3), Failed(4), Cancelled(5)
const STATE_NAMES  = ["Funding", "Proof Pending", "Voting Open", "Completed", "Failed", "Cancelled"];
const STATE_COLORS = { 0: "#6366f1", 1: "#f59e0b", 2: "#3b82f6", 3: "#10b981", 4: "#ef4444", 5: "#6b7280" };
const STATE_BG     = { 0: "#eef2ff", 1: "#fffbeb", 2: "#eff6ff", 3: "#ecfdf5", 4: "#fef2f2", 5: "#f9fafb" };

// VoteType matches Solidity enum
const VOTE_APPROVE          = 0;
const VOTE_NEEDS_MORE_PROOF = 1;
const VOTE_REJECT           = 2;

function progressPct(balance, goal) {
  const pct = (parseFloat(balance) / parseFloat(goal)) * 100;
  return Math.min(pct, 100);
}

function truncateAddress(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export default function App() {
  const [account,        setAccount]        = useState("");
  const [traceableHands, setTraceableHands] = useState(null);
  const [mockUSDC,       setMockUSDC]       = useState(null);
  const [milestones,     setMilestones]     = useState([]);
  const [usdcBalance,    setUsdcBalance]    = useState("0");
  const [vendorRep,      setVendorRep]      = useState("0");
  const [loading,        setLoading]        = useState("");
  const [activeTab,      setActiveTab]      = useState("milestones");
  const [form,           setForm]           = useState({ goal: "", vendor: "", description: "", duration: "30" });
  const [donateAmounts,  setDonateAmounts]  = useState({});
  // For proof submission — keyed by milestoneId
  const [proofCIDs,      setProofCIDs]      = useState({});

  // ── Connect wallet ──────────────────────────────────────────────────────────
  const connectWallet = async () => {
    if (!window.ethereum) { alert("Please install MetaMask."); return; }
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
    } catch (err) {
      if (err.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: "0xaa36a7", chainName: "Sepolia test network",
            nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://rpc.sepolia.org"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"] }],
        });
      } else { alert("Please switch MetaMask to Sepolia."); return; }
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer   = await provider.getSigner();
    const address  = await signer.getAddress();
    setAccount(address);
    const th   = new ethers.Contract(deployedAddresses.traceableHands, TraceableHandsABI.abi, signer);
    const usdc = new ethers.Contract(deployedAddresses.mockUSDC, MockUSDCABI.abi, signer);
    setTraceableHands(th);
    setMockUSDC(usdc);
    await refreshAll(th, usdc, address);
  };

  const refreshAll = async (th, usdc, address) => {
    await Promise.all([
      loadMilestones(th, address),
      loadBalance(usdc, address),
      loadReputation(th, address),
    ]);
  };

  const loadMilestones = async (th, address) => {
    const count = Number(await th.milestoneCount());
    const loaded = [];
    for (let i = 0; i < count; i++) {
      const m = await th.getMilestone(i);
      const proofRound = Number(m.proofRound);
      const state = Number(m.state);

      // Load how much this user donated to this milestone
      const myContrib = await th.donorContributions(i, address);

      // Load whether this user has voted in the current proof round (only matters for VotingOpen)
      const myVoted = state === 2
        ? await th.hasVoted(i, proofRound, address)
        : false;

      loaded.push({
        id:           Number(m.id),
        charity:      m.charity,
        vendor:       m.vendorAddress,
        description:  m.description,
        goal:         ethers.formatUnits(m.goalAmount,     6),
        balance:      ethers.formatUnits(m.currentBalance, 6),
        state,
        deadline:     new Date(Number(m.deadline) * 1000).toLocaleDateString(),
        firstPaymentSent: m.firstPaymentSent,
        proofCID:     m.proofCID,
        proofRound,
        approveVotes:       Number(m.approveVotes),
        needsMoreProofVotes: Number(m.needsMoreProofVotes),
        rejectVotes:        Number(m.rejectVotes),
        totalVoters:        Number(m.totalVoters),
        donorCount:         Number(m.donorCount),
        myContrib:    ethers.formatUnits(myContrib, 6),
        myVoted,
      });
    }
    setMilestones(loaded);
  };

  const loadBalance   = async (usdc, address) => setUsdcBalance(ethers.formatUnits(await usdc.balanceOf(address), 6));
  const loadReputation = async (th, address)   => setVendorRep((await th.getVendorReputation(address)).toString());

  const handleFaucet = async () => {
    setLoading("Minting 1000 test USDC…");
    try {
      const tx = await mockUSDC.faucet(ethers.parseUnits("1000", 6));
      await tx.wait();
      await loadBalance(mockUSDC, account);
      alert("Got 1000 test USDC!");
    } catch (err) { alert("Error: " + (err.reason || err.message)); }
    setLoading("");
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading("Creating milestone on-chain…");
    try {
      const tx = await traceableHands.createMilestone(
        ethers.parseUnits(form.goal, 6), form.vendor, form.description, parseInt(form.duration)
      );
      await tx.wait();
      setForm({ goal: "", vendor: "", description: "", duration: "30" });
      await loadMilestones(traceableHands, account);
      alert("Milestone created!");
    } catch (err) { alert("Error: " + (err.reason || err.message)); }
    setLoading("");
  };

  const handleDonate = async (milestoneId) => {
    const amount = donateAmounts[milestoneId];
    if (!amount || Number(amount) <= 0) { alert("Enter a valid amount."); return; }
    const units = ethers.parseUnits(amount, 6);
    setLoading("Step 1/2: Approving USDC spend…");
    try {
      const approveTx = await mockUSDC.approve(deployedAddresses.traceableHands, units);
      await approveTx.wait();
      setLoading("Step 2/2: Sending donation…");
      const donateTx = await traceableHands.donate(milestoneId, units);
      await donateTx.wait();
      await refreshAll(traceableHands, mockUSDC, account);
      alert("Donation successful!");
    } catch (err) { alert("Error: " + (err.reason || err.message)); }
    setLoading("");
  };

  // Called by charity or vendor to upload IPFS proof and open voting
  const handleSubmitProof = async (milestoneId) => {
    const cid = proofCIDs[milestoneId];
    if (!cid || cid.trim() === "") { alert("Please enter an IPFS CID before submitting."); return; }
    setLoading("Submitting proof on-chain…");
    try {
      const tx = await traceableHands.submitProof(milestoneId, cid.trim());
      await tx.wait();
      await loadMilestones(traceableHands, account);
      alert("Proof submitted! Donors can now vote.");
    } catch (err) { alert("Error: " + (err.reason || err.message)); }
    setLoading("");
  };

  // Called by donors to cast a crowd vote
  const handleCrowdVote = async (milestoneId, voteType) => {
    const voteLabels = ["Approve", "Needs More Proof", "Reject"];
    setLoading(`Casting vote: ${voteLabels[voteType]}…`);
    try {
      const tx = await traceableHands.crowdVote(milestoneId, voteType);
      await tx.wait();
      await loadMilestones(traceableHands, account);
      alert(`Vote cast: ${voteLabels[voteType]}`);
    } catch (err) { alert("Error: " + (err.reason || err.message)); }
    setLoading("");
  };

  const handleRefund = async (milestoneId) => {
    setLoading("Claiming refund…");
    try {
      const tx = await traceableHands.claimRefund(milestoneId);
      await tx.wait();
      await refreshAll(traceableHands, mockUSDC, account);
      alert("Refund claimed!");
    } catch (err) { alert("Error: " + (err.reason || err.message)); }
    setLoading("");
  };

  const tabs = [
    { id: "milestones", label: "Milestones" },
    { id: "create",     label: "Create" },
    { id: "ipfs",       label: "IPFS Guide" },
  ];

  return (
    <div style={s.root}>

      {/* ── Hero Header ── */}
      <header style={s.hero}>
        <div style={s.heroInner}>
          <div>
            <div style={s.heroLogo}>
              <span style={s.logoIcon}>🤝</span>
              <span style={s.logoText}>TraceableHands</span>
            </div>
            <p style={s.heroTagline}>Donate. Track. Know.</p>
          </div>
          {account ? (
            <div style={s.walletPill}>
              <span style={s.walletDot} />
              <span style={s.walletAddr}>{truncateAddress(account)}</span>
            </div>
          ) : (
            <button style={s.connectBtn} onClick={connectWallet}>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* ── Loading Banner ── */}
      {loading && (
        <div style={s.banner}>
          <span style={s.spinner}>⏳</span> {loading}
        </div>
      )}

      {!account ? (

        /* ── Landing ── */
        <div style={s.landing}>
          <div style={s.landingCard}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔗</div>
            <h2 style={s.landingTitle}>Connect your wallet to get started</h2>
            <p style={s.landingDesc}>
              TraceableHands uses blockchain escrow so your donation reaches its destination
              — or comes back to you. No middlemen, no trust required.
            </p>
            <button style={s.connectBtnLg} onClick={connectWallet}>Connect MetaMask</button>
            <p style={s.landingHint}>Make sure MetaMask is installed and set to Sepolia testnet.</p>
          </div>

          {/* How it works */}
          <div style={s.stepsGrid}>
            {[
              { icon: "💸", title: "1. Donate", desc: "Send USDC to a milestone. Funds lock in escrow." },
              { icon: "🏆", title: "2. Goal Reached", desc: "50% released to the vendor automatically." },
              { icon: "📸", title: "3. Vendor Submits Proof", desc: "Vendor uploads delivery evidence to IPFS." },
              { icon: "🗳", title: "4. Donors Vote", desc: "Every donor votes: Approve, Needs More Proof, or Reject." },
              { icon: "✅", title: "5. Complete", desc: "Majority approves → remaining 50% released. Vendor earns reputation." },
            ].map(step => (
              <div key={step.title} style={s.stepCard}>
                <div style={s.stepIcon}>{step.icon}</div>
                <h4 style={s.stepTitle}>{step.title}</h4>
                <p style={s.stepDesc}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

      ) : (

        <div style={s.appLayout}>

          {/* ── Sidebar / Stats ── */}
          <aside style={s.sidebar}>
            <div style={s.statCard}>
              <p style={s.statLabel}>USDC Balance</p>
              <p style={s.statValue}>{parseFloat(usdcBalance).toLocaleString()}</p>
              <p style={s.statUnit}>USDC</p>
              <button style={s.btnSm} onClick={handleFaucet}>+ Get 1000 Test USDC</button>
            </div>

            <div style={s.statCard}>
              <p style={s.statLabel}>Vendor Reputation</p>
              <p style={s.statValue}>{vendorRep}</p>
              <p style={s.statUnit}>completed milestones</p>
            </div>

            <div style={s.statCard}>
              <p style={s.statLabel}>Your Role</p>
              <p style={{ fontSize: "13px", color: "#374151", margin: "0 0 0.5rem", lineHeight: "1.6" }}>
                <strong>Charity/Vendor:</strong> Create milestones, submit proof.
              </p>
              <p style={{ fontSize: "13px", color: "#374151", margin: 0, lineHeight: "1.6" }}>
                <strong>Donor:</strong> Donate and automatically earn voting rights.
              </p>
            </div>

            <div style={s.statCard}>
              <p style={s.statLabel}>Your Address</p>
              <p style={{ ...s.mono, fontSize: "11px", wordBreak: "break-all", color: "#374151" }}>{account}</p>
              <a
                href={"https://sepolia.etherscan.io/address/" + account}
                target="_blank" rel="noreferrer" style={s.ethLink}
              >View on Etherscan →</a>
            </div>
          </aside>

          {/* ── Main Content ── */}
          <main style={s.main}>

            {/* Tab nav */}
            <div style={s.tabBar}>
              {tabs.map(t => (
                <button
                  key={t.id}
                  style={{ ...s.tab, ...(activeTab === t.id ? s.tabActive : {}) }}
                  onClick={() => setActiveTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Tab: Milestones ── */}
            {activeTab === "milestones" && (
              <div>
                <div style={s.sectionHeader}>
                  <h2 style={s.sectionTitle}>All Milestones</h2>
                  <button style={s.refreshBtn} onClick={() => refreshAll(traceableHands, mockUSDC, account)}>
                    ↻ Refresh
                  </button>
                </div>

                {milestones.length === 0 ? (
                  <div style={s.emptyState}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📋</div>
                    <p style={{ color: "#6b7280", margin: 0 }}>No milestones yet. Create one in the Create tab!</p>
                  </div>
                ) : (
                  milestones.map(m => {
                    const pct   = progressPct(m.balance, m.goal);
                    const color = STATE_COLORS[m.state];
                    const bg    = STATE_BG[m.state];
                    const totalVotes = m.approveVotes + m.needsMoreProofVotes + m.rejectVotes;

                    const isCharity = account.toLowerCase() === m.charity.toLowerCase();
                    const isVendor  = account.toLowerCase() === m.vendor.toLowerCase();
                    const isDonor   = parseFloat(m.myContrib) > 0;

                    return (
                      <div key={m.id} style={s.mCard}>

                        {/* Card header */}
                        <div style={s.mCardHeader}>
                          <div style={{ flex: 1 }}>
                            <span style={s.mId}>#{m.id}</span>
                            <h3 style={s.mTitle}>{m.description}</h3>
                          </div>
                          <span style={{ ...s.badge, color, background: bg, border: `1px solid ${color}40` }}>
                            {STATE_NAMES[m.state]}
                          </span>
                        </div>

                        {/* Progress */}
                        <div style={s.progressWrapper}>
                          <div style={s.track}>
                            <div style={{ ...s.fill, width: pct + "%", background: color }} />
                          </div>
                          <div style={s.progressLabels}>
                            <span style={s.meta}>{m.balance} / {m.goal} USDC</span>
                            <span style={{ ...s.meta, fontWeight: "600", color }}>{Math.round(pct)}%</span>
                          </div>
                        </div>

                        {/* Meta row */}
                        <div style={s.metaRow}>
                          <span style={s.metaChip}>📅 {m.deadline}</span>
                          <span style={s.metaChip}>🏭 Vendor: <span style={s.mono}>{truncateAddress(m.vendor)}</span></span>
                          <span style={s.metaChip}>🏛 Charity: <span style={s.mono}>{truncateAddress(m.charity)}</span></span>
                          {isDonor && <span style={{ ...s.metaChip, background: "#ecfdf5", borderColor: "#6ee7b7", color: "#065f46" }}>🗳 You donated {m.myContrib} USDC</span>}
                          {m.firstPaymentSent && <span style={{ ...s.metaChip, background: "#fffbeb", borderColor: "#fcd34d", color: "#92400e" }}>50% sent to vendor</span>}
                        </div>

                        {/* Proof CID display */}
                        {m.proofCID && (
                          <div style={s.evidenceBadge}>
                            📎 Proof on IPFS:{" "}
                            <a href={"https://ipfs.io/ipfs/" + m.proofCID}
                              target="_blank" rel="noreferrer" style={{ color: "#166534" }}>
                              {m.proofCID.slice(0, 28)}…
                            </a>
                            {m.proofRound > 0 && (
                              <span style={{ marginLeft: "0.5rem", color: "#92400e", fontSize: "11px" }}>
                                (round {m.proofRound + 1}/{3})
                              </span>
                            )}
                          </div>
                        )}

                        {/* ── ACTIONS ── */}

                        {/* Donate — only when Funding */}
                        {m.state === 0 && (
                          <div style={s.actionBox}>
                            <p style={s.actionLabel}>💸 Donate to this milestone</p>
                            <div style={s.actionRow}>
                              <input
                                style={{ ...s.input, flex: 1 }}
                                type="number"
                                placeholder="Amount in USDC"
                                value={donateAmounts[m.id] || ""}
                                onChange={e => setDonateAmounts({ ...donateAmounts, [m.id]: e.target.value })}
                              />
                              <button style={s.btnPrimary} onClick={() => handleDonate(m.id)}>Donate</button>
                            </div>
                            <p style={s.hint}>Two MetaMask popups: approve spend, then donate.</p>
                          </div>
                        )}

                        {/* Submit Proof — only when ProofPending AND user is charity or vendor */}
                        {m.state === 1 && (isCharity || isVendor) && (
                          <div style={s.actionBox}>
                            <p style={s.actionLabel}>
                              📸 Submit Proof of Delivery
                              {m.proofRound > 0 && ` — Round ${m.proofRound + 1} (re-submission)`}
                            </p>
                            <p style={{ ...s.hint, margin: "0 0 0.75rem", color: "#374151", fontSize: "13px" }}>
                              Upload your evidence to IPFS (see IPFS Guide tab) and paste the CID below.
                              This opens voting for all donors.
                            </p>
                            <div style={s.fg}>
                              <label style={s.label}>IPFS Evidence CID</label>
                              <input
                                style={s.input}
                                type="text"
                                placeholder="QmXxx… (paste CID from Pinata/web3.storage)"
                                value={proofCIDs[m.id] || ""}
                                onChange={e => setProofCIDs({ ...proofCIDs, [m.id]: e.target.value })}
                              />
                              <p style={s.hint}>
                                Need to upload first?{" "}
                                <button style={s.textBtn} onClick={() => setActiveTab("ipfs")}>See IPFS Guide →</button>
                              </p>
                            </div>
                            <button style={{ ...s.btnPrimary, width: "100%" }}
                              onClick={() => handleSubmitProof(m.id)}>
                              Submit Proof &amp; Open Voting
                            </button>
                          </div>
                        )}

                        {/* Waiting for proof — shown to non-charity/vendor when ProofPending */}
                        {m.state === 1 && !isCharity && !isVendor && (
                          <div style={s.infoBox}>
                            <p style={{ margin: 0, fontSize: "13px", color: "#92400e" }}>
                              ⏳ Waiting for the vendor or charity to upload proof of delivery.
                              Once uploaded, you will be able to vote.
                            </p>
                          </div>
                        )}

                        {/* Crowd Vote — when VotingOpen */}
                        {m.state === 2 && (
                          <div style={s.actionBox}>
                            <p style={s.actionLabel}>🗳 Crowd Audit — Donor Voting</p>

                            {/* Vote tally bar */}
                            {totalVotes > 0 && (
                              <div style={{ marginBottom: "1rem" }}>
                                <div style={{ display: "flex", height: "10px", borderRadius: "999px", overflow: "hidden", marginBottom: "0.4rem" }}>
                                  <div style={{ width: `${(m.approveVotes / totalVotes) * 100}%`, background: "#10b981" }} />
                                  <div style={{ width: `${(m.needsMoreProofVotes / totalVotes) * 100}%`, background: "#f59e0b" }} />
                                  <div style={{ width: `${(m.rejectVotes / totalVotes) * 100}%`, background: "#ef4444" }} />
                                </div>
                                <div style={{ display: "flex", gap: "1rem", fontSize: "12px" }}>
                                  <span style={{ color: "#065f46" }}>✅ Approve: {m.approveVotes}</span>
                                  <span style={{ color: "#92400e" }}>🔄 Needs more: {m.needsMoreProofVotes}</span>
                                  <span style={{ color: "#991b1b" }}>❌ Reject: {m.rejectVotes}</span>
                                </div>
                                <p style={{ ...s.hint, margin: "0.25rem 0 0" }}>
                                  {totalVotes} vote{totalVotes !== 1 ? "s" : ""} cast out of {m.donorCount} donor{m.donorCount !== 1 ? "s" : ""}.
                                  Need majority (&gt;50%) with at least {Math.min(3, m.donorCount)} voters.
                                </p>
                              </div>
                            )}

                            {isDonor && !m.myVoted && (
                              <>
                                <p style={{ fontSize: "13px", color: "#374151", margin: "0 0 0.75rem" }}>
                                  You donated {m.myContrib} USDC to this milestone. Cast your vote:
                                </p>
                                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                                  <button
                                    style={{ ...s.btnPrimary, background: "#059669", flex: 1, minWidth: "120px" }}
                                    onClick={() => handleCrowdVote(m.id, VOTE_APPROVE)}>
                                    ✅ Approve
                                  </button>
                                  <button
                                    style={{ ...s.btnPrimary, background: "#d97706", flex: 1, minWidth: "120px" }}
                                    onClick={() => handleCrowdVote(m.id, VOTE_NEEDS_MORE_PROOF)}>
                                    🔄 Needs More Proof
                                  </button>
                                  <button
                                    style={{ ...s.btnPrimary, background: "#dc2626", flex: 1, minWidth: "120px" }}
                                    onClick={() => handleCrowdVote(m.id, VOTE_REJECT)}>
                                    ❌ Reject
                                  </button>
                                </div>
                                <p style={s.hint}>
                                  Approve → releases remaining 50% to vendor. &nbsp;
                                  Needs More Proof → vendor can re-submit (max 3 rounds). &nbsp;
                                  Reject → milestone fails, you get 50% refund.
                                </p>
                              </>
                            )}

                            {isDonor && m.myVoted && (
                              <div style={{ ...s.infoBox, marginTop: "0.5rem" }}>
                                <p style={{ margin: 0, fontSize: "13px", color: "#92400e" }}>
                                  ✔ You have already voted in this round. Waiting for other donors.
                                </p>
                              </div>
                            )}

                            {!isDonor && (
                              <div style={{ ...s.infoBox, marginTop: "0.5rem" }}>
                                <p style={{ margin: 0, fontSize: "13px", color: "#92400e" }}>
                                  👁 Only donors who contributed to this milestone can vote.
                                  You did not donate to this milestone.
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Refund — Failed or Cancelled */}
                        {(m.state === 4 || m.state === 5) && (
                          <div style={s.actionBox}>
                            <p style={s.actionLabel}>💰 Claim Your Refund</p>
                            {m.firstPaymentSent && (
                              <div style={{ ...s.infoBox, marginBottom: "0.75rem" }}>
                                <p style={{ margin: 0, fontSize: "13px", color: "#92400e" }}>
                                  ⚠️ The first 50% was already sent to the vendor when the goal was reached.
                                  You can only reclaim your share of the remaining 50%.
                                </p>
                              </div>
                            )}
                            <button style={{ ...s.btnPrimary, background: "#ef4444" }}
                              onClick={() => handleRefund(m.id)}>
                              Claim Refund
                            </button>
                          </div>
                        )}

                        <div style={s.cardFooter}>
                          <a href={"https://sepolia.etherscan.io/address/" + deployedAddresses.traceableHands}
                            target="_blank" rel="noreferrer" style={s.ethLink}>
                            View contract on Etherscan →
                          </a>
                        </div>

                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ── Tab: Create ── */}
            {activeTab === "create" && (
              <div>
                <div style={s.sectionHeader}>
                  <h2 style={s.sectionTitle}>Create a Milestone</h2>
                </div>
                <div style={s.formCard}>
                  <p style={s.formIntro}>
                    Create a fundraising milestone. When the goal is reached, 50% goes to the vendor
                    immediately. The vendor then uploads proof of delivery. All donors vote to approve,
                    request more evidence, or reject. A majority decision releases or returns the remaining 50%.
                  </p>
                  <form onSubmit={handleCreate}>
                    <div style={s.formGrid}>
                      <div style={s.fg}>
                        <label style={s.label}>Goal Amount (USDC)</label>
                        <input style={s.input} type="number" placeholder="e.g. 500"
                          value={form.goal} onChange={e => setForm({ ...form, goal: e.target.value })} required />
                      </div>
                      <div style={s.fg}>
                        <label style={s.label}>Duration (days)</label>
                        <input style={s.input} type="number" placeholder="30"
                          value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} required />
                      </div>
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Vendor Wallet Address</label>
                      <input style={s.input} type="text" placeholder="0x… (the vendor who receives funds)"
                        value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} required />
                      <p style={s.hint}>
                        Use a different MetaMask account to test the vendor role.
                      </p>
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Description</label>
                      <input style={s.input} type="text" placeholder="e.g. Buy 500 meals for flood victims"
                        value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required />
                    </div>
                    <button style={{ ...s.btnPrimary, width: "100%", padding: "0.8rem" }} type="submit">
                      Create Milestone on Blockchain
                    </button>
                  </form>
                </div>

                <div style={s.tipCard}>
                  <h3 style={s.tipTitle}>💡 Testing Multiple Roles</h3>
                  <p style={s.tipText}>
                    MetaMask supports multiple accounts under the same seed phrase. To simulate different roles:
                  </p>
                  <ol style={s.tipList}>
                    <li>Open MetaMask → click your account icon → <strong>Create Account</strong></li>
                    <li><strong>Account 1 (Charity):</strong> Create the milestone with Account 2 as vendor</li>
                    <li><strong>Account 2 (Vendor):</strong> Receives 50% automatically; submits IPFS proof</li>
                    <li><strong>Accounts 3, 4, 5 (Donors):</strong> Donate, then vote when proof is uploaded</li>
                    <li>Each account needs Sepolia ETH for gas — get some from{" "}
                      <a href="https://sepoliafaucet.com" target="_blank" rel="noreferrer" style={{ color: "#6366f1" }}>
                        sepoliafaucet.com
                      </a>
                    </li>
                  </ol>
                </div>
              </div>
            )}

            {/* ── Tab: IPFS Guide ── */}
            {activeTab === "ipfs" && (
              <div>
                <div style={s.sectionHeader}>
                  <h2 style={s.sectionTitle}>IPFS Guide</h2>
                </div>

                <div style={s.formCard}>
                  <h3 style={s.guideSection}>What is IPFS?</h3>
                  <p style={s.guideText}>
                    <strong>IPFS (InterPlanetary File System)</strong> is a decentralized storage network.
                    Every file gets a unique <strong>CID (Content Identifier)</strong> — a hash fingerprint
                    generated from the file's contents. If the file changes even by one pixel, the CID changes.
                    This makes it tamper-proof.
                  </p>
                  <div style={s.exampleBox}>
                    <p style={{ margin: "0 0 0.5rem", fontSize: "13px", fontWeight: "600", color: "#a5b4fc" }}>
                      Example CID:
                    </p>
                    <code style={s.code}>QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco</code>
                  </div>

                  <h3 style={s.guideSection}>How to upload proof photos (step-by-step)</h3>

                  <div style={s.methodCard}>
                    <h4 style={s.methodTitle}>Method 1: Pinata (Recommended, Free)</h4>
                    <ol style={s.methodSteps}>
                      <li>Go to <a href="https://pinata.cloud" target="_blank" rel="noreferrer" style={{ color: "#6366f1" }}>pinata.cloud</a> and create a free account</li>
                      <li>Click <strong>Upload</strong> → <strong>File</strong></li>
                      <li>Select your evidence photo(s) or receipt</li>
                      <li>Click <strong>Upload</strong> and wait a few seconds</li>
                      <li>Copy the CID (starts with <code style={s.inlineCode}>Qm…</code> or <code style={s.inlineCode}>bafy…</code>)</li>
                      <li>Paste it into the proof submission form on the Milestones tab</li>
                    </ol>
                  </div>

                  <div style={s.methodCard}>
                    <h4 style={s.methodTitle}>Method 2: web3.storage (Alternative, Free)</h4>
                    <ol style={s.methodSteps}>
                      <li>Go to <a href="https://web3.storage" target="_blank" rel="noreferrer" style={{ color: "#6366f1" }}>web3.storage</a> and sign in with GitHub</li>
                      <li>Click <strong>Upload Files</strong>, select your file and upload</li>
                      <li>Copy the CID from the dashboard</li>
                    </ol>
                  </div>

                  <h3 style={s.guideSection}>Verifying your uploaded file</h3>
                  <div style={s.exampleBox}>
                    <code style={s.code}>https://ipfs.io/ipfs/YOUR_CID_HERE</code>
                  </div>
                  <p style={s.guideText}>
                    It may take 1–2 minutes for the file to propagate. Once confirmed, paste just the CID
                    (not the full URL) into the proof form.
                  </p>

                  <div style={{ ...s.infoBox, marginTop: "1.5rem" }}>
                    <p style={{ margin: 0, fontSize: "13px", color: "#92400e" }}>
                      ⚠️ <strong>Important:</strong> IPFS files are public. Only upload content you
                      are allowed to share publicly.
                    </p>
                  </div>
                </div>
              </div>
            )}

          </main>
        </div>
      )}

      <footer style={s.footer}>
        <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px" }}>
          TraceableHands · Sepolia Testnet · FT5004 Group 3 (Team 8888)
        </p>
      </footer>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = {
  root:        { minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#111" },

  // Header
  hero:        { background: "linear-gradient(135deg, #312e81 0%, #4f46e5 50%, #7c3aed 100%)", padding: "0" },
  heroInner:   { maxWidth: "1200px", margin: "0 auto", padding: "1.25rem 2rem", display: "flex", justifyContent: "space-between", alignItems: "center" },
  heroLogo:    { display: "flex", alignItems: "center", gap: "0.75rem" },
  logoIcon:    { fontSize: "1.75rem" },
  logoText:    { fontSize: "1.5rem", fontWeight: "700", color: "#fff", letterSpacing: "-0.5px" },
  heroTagline: { color: "#c7d2fe", margin: "0.2rem 0 0", fontSize: "13px" },
  connectBtn:  { background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: "8px", padding: "0.6rem 1.25rem", fontSize: "14px", fontWeight: "500", cursor: "pointer", backdropFilter: "blur(4px)" },
  walletPill:  { display: "flex", alignItems: "center", gap: "0.5rem", background: "rgba(255,255,255,0.15)", borderRadius: "20px", padding: "0.5rem 1rem", border: "1px solid rgba(255,255,255,0.25)" },
  walletDot:   { width: "8px", height: "8px", borderRadius: "50%", background: "#4ade80" },
  walletAddr:  { color: "#fff", fontSize: "13px", fontFamily: "monospace" },

  // Loading banner
  banner:      { background: "#fffbeb", borderBottom: "1px solid #fcd34d", padding: "0.75rem 2rem", color: "#92400e", fontSize: "14px" },
  spinner:     {},

  // Landing
  landing:     { maxWidth: "960px", margin: "0 auto", padding: "3rem 1.5rem" },
  landingCard: { background: "#fff", borderRadius: "16px", padding: "3rem", textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", marginBottom: "3rem" },
  landingTitle:  { fontSize: "1.75rem", fontWeight: "700", margin: "0 0 1rem", color: "#1e1b4b" },
  landingDesc:   { color: "#6b7280", fontSize: "15px", lineHeight: "1.7", maxWidth: "520px", margin: "0 auto 2rem" },
  connectBtnLg:  { background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: "10px", padding: "0.9rem 2.5rem", fontSize: "16px", fontWeight: "600", cursor: "pointer" },
  landingHint:   { color: "#9ca3af", fontSize: "12px", marginTop: "1rem" },
  stepsGrid:   { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" },
  stepCard:    { background: "#fff", borderRadius: "12px", padding: "1.5rem", textAlign: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" },
  stepIcon:    { fontSize: "2rem", marginBottom: "0.75rem" },
  stepTitle:   { fontWeight: "600", fontSize: "14px", margin: "0 0 0.5rem", color: "#1e1b4b" },
  stepDesc:    { fontSize: "13px", color: "#6b7280", margin: 0, lineHeight: "1.5" },

  // App layout
  appLayout:   { maxWidth: "1200px", margin: "0 auto", padding: "2rem 1.5rem", display: "flex", gap: "1.5rem", alignItems: "flex-start" },
  sidebar:     { width: "260px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "1rem" },
  main:        { flex: 1, minWidth: 0 },

  // Sidebar cards
  statCard:    { background: "#fff", borderRadius: "12px", padding: "1.25rem", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #f1f5f9" },
  statLabel:   { fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af", margin: "0 0 0.25rem" },
  statValue:   { fontSize: "1.5rem", fontWeight: "700", margin: "0 0 0.1rem", color: "#1e1b4b" },
  statUnit:    { fontSize: "12px", color: "#6b7280", margin: "0 0 0.75rem" },
  statHint:    { fontSize: "12px", color: "#6b7280", margin: "0.5rem 0 0" },
  btnSm:       { background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: "6px", padding: "0.5rem 0.9rem", fontSize: "12px", fontWeight: "500", cursor: "pointer", width: "100%" },
  ethLink:     { fontSize: "12px", color: "#6366f1", textDecoration: "none", display: "inline-block", marginTop: "0.5rem" },

  // Tabs
  tabBar:      { display: "flex", gap: "0.25rem", marginBottom: "1.5rem", background: "#fff", borderRadius: "10px", padding: "0.35rem", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #f1f5f9" },
  tab:         { flex: 1, padding: "0.6rem", border: "none", borderRadius: "7px", fontSize: "14px", fontWeight: "500", cursor: "pointer", background: "transparent", color: "#6b7280" },
  tabActive:   { background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", boxShadow: "0 2px 6px rgba(79,70,229,0.35)" },

  // Section header
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" },
  sectionTitle:  { fontSize: "1.2rem", fontWeight: "700", margin: 0, color: "#1e1b4b" },
  refreshBtn:    { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "0.4rem 0.8rem", fontSize: "13px", cursor: "pointer", color: "#374151" },

  // Milestone cards
  mCard:       { background: "#fff", borderRadius: "14px", padding: "1.5rem", marginBottom: "1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #f1f5f9" },
  mCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", gap: "1rem" },
  mId:         { fontSize: "11px", fontWeight: "600", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.25rem" },
  mTitle:      { fontSize: "1rem", fontWeight: "600", margin: 0, color: "#1e1b4b" },
  badge:       { padding: "0.3rem 0.75rem", borderRadius: "999px", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap", flexShrink: 0 },

  // Progress
  progressWrapper: { marginBottom: "0.75rem" },
  track:       { background: "#f1f5f9", borderRadius: "999px", height: "8px", overflow: "hidden", marginBottom: "0.4rem" },
  fill:        { height: "100%", borderRadius: "999px", transition: "width 0.4s ease" },
  progressLabels: { display: "flex", justifyContent: "space-between" },

  // Meta chips
  metaRow:     { display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" },
  metaChip:    { fontSize: "12px", color: "#374151", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "0.2rem 0.6rem" },
  meta:        { fontSize: "13px", color: "#6b7280" },
  mono:        { fontFamily: "monospace", fontSize: "11px" },

  evidenceBadge: { background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "6px", padding: "0.4rem 0.75rem", fontSize: "12px", color: "#166534", marginBottom: "0.75rem" },

  // Action boxes
  actionBox:   { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "1rem", marginTop: "0.75rem" },
  actionLabel: { fontWeight: "600", fontSize: "14px", margin: "0 0 0.75rem", color: "#1e1b4b" },
  actionRow:   { display: "flex", gap: "0.75rem", alignItems: "center" },
  infoBox:     { background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "0.75rem 1rem", marginTop: "0.75rem" },

  cardFooter:  { marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #f1f5f9" },

  // Forms
  formCard:    { background: "#fff", borderRadius: "14px", padding: "1.5rem", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #f1f5f9", marginBottom: "1.5rem" },
  formIntro:   { color: "#6b7280", fontSize: "14px", marginTop: 0, marginBottom: "1.5rem", lineHeight: "1.6" },
  formGrid:    { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" },
  fg:          { marginBottom: "1rem" },
  label:       { display: "block", fontSize: "13px", color: "#374151", marginBottom: "0.35rem", fontWeight: "500" },
  input:       { width: "100%", padding: "0.6rem 0.85rem", border: "1px solid #d1d5db", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", outline: "none", transition: "border-color 0.15s" },
  btnPrimary:  { background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: "8px", padding: "0.65rem 1.25rem", fontSize: "14px", fontWeight: "500", cursor: "pointer", whiteSpace: "nowrap" },
  hint:        { fontSize: "12px", color: "#9ca3af", margin: "0.4rem 0 0" },
  textBtn:     { background: "none", border: "none", color: "#6366f1", cursor: "pointer", padding: 0, fontSize: "12px", fontWeight: "500" },

  // Tip card
  tipCard:     { background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "12px", padding: "1.25rem 1.5rem" },
  tipTitle:    { margin: "0 0 0.75rem", fontSize: "15px", fontWeight: "600", color: "#1e40af" },
  tipText:     { fontSize: "14px", color: "#1e40af", margin: "0 0 0.75rem", lineHeight: "1.6" },
  tipList:     { fontSize: "13px", color: "#1e40af", paddingLeft: "1.25rem", margin: 0, lineHeight: "2" },

  // Empty state
  emptyState:  { background: "#fff", borderRadius: "14px", padding: "3rem", textAlign: "center", border: "2px dashed #e2e8f0" },

  // IPFS Guide
  guideSection: { fontSize: "1rem", fontWeight: "600", color: "#1e1b4b", marginTop: "1.5rem", marginBottom: "0.5rem", paddingBottom: "0.5rem", borderBottom: "2px solid #e0e7ff" },
  guideText:   { fontSize: "14px", color: "#374151", lineHeight: "1.7", margin: "0 0 0.75rem" },
  exampleBox:  { background: "#1e1b4b", borderRadius: "8px", padding: "0.75rem 1rem", margin: "0.75rem 0" },
  code:        { fontFamily: "monospace", fontSize: "13px", color: "#a5b4fc", wordBreak: "break-all" },
  inlineCode:  { fontFamily: "monospace", fontSize: "12px", background: "#e0e7ff", color: "#3730a3", padding: "0.1rem 0.3rem", borderRadius: "3px" },
  methodCard:  { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "1rem 1.25rem", marginBottom: "1rem" },
  methodTitle: { margin: "0 0 0.75rem", fontSize: "14px", fontWeight: "600", color: "#1e1b4b" },
  methodSteps: { margin: 0, paddingLeft: "1.25rem", fontSize: "13px", color: "#374151", lineHeight: "2" },

  // Footer
  footer:      { borderTop: "1px solid #e2e8f0", padding: "1.5rem 2rem", textAlign: "center", marginTop: "3rem" },
};
