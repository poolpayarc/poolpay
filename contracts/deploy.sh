#!/usr/bin/env bash
#
# Deploy the PoolPay contract to Arc Testnet.
#
# The deployer's private key is read from the PRIVATE_KEY environment variable so it is
# never hardcoded in any file. Export it before running this script:
#
#   export PRIVATE_KEY=your_private_key_here
#   bash deploy.sh
#
set -euo pipefail

ARC_TESTNET_RPC_URL="https://rpc.testnet.arc.io"

if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "Error: PRIVATE_KEY environment variable is not set." >&2
  echo "Export it first, e.g.:  export PRIVATE_KEY=your_private_key_here" >&2
  exit 1
fi

forge script script/DeployPoolPay.s.sol \
  --rpc-url "$ARC_TESTNET_RPC_URL" \
  --broadcast \
  --private-key "$PRIVATE_KEY"
