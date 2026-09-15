# Castle Black — Soroban Escrow Smart Contract

Minimal, production-grade 2-player escrow smart contract implemented in Rust for the Stellar network using Soroban SDK.

## Product Philosophy
> "Chess first. Blockchain where it actually adds value."

Casual chess matches on Castle Black require zero blockchain interactions. When players toggle **Stellar Escrow**, this smart contract locks equal stakes from both players and securely releases the total pot upon authoritative arbiter checkmate/timeout verification.

---

## Contract Roles & State Machine

- **`player_w`**: White player address (creator).
- **`player_b`**: Black player address (opponent).
- **`arbiter`**: Trusted backend game server public key authorized to verify chess checkmate/timeout conditions and release the pot.

### State Transitions
```
[WaitingForOpponent] ──(opponent joins)──> [Active] ──(arbiter resolves)──> [Resolved]
         │
(creator cancels)
         ▼
    [Cancelled]
```

---

## Contract Interface

### 1. `create_game`
```rust
pub fn create_game(
    env: Env,
    game_id: Symbol,
    creator: Address,
    arbiter: Address,
    token: Address,
    stake_amount: i128,
) -> Result<(), EscrowError>
```
- Deducts `stake_amount` from `creator` and locks it into the contract.
- Sets game state to `WaitingForOpponent`.

### 2. `join_game`
```rust
pub fn join_game(
    env: Env,
    game_id: Symbol,
    opponent: Address,
) -> Result<(), EscrowError>
```
- Deducts matching `stake_amount` from `opponent`.
- Transitions state to `Active`.

### 3. `resolve_game`
```rust
pub fn resolve_game(
    env: Env,
    game_id: Symbol,
    winner: Address,
) -> Result<(), EscrowError>
```
- Requires authorization from `arbiter` (`arbiter.require_auth()`).
- Verifies that `winner` is either `player_w` or `player_b`.
- Transfers the total pot (`stake_amount * 2`) to the winner.
- Transitions state to `Resolved`.

### 4. `cancel_game`
```rust
pub fn cancel_game(
    env: Env,
    game_id: Symbol,
) -> Result<(), EscrowError>
```
- Permitted only while state is `WaitingForOpponent`.
- Requires `creator.require_auth()`.
- Refunds `stake_amount` in full to `creator`.
- Transitions state to `Cancelled`.

### 5. `get_game`
```rust
pub fn get_game(env: Env, game_id: Symbol) -> Result<Game, EscrowError>
```
- Returns the current `Game` data struct.

---

## Build & Test

### Run Unit Tests
```bash
cargo test
```

### Compile to Wasm
```bash
# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Build release wasm
cargo build --target wasm32-unknown-unknown --release
```
The compiled output is generated at:
`target/wasm32-unknown-unknown/release/castle_black_escrow.wasm`

---

## Stellar Testnet Deployment Guide

### Prerequisites
Install the official Stellar CLI:
```bash
cargo install --locked stellar-cli --features opt
```

### Step 1: Configure Testnet Identity
```bash
# Generate an arbiter deployer identity
stellar keys generate arbiter --network testnet

# Fund the deployer account via Friendbot
stellar keys fund arbiter --network testnet
```

### Step 2: Build and Optimize the Contract
```bash
stellar contract build
```

### Step 3: Deploy to Stellar Testnet
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/castle_black_escrow.wasm \
  --source arbiter \
  --network testnet
```
*Sample Output:*
```
CA7Q6...EXAMPLE_CONTRACT_ID...5T2K
```

Save this Contract ID and add it to your `/server/.env`:
```env
ESCROW_CONTRACT_ID=CA7Q6...EXAMPLE_CONTRACT_ID...5T2K
```

---

## Invocation Examples (Stellar CLI)

### Create a Game
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <PLAYER_W_IDENTITY> \
  --network testnet \
  -- \
  create_game \
  --game_id "GAME01" \
  --creator <PLAYER_W_ADDRESS> \
  --arbiter <ARBITER_ADDRESS> \
  --token <XLM_SAC_TOKEN_ADDRESS> \
  --stake_amount 100000000
```

### Join a Game
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <PLAYER_B_IDENTITY> \
  --network testnet \
  -- \
  join_game \
  --game_id "GAME01" \
  --opponent <PLAYER_B_ADDRESS>
```

### Authoritative Resolution (Arbiter Payout)
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source arbiter \
  --network testnet \
  -- \
  resolve_game \
  --game_id "GAME01" \
  --winner <WINNER_ADDRESS>
```
