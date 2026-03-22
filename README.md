# @paean-ai/claude-code-wechat

Bridge WeChat messages into [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions.

This plugin connects WeChat (via the official ClawBot ilink API) to Claude Code's [Channels](https://docs.anthropic.com/en/docs/claude-code) MCP protocol, so you can chat with Claude Code directly from WeChat.

```
WeChat (iOS) --> ClawBot --> ilink API --> [this plugin] --> Claude Code
                                                   |
Claude Code <-- MCP Channel Protocol <-- wechat_reply tool
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18 (or [Bun](https://bun.sh) >= 1.0)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) >= 2.1.80
- A Claude.ai account (API key auth is not supported)
- WeChat iOS (latest version with ClawBot support)

## Installation

Install globally with your preferred package manager:

```bash
# npm
npm install -g @paean-ai/claude-code-wechat

# bun
bun add -g @paean-ai/claude-code-wechat

# pnpm
pnpm add -g @paean-ai/claude-code-wechat
```

## Quick Start

### 1. Setup (one-time)

Authenticate with WeChat and register the MCP server:

```bash
claude-wechat setup
```

This will:
- Display a QR code in your terminal
- Wait for you to scan it with WeChat
- Save credentials to `~/.claude/channels/wechat/account.json`
- Register the channel server with Claude Code

### 2. Start

Launch Claude Code with the WeChat channel:

```bash
claude-wechat
```

That's it! Open WeChat, find the ClawBot conversation, and start chatting. Messages will appear in your Claude Code terminal, and Claude's replies will be sent back to WeChat automatically.

## CLI Reference

| Command | Description |
|---|---|
| `claude-wechat setup` | Authenticate with WeChat via QR code and register the MCP server |
| `claude-wechat start` | Launch Claude Code with the WeChat channel (default command) |
| `claude-wechat status` | Show current login and configuration status |
| `claude-wechat logout` | Remove saved credentials and unregister MCP server |
| `claude-wechat --help` | Show help |
| `claude-wechat --version` | Show version |

### Options

`claude-wechat setup --force` — Skip the confirmation prompt when re-authenticating.

## How It Works

1. **Authentication**: The `setup` command uses WeChat's ClawBot QR code login flow (`ilink/bot/get_bot_qrcode` + `get_qrcode_status`) to obtain a bearer token.

2. **Message Receiving**: The channel server long-polls `ilink/bot/getupdates` for incoming WeChat messages and forwards them to Claude Code as MCP channel notifications.

3. **Message Sending**: Claude Code uses the `wechat_reply` tool (exposed via MCP) to send replies back through `ilink/bot/sendmessage`.

4. **MCP Integration**: The server implements Claude Code's experimental Channels protocol, registering as a `wechat` channel with tool capabilities.

## Configuration

Credentials are stored at:

```
~/.claude/channels/wechat/account.json
```

The file has `0600` permissions (owner-readable only). No credentials are stored in the package itself.

## Programmatic Usage

The package also exports its core API for advanced use cases:

```typescript
import {
  loadCredentials,
  fetchQRCode,
  pollQRStatus,
  sendTextMessage,
} from "@paean-ai/claude-code-wechat";
```

## Notes

- This is a **research preview** feature. The `--dangerously-load-development-channels` flag is required by Claude Code for channel plugins.
- The Claude Code session and WeChat channel share the same lifecycle — closing Claude Code disconnects the channel.
- WeChat ClawBot currently supports iOS only.
- Each ClawBot instance can connect to one agent at a time.

## Troubleshooting

**"Claude Code CLI not found"** — Make sure `claude` is installed and available in your PATH. See [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code).

**QR code expired** — The QR code is valid for ~8 minutes. Run `claude-wechat setup` again to get a fresh one.

**Messages not arriving** — Check `claude-wechat status` to verify credentials and MCP registration. Try `claude-wechat logout` followed by `claude-wechat setup` to re-authenticate.

## License

[MIT](LICENSE)

## Disclaimer

"Claude" and "Claude Code" are trademarks of Anthropic, PBC. "WeChat" (微信) is a trademark of Tencent Holdings Limited. This project is not affiliated with, endorsed by, or sponsored by Anthropic or Tencent. It is an independent open-source community project.
