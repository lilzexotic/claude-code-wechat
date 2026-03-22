/**
 * WeChat Channel MCP Server for Claude Code
 *
 * Bridges WeChat messages into a Claude Code session via the Channels MCP protocol.
 * Uses the WeChat ClawBot ilink API.
 *
 * Flow:
 *   1. Load saved credentials (run `claude-wechat setup` first)
 *   2. Long-poll ilink/bot/getupdates for incoming WeChat messages
 *   3. Forward messages to Claude Code as channel notifications
 *   4. Expose a wechat_reply tool so Claude can send messages back
 */

import fs from "node:fs";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  CHANNEL_NAME,
  CHANNEL_VERSION,
  DEFAULT_BASE_URL,
  MAX_CONSECUTIVE_FAILURES,
  BACKOFF_DELAY_MS,
  RETRY_DELAY_MS,
  MSG_TYPE_USER,
} from "./constants.js";
import { loadCredentials, saveCredentials, loadSyncBuf, saveSyncBuf } from "./credentials.js";
import {
  fetchQRCode,
  pollQRStatus,
  getUpdates,
  sendTextMessage,
  extractTextFromMessage,
} from "./api.js";
import { log, logError } from "./logger.js";
import type { AccountData } from "./types.js";

// ── Context Token Cache ──────────────────────────────────────────────────────

const contextTokenCache = new Map<string, string>();

// ── QR Login (fallback when no credentials exist) ────────────────────────────

async function doQRLogin(baseUrl: string): Promise<AccountData | null> {
  log("Fetching WeChat login QR code...");
  const qrResp = await fetchQRCode(baseUrl);

  log("\nScan the QR code below with WeChat:\n");
  try {
    const qrterm = await import("qrcode-terminal");
    await new Promise<void>((resolve) => {
      qrterm.default.generate(
        qrResp.qrcode_img_content,
        { small: true },
        (qr: string) => {
          process.stderr.write(qr + "\n");
          resolve();
        },
      );
    });
  } catch {
    log(`QR code URL: ${qrResp.qrcode_img_content}`);
  }

  log("Waiting for scan...");
  const deadline = Date.now() + 480_000;
  let scannedLogged = false;

  while (Date.now() < deadline) {
    const status = await pollQRStatus(baseUrl, qrResp.qrcode);

    switch (status.status) {
      case "wait":
        break;
      case "scaned":
        if (!scannedLogged) {
          log("Scanned! Please confirm on your phone...");
          scannedLogged = true;
        }
        break;
      case "expired":
        log("QR code expired. Please restart.");
        return null;
      case "confirmed": {
        if (!status.ilink_bot_id || !status.bot_token) {
          logError("Login confirmed but server did not return bot info");
          return null;
        }
        const account: AccountData = {
          token: status.bot_token,
          baseUrl: status.baseurl || baseUrl,
          accountId: status.ilink_bot_id,
          userId: status.ilink_user_id,
          savedAt: new Date().toISOString(),
        };
        saveCredentials(account);
        log("WeChat connected successfully!");
        return account;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  log("Login timed out");
  return null;
}

// ── MCP Channel Server ──────────────────────────────────────────────────────

const mcp = new Server(
  { name: CHANNEL_NAME, version: CHANNEL_VERSION },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: [
      `Messages from WeChat users arrive as <channel source="wechat" sender="..." sender_id="...">`,
      "Reply using the wechat_reply tool. You MUST pass the sender_id from the inbound tag.",
      "Messages are from real WeChat users via the WeChat ClawBot interface.",
      "Respond naturally in Chinese unless the user writes in another language.",
      "Keep replies concise — WeChat is a chat app, not an essay platform.",
      "Strip markdown formatting (WeChat doesn't render it). Use plain text.",
    ].join("\n"),
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "wechat_reply",
      description: "Send a text reply back to the WeChat user",
      inputSchema: {
        type: "object" as const,
        properties: {
          sender_id: {
            type: "string",
            description:
              "The sender_id from the inbound <channel> tag (xxx@im.wechat format)",
          },
          text: {
            type: "string",
            description: "The plain-text message to send (no markdown)",
          },
        },
        required: ["sender_id", "text"],
      },
    },
  ],
}));

let activeAccount: AccountData | null = null;

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "wechat_reply") {
    const { sender_id, text } = req.params.arguments as {
      sender_id: string;
      text: string;
    };
    if (!activeAccount) {
      return {
        content: [{ type: "text" as const, text: "error: not logged in" }],
      };
    }
    const contextToken = contextTokenCache.get(sender_id);
    if (!contextToken) {
      return {
        content: [
          {
            type: "text" as const,
            text: `error: no context_token for ${sender_id}. The user may need to send a message first.`,
          },
        ],
      };
    }
    try {
      await sendTextMessage(
        activeAccount.baseUrl,
        activeAccount.token,
        sender_id,
        text,
        contextToken,
      );
      return { content: [{ type: "text" as const, text: "sent" }] };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `send failed: ${String(err)}` },
        ],
      };
    }
  }
  throw new Error(`unknown tool: ${req.params.name}`);
});

// ── Long-poll Loop ──────────────────────────────────────────────────────────

async function startPolling(account: AccountData): Promise<never> {
  const { baseUrl, token } = account;
  let getUpdatesBuf = loadSyncBuf();
  let consecutiveFailures = 0;

  if (getUpdatesBuf) {
    log(`Restored sync state (${getUpdatesBuf.length} bytes)`);
  }

  log("Listening for WeChat messages...");

  while (true) {
    try {
      const resp = await getUpdates(baseUrl, token, getUpdatesBuf);

      const isError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);
      if (isError) {
        consecutiveFailures++;
        logError(
          `getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""}`,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logError(
            `${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off ${BACKOFF_DELAY_MS / 1000}s`,
          );
          consecutiveFailures = 0;
          await new Promise((r) => setTimeout(r, BACKOFF_DELAY_MS));
        } else {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf) {
        getUpdatesBuf = resp.get_updates_buf;
        saveSyncBuf(getUpdatesBuf);
      }

      for (const msg of resp.msgs ?? []) {
        if (msg.message_type !== MSG_TYPE_USER) continue;

        const text = extractTextFromMessage(msg);
        if (!text) continue;

        const senderId = msg.from_user_id ?? "unknown";

        if (msg.context_token) {
          contextTokenCache.set(senderId, msg.context_token);
        }

        log(`Message received: from=${senderId} text=${text.slice(0, 50)}...`);

        await mcp.notification({
          method: "notifications/claude/channel",
          params: {
            content: text,
            meta: {
              sender: senderId.split("@")[0] || senderId,
              sender_id: senderId,
            },
          },
        });
      }
    } catch (err) {
      consecutiveFailures++;
      logError(`Poll error: ${String(err)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        await new Promise((r) => setTimeout(r, BACKOFF_DELAY_MS));
      } else {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await mcp.connect(new StdioServerTransport());
  log("MCP connection ready");

  let account = loadCredentials();

  if (!account) {
    log("No saved credentials found, starting QR login...");
    account = await doQRLogin(DEFAULT_BASE_URL);
    if (!account) {
      logError("Login failed, exiting.");
      process.exit(1);
    }
  } else {
    log(`Using saved account: ${account.accountId}`);
  }

  activeAccount = account;
  await startPolling(account);
}

main().catch((err) => {
  logError(`Fatal: ${String(err)}`);
  process.exit(1);
});
