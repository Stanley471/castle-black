#!/usr/bin/env bash
set -euo pipefail

echo "============================================="
echo "Building Castle Black Soroban Escrow Contract"
echo "============================================="

# Ensure wasm target is available
rustup target add wasm32-unknown-unknown 2>/dev/null || true

# Build release wasm
cargo build --target wasm32-unknown-unknown --release

WASM_OUTPUT="target/wasm32-unknown-unknown/release/castle_black_escrow.wasm"

if [ -f "$WASM_OUTPUT" ]; then
  echo "Build successful: $WASM_OUTPUT"
  ls -lh "$WASM_OUTPUT"
else
  echo "Build completed."
fi
