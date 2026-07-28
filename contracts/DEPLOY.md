# Deploying PoolPay to Arc Testnet

This guide walks through deploying the `PoolPay` contract to **Arc Testnet** using Foundry.

## Network details

| Field          | Value                                        |
| -------------- | -------------------------------------------- |
| Network        | Arc Testnet                                  |
| RPC URL        | `https://rpc.testnet.arc.io`                 |
| Chain ID       | `5042002`                                    |
| Block explorer | `https://testnet.arcscan.app`                |
| USDC address   | `0x3600000000000000000000000000000000000000` |

## Prerequisites

- [Foundry](https://book.getfoundry.sh/) installed (`forge --version`).
- An account funded with Arc Testnet gas, whose **private key** you control.

---

## Step 1 ,Export your private key

The private key is read from the `PRIVATE_KEY` environment variable and is never hardcoded
in any file. Export it in your shell:

```bash
export PRIVATE_KEY=your_private_key_here
```

> ⚠️ Do not commit your private key or paste it into any tracked file. `deploy.sh` reads it
> from the environment only, and it stays local to your shell session.

## Step 2 ,Verify the USDC address (preconfigured)

The deploy script is already set to the Arc Testnet USDC address
`0x3600000000000000000000000000000000000000`. You can confirm it in
`script/DeployPoolPay.s.sol`:

```solidity
address constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000; // Arc Testnet USDC
```

Only change this line if the USDC token address on Arc Testnet is different. The script
refuses to deploy if the address is ever left as the zero address.

## Step 3 ,Run the deployment

From the `contracts/` directory:

```bash
bash deploy.sh
```

This runs:

```bash
forge script script/DeployPoolPay.s.sol \
  --rpc-url https://rpc.testnet.arc.io \
  --broadcast \
  --private-key $PRIVATE_KEY
```

---

## After deploying

- The deployed contract address is printed in the console output:

  ```
  PoolPay deployed at: 0x...
  ```

- View it on the block explorer at `https://testnet.arcscan.app/address/<deployed-address>`.

- Foundry also writes a full deployment record (including the address and transaction hash)
  under `broadcast/DeployPoolPay.s.sol/5042002/run-latest.json`.

## Troubleshooting

- **`PRIVATE_KEY environment variable is not set`** ,run the `export` command from Step 1 in
  the same shell before `bash deploy.sh`.
- **`USDC_ADDRESS not set`** ,the USDC constant in `script/DeployPoolPay.s.sol` was left as the
  zero address; set it back to `0x3600000000000000000000000000000000000000`.
- **Connection / RPC errors** ,confirm `https://rpc.testnet.arc.io` is reachable and that
  your account has Arc Testnet gas.
```
