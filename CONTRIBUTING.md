# Contributing to Castle Black

Thank you for your interest in contributing to Castle Black, our open-source online chess platform with optional Stellar/Soroban escrow.

## Prerequisites
- **Node.js**: v20 or later.
- **npm**: v10 or later.
- **Rust**: The stable Rust toolchain (required for compiling Soroban smart contracts).
- **Stellar CLI / Soroban**: Optional, for deploying contracts.

## Local Setup

### Web (Frontend)
The frontend is a Next.js application.
```bash
cd web
npm install
```

To run the development server:
```bash
npm run dev
```

### Server (Backend)
The backend is an Express & Socket.IO server.
```bash
cd server
npm install
```

To run the development server (with hot reload):
```bash
npm run dev
```

### Contracts (Soroban Smart Contracts)
Our smart contracts are written in Rust.
```bash
cd contracts
```

Ensure you have the target installed:
```bash
rustup target add wasm32-unknown-unknown
```

## Running Checks

### Web
- **Lint**: `npm run lint`
- **Build**: `npm run build`

### Server
- **Build (Type check)**: `npm run build`

### Contracts
- **Format check**: `cargo fmt -- --check`
- **Tests**: `cargo test`
- **Build**: `cargo build --target wasm32-unknown-unknown --release`

## Development Guidelines

### Normal Chess vs. Escrow Matches
**CRITICAL**: Normal chess matches must remain usable without connecting a wallet. Any changes to the UI or backend game logic must preserve the frictionless, wallet-free experience for standard games.

### Chess Logic and Socket.IO
- Ensure room management is robust. Handle player disconnections gracefully.
- Validate all moves authoritatively on the backend using `chess.js`. Do not trust frontend game state.

### Soroban Contract Changes
When modifying the Soroban escrow contract, ensure you have considered:
- Authorization requirements for all state-changing endpoints.
- Proper handling of invalid inputs and edge cases.
- Secure escrow settlement mechanisms to prevent unauthorized payouts.
- Appropriate refund logic for cancelled matches.

## Branch and Commit Recommendations
- Branch off of `main`.
- Use descriptive branch names (e.g., `fix/auth-bug`, `feat/new-piece-theme`).
- Write clear, concise commit messages.

## Pull Request Expectations
- Fill out the provided Pull Request template completely.
- Ensure all CI checks (linting, building, formatting, and tests) pass.
- Address any code review feedback promptly.
