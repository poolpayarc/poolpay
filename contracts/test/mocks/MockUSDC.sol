// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Test-only ERC20 that mimics USDC: 6 decimals, standard ERC20 surface
 *         (transfer/transferFrom/approve/balanceOf/allowance via OpenZeppelin), and an
 *         open {mint} for funding test accounts.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    /// @dev USDC uses 6 decimals rather than the ERC20 default of 18.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint `amount` (in 6-decimal base units) to `to`. Unrestricted for tests.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
