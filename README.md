# PoolPay

A monorepo for **PoolPay** ,smart contracts and a web frontend targeting **Arc Network** (EVM-compatible).

> Scaffold only. No application/contract logic has been written yet ,this is the project skeleton with all tooling installed, compiling, and running.

## Structure

```
poolpay/
├── contracts/          # Solidity smart contracts (Foundry)
├── frontend/           # React + Vite + TypeScript frontend
└── README.md
```

## Contracts (`contracts/`)

Foundry project. Targets Arc Network (EVM-compatible), so standard EVM Solidity tooling applies.

- **Foundry** ,`forge` 1.7.1
- **forge-std** ,v1.16.2 (`lib/forge-std`)
- **OpenZeppelin Contracts** ,v5.6.1 (`lib/openzeppelin-contracts`)
- Remapping: `@openzeppelin/contracts/` → `lib/openzeppelin-contracts/contracts/` (auto-detected by Foundry)

### Commands

```bash
cd contracts
forge build      # compile
forge test       # run tests
forge fmt        # format
```

## Frontend (`frontend/`)

React + Vite + TypeScript app with the web3 wallet/connection stack.

- **Vite** 8 + **React** + **TypeScript**
- **wagmi** v2 ,React hooks for Ethereum
- **viem** v2 ,TypeScript Ethereum library
- **@rainbow-me/rainbowkit** v2 ,wallet connection UI
- **@tanstack/react-query** v5 ,async state (required peer of wagmi/RainbowKit)
- **Tailwind CSS** v4 ,via the `@tailwindcss/vite` plugin; entry import in `src/index.css`

> Note: wagmi is pinned to **v2** because the current RainbowKit (2.2.11) requires `wagmi@^2`. RainbowKit does not yet support wagmi v3.

### Commands

```bash
cd frontend
npm run dev      # start dev server (http://localhost:5173)
npm run build    # type-check + production build
npm run preview  # preview the production build
npm run lint     # lint
```

## Prerequisites

- [Foundry](https://book.getfoundry.sh/) (`forge`)
- Node.js 22+ and npm
