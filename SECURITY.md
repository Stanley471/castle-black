# Security Policy

## Supported Versions

Castle Black is currently in early active development (v0.x). We only provide security updates for the latest branch (`main`). Older releases or forks are not officially supported for security updates. 

| Version | Supported          |
| ------- | ------------------ |
| Main    | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a vulnerability, **do not open a public issue or pull request**. 

Please use [GitHub's Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) feature on this repository if it is enabled. If it is not enabled, please reach out to the maintainers privately (e.g., via the provided contact email on the repository owner's profile).

**WARNING: NEVER disclose seed phrases, private keys, or any sensitive deployment secrets in any issue, pull request, or public discussion.**

### What to Report
We especially appreciate reports regarding:
- **Game Authorization:** Bypassing player identity checks or manipulating opponents' game states.
- **Room Handling:** Unauthorized access to private Socket.IO rooms or causing denial-of-service in the matchmaking system.
- **Escrow Settlement:** Vulnerabilities in the backend authoritative resolver or the Soroban contract that could lead to unauthorized payouts or locked funds.
- **Contract Access Controls:** Missing or incorrect `require_auth()` checks in the Rust smart contract.

## Expectations
As a small open-source project, we review reports on a best-effort basis. We make no guarantees about response times, bug bounties, or immediate resolutions, but we take security seriously and will coordinate with you to publish a fix and an advisory when appropriate.
