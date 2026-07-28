// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PoolPay} from "../src/PoolPay.sol";
import {PoolPayView} from "../src/PoolPayView.sol";

/**
 * @title DeployPoolPay
 * @notice Foundry deployment script for the {PoolPay} contract on Arc Testnet.
 *
 * @dev The deployer's private key is supplied at run time via the
 *      `--private-key $PRIVATE_KEY` CLI flag (see `deploy.sh` / `DEPLOY.md`); it is
 *      never hardcoded in this file. Broadcasting uses that key through
 *      {vm.startBroadcast}.
 *
 *      Arc Testnet:
 *        - RPC URL : https://rpc.testnet.arc.io
 *        - Chain ID: 5042002
 */
contract DeployPoolPay is Script {
    /// @notice USDC token address on Arc Testnet, passed to the PoolPay constructor.
    address constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000; // Arc Testnet USDC

    PoolPay public poolPay;
    PoolPayView public poolPayView;

    function setUp() public {}

    function run() public {
        // Sanity check: never deploy with an unset (zero) USDC address.
        require(USDC_ADDRESS != address(0), "USDC_ADDRESS not set");

        vm.startBroadcast();

        poolPay = new PoolPay(USDC_ADDRESS);
        poolPayView = new PoolPayView(address(poolPay));

        vm.stopBroadcast();

        console.log("PoolPay deployed at:    ", address(poolPay));
        console.log("PoolPayView deployed at:", address(poolPayView));
        console.log("USDC address used:      ", USDC_ADDRESS);
        console.log("Chain ID:               ", block.chainid);
    }
}
