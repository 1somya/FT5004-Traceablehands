import { useState, useEffect } from "react";
import { ethers } from "ethers";

// Import the ABI (Application Binary Interface) — tells ethers.js
// what functions exist on the contract and how to call them.
import TraceableHandsABI from "./contracts/TraceableHands.json";
import MockUSDCABI from "./contracts/MockUSDC.json";
import deployedAddresses from "./contracts/deployed-addresses.json";

function App() {
  // React state — these variables trigger a re-render when they change.
  const [provider, setProvider] = useState(null);     // Connection to blockchain
  const [signer, setSigner] = useState(null);         // The connected wallet
  const [account, setAccount] = useState("");         // The wallet address string
  const [traceableHands, setTraceableHands] = useState(null); // Contract instance
  const [mockUSDC, setMockUSDC] = useState(null);     // Token contract instance
  const [milestones, setMilestones] = useState([]);   // List of milestones to display
  const [usdcBalance, setUsdcBalance] = useState("0"); // User's token balance

  // Form state for creating a new milestone
  const [newMilestone, setNewMilestone] = useState({
    goal: "",
    vendor: "",
    description: "",
    duration: "30",
  });

  // ---- Connect Wallet ----
  // This function runs when the user clicks "Connect Wallet."
const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Please install MetaMask to use this app.");
      return;
    }

    // ADD THIS BLOCK — force switch to Sepolia before doing anything else
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }], // 0xaa36a7 is Sepolia's chain ID in hex
      });
    } catch (switchError) {
      // Error code 4902 means Sepolia isn't added to MetaMask yet
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0xaa36a7",
              chainName: "Sepolia test network",
              nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://rpc.sepolia.org"],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            }],
          });
        } catch (addError) {
          alert("Could not add Sepolia network to MetaMask.");
          return;
        }
      } else {
        alert("Please switch MetaMask to Sepolia network.");
        return;
      }
    }

    // Everything below stays exactly the same as before
    const web3Provider = new ethers.BrowserProvider(window.ethereum);
    const web3Signer = await web3Provider.getSigner();
    const userAddress = await web3Signer.getAddress();

    setProvider(web3Provider);
    setSigner(web3Signer);
    setAccount(userAddress);

    const thContract = new ethers.Contract(
      deployedAddresses.traceableHands,
      TraceableHandsABI.abi,
      web3Signer
    );

    const usdcContract = new ethers.Contract(
      deployedAddresses.mockUSDC,
      MockUSDCABI.abi,
      web3Signer
    );

    console.log("Connecting to TraceableHands at:", deployedAddresses.traceableHands);
    console.log("Connecting to MockUSDC at:", deployedAddresses.mockUSDC);

    const network = await web3Provider.getNetwork();
    console.log("Network name:", network.name);
    console.log("Chain ID:", network.chainId.toString());

    setTraceableHands(thContract);
    setMockUSDC(usdcContract);

    await loadMilestones(thContract);
    await loadUSDCBalance(usdcContract, userAddress);
};

  // ---- Load all milestones from the contract ----
  const loadMilestones = async (contract) => {
    const count = await contract.milestoneCount();
    const loaded = [];

    for (let i = 0; i < count; i++) {
      const m = await contract.getMilestone(i);
      loaded.push({
        id: Number(m.id),
        charity: m.charity,
        vendor: m.vendorAddress,
        description: m.description,
        // Convert from smallest unit to human-readable USDC (divide by 10^6)
        goal: ethers.formatUnits(m.goalAmount, 6),
        balance: ethers.formatUnits(m.currentBalance, 6),
        state: Number(m.state),
        // Convert Unix timestamp to readable date
        deadline: new Date(Number(m.deadline) * 1000).toLocaleDateString(),
      });
    }

    setMilestones(loaded);
  };

  // ---- Load user's USDC balance ----
  const loadUSDCBalance = async (usdcContract, address) => {
    const balance = await usdcContract.balanceOf(address);
    setUsdcBalance(ethers.formatUnits(balance, 6));
  };

  // ---- Create a new milestone ----
  const handleCreateMilestone = async (e) => {
    e.preventDefault();

    // Convert human-readable USDC to smallest unit (multiply by 10^6)
    const goalInSmallestUnit = ethers.parseUnits(newMilestone.goal, 6);

    const tx = await traceableHands.createMilestone(
      goalInSmallestUnit,
      newMilestone.vendor,
      newMilestone.description,
      parseInt(newMilestone.duration)
    );

    // Wait for the transaction to be mined (confirmed on-chain)
    await tx.wait();
    alert("Milestone created!");
    await loadMilestones(traceableHands);
  };

  // ---- Donate to a milestone ----
  const handleDonate = async (milestoneId, amount) => {
    const amountInSmallestUnit = ethers.parseUnits(amount, 6);

    // Step 1: Approve the contract to spend your tokens.
    // The user signs an approval transaction first.
    const approveTx = await mockUSDC.approve(
      deployedAddresses.traceableHands,
      amountInSmallestUnit
    );
    await approveTx.wait();
    alert("Approved! Now donating...");

    // Step 2: Call donate — the contract pulls the tokens.
    const donateTx = await traceableHands.donate(milestoneId, amountInSmallestUnit);
    await donateTx.wait();

    alert("Donation successful!");
    await loadMilestones(traceableHands);
    await loadUSDCBalance(mockUSDC, account);
  };

  // ---- State name helper ----
  const getStateName = (stateNum) => {
    const states = ["Funding", "Audit Pending", "Completed", "Failed", "Cancelled"];
    return states[stateNum] || "Unknown";
  };

  // ---- Render ----
  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "800px", margin: "0 auto" }}>
      <h1>TraceableHands</h1>
      <p style={{ color: "#666" }}>Donate. Track. Know.</p>

      {!account ? (
        <button onClick={connectWallet} style={{ padding: "12px 24px", fontSize: "16px" }}>
          Connect Wallet
        </button>
      ) : (
        <div>
          <p>Connected: {account}</p>
          <p>Your USDC Balance: {usdcBalance} USDC</p>

          {/* Get test tokens */}
          <button onClick={async () => {
            const tx = await mockUSDC.faucet(ethers.parseUnits("1000", 6));
            await tx.wait();
            await loadUSDCBalance(mockUSDC, account);
            alert("Got 1000 test USDC!");
          }}>
            Get 1000 Test USDC (Faucet)
          </button>

          <hr />

          {/* Create Milestone Form */}
          <h2>Create a Milestone</h2>
          <form onSubmit={handleCreateMilestone}>
            <div>
              <label>Goal (USDC): </label>
              <input
                type="number"
                value={newMilestone.goal}
                onChange={(e) => setNewMilestone({ ...newMilestone, goal: e.target.value })}
                required
              />
            </div>
            <div>
              <label>Vendor Address: </label>
              <input
                type="text"
                value={newMilestone.vendor}
                onChange={(e) => setNewMilestone({ ...newMilestone, vendor: e.target.value })}
                required
              />
            </div>
            <div>
              <label>Description: </label>
              <input
                type="text"
                value={newMilestone.description}
                onChange={(e) => setNewMilestone({ ...newMilestone, description: e.target.value })}
                required
              />
            </div>
            <div>
              <label>Duration (days): </label>
              <input
                type="number"
                value={newMilestone.duration}
                onChange={(e) => setNewMilestone({ ...newMilestone, duration: e.target.value })}
                required
              />
            </div>
            <button type="submit">Create Milestone</button>
          </form>

          <hr />

          {/* Milestones List */}
          <h2>All Milestones</h2>
          {milestones.length === 0 ? (
            <p>No milestones yet. Create one above!</p>
          ) : (
            milestones.map((m) => (
              <div key={m.id} style={{ border: "1px solid #ddd", padding: "1rem", marginBottom: "1rem", borderRadius: "8px" }}>
                <h3>{m.description}</h3>
                <p>State: <strong>{getStateName(m.state)}</strong></p>
                <p>Progress: {m.balance} / {m.goal} USDC</p>
                <p>Deadline: {m.deadline}</p>
                <p>Vendor: {m.vendor}</p>

                {m.state === 0 && ( // Only show donate button in Funding state
                  <div>
                    <input
                      type="number"
                      placeholder="Amount in USDC"
                      id={`donate-amount-${m.id}`}
                    />
                    <button onClick={() => {
                      const amount = document.getElementById(`donate-amount-${m.id}`).value;
                      handleDonate(m.id, amount);
                    }}>
                      Donate
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default App;