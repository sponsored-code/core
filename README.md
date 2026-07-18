<p align="center">
  <a href="https://sponsoredcode.com"><img src="https://sponsoredcode.com/mascot/core.webp" alt="Sponsored Code — shared core" width="300" /></a>
</p>

# [<img src="https://sponsoredcode.com/sponsored-code-mark.svg" alt="Sponsored Code" />](https://sponsoredcode.com)

[![npm](https://img.shields.io/npm/v/@sponsored-code/core?color=cb3837&logo=npm)](https://www.npmjs.com/package/@sponsored-code/core)
[![license](https://img.shields.io/badge/license-source--available-blue)](./LICENSE)
[![sponsoredcode.com](https://img.shields.io/badge/web-sponsoredcode.com-111)](https://sponsoredcode.com)

## Shared core

The shared building blocks for [Sponsored Code](https://sponsoredcode.com) clients — the account,
wallet, Claude Code integration, and typed API client. Published for transparency; if you just want
to earn, use the [`sponsored-code` CLI](https://www.npmjs.com/package/sponsored-code).

```bash
npm install @sponsored-code/core
```

## What's inside

| Area | What it provides |
|---|---|
| **Account & credentials** | A local credential store. Your payout wallet never lands on disk — only an opaque account token, encrypted at rest under a per-install key. |
| **Claude Code settings** | Reversibly wires the status-line ad into Claude Code's supported settings, and removes it cleanly. |
| **Status-line renderer** | Renders the small, clearly-labeled status-line ad row that Claude Code displays, including the running earned badge. |
| **Wallet & sign-in** | EVM address helpers, message signing, and the browser-based wallet sign-in flow. |
| **API client** | A typed client for the Sponsored Code API — register, request an ad, report a view, read earnings, and sign in. |
| **Integrity** | Tamper-flagging for its own managed local state, so an out-of-band edit is detected. |

## License

Source-available — see [LICENSE](./LICENSE).
