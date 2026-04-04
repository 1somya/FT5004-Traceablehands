// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ERC20 from OpenZeppelin gives us a complete, working token with
// transfer(), approve(), transferFrom(), balanceOf() etc. — all for free.
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC - A fake USDC token for testing only.
/// @notice In the real world you would use the actual USDC contract address.
///         This exists purely so we can test our DApp without real money.
contract MockUSDC is ERC20 {

    // The constructor takes two arguments:
    // "USD Coin" is the full token name (shows in MetaMask)
    // "USDC" is the ticker symbol
    constructor() ERC20("USD Coin", "USDC") {
        // Mint 1,000,000 USDC to whoever deploys this contract (you).
        // _mint creates tokens out of thin air — fine for testing.
        // 1_000_000 * 10**6 because USDC has 6 decimal places,
        // so 1 USDC = 1,000,000 in the smallest unit (called "microUSDC").
        _mint(msg.sender, 1_000_000 * 10**6);
    }

    // USDC uses 6 decimal places (not 18 like ETH).
    // We override this function to tell the ERC20 base contract that.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice A helper function to get free test tokens.
    ///         In production this would not exist.
    function faucet(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}