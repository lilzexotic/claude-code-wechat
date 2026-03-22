/**
 * CLI for @paean-ai/claude-code-wechat
 *
 * Commands:
 *   setup   - Authenticate with WeChat via QR code and register the MCP server
 *   start   - Launch Claude Code with the WeChat channel (default command)
 *   status  - Show current login and configuration status
 *   logout  - Remove saved credentials and MCP registration
 */

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

import { CHANNEL_VERSION, CREDENTIALS_FILE, DEFAULT_BASE_URL, QR_LOGIN_TIMEOUT_MS } from "./constants.js";
import { loadCredentials, saveCredentials, removeCredentials } from "./credentials.js";
import { fetchQRCode, pollQRStatus } from "./api.js";
import type { AccountData } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getServerBinPath(): string {
  return path.resolve(__dirname, "channel.js");
}

function claudeAvailable(): boolean {
  try {
    execSync("claude --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isMcpServerRegistered(): boolean {
  try {
    const output = execSync("claude mcp get wechat", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.includes("wechat");
  } catch {
    return false;
  }
}

function registerMcpServer(): void {
  const serverPath = getServerBinPath();
  try {
    execSync("claude mcp remove wechat --scope user", {
      stdio: "ignore",
    });
  } catch {
    // may not exist yet
  }
  execFileSync("claude", [
    "mcp", "add", "--scope", "user", "wechat", "--", "node", serverPath,
  ], { stdio: "inherit" });
}

function unregisterMcpServer(): void {
  try {
    execSync("claude mcp remove wechat --scope user", { stdio: "inherit" });
  } catch {
    // may not exist
  }
}

// ── QR Login Flow ────────────────────────────────────────────────────────────

async function doInteractiveQRLogin(): Promise<AccountData | null> {
  console.log("Fetching WeChat login QR code...\n");
  const qrResp = await fetchQRCode(DEFAULT_BASE_URL);

  try {
    const qrterm = await import("qrcode-terminal");
    await new Promise<void>((resolve) => {
      qrterm.default.generate(
        qrResp.qrcode_img_content,
        { small: true },
        (qr: string) => {
          console.log(qr);
          resolve();
        },
      );
    });
  } catch {
    console.log(`Open this URL to scan: ${qrResp.qrcode_img_content}\n`);
  }

  console.log("Scan the QR code above with WeChat...\n");

  const deadline = Date.now() + QR_LOGIN_TIMEOUT_MS;
  let scannedPrinted = false;

  while (Date.now() < deadline) {
    const status = await pollQRStatus(DEFAULT_BASE_URL, qrResp.qrcode);

    switch (status.status) {
      case "wait":
        process.stdout.write(".");
        break;
      case "scaned":
        if (!scannedPrinted) {
          console.log("\nScanned! Please confirm on your phone...");
          scannedPrinted = true;
        }
        break;
      case "expired":
        console.error("\nQR code expired. Please run setup again.");
        return null;
      case "confirmed": {
        if (!status.ilink_bot_id || !status.bot_token) {
          console.error("\nLogin failed: server did not return complete info.");
          return null;
        }
        const account: AccountData = {
          token: status.bot_token,
          baseUrl: status.baseurl || DEFAULT_BASE_URL,
          accountId: status.ilink_bot_id,
          userId: status.ilink_user_id,
          savedAt: new Date().toISOString(),
        };
        saveCredentials(account);
        return account;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.error("\nLogin timed out. Please try again.");
  return null;
}

// ── Commands ────────────────────────────────────────────────────────────────

async function setupCommand(opts: { force?: boolean }): Promise<void> {
  if (!claudeAvailable()) {
    console.error("Error: Claude Code CLI not found. Please install it first:");
    console.error("  https://docs.anthropic.com/en/docs/claude-code");
    process.exit(1);
  }

  const existing = loadCredentials();
  if (existing && !opts.force) {
    console.log(`Existing account found: ${existing.accountId}`);
    console.log(`Saved at: ${existing.savedAt}`);
    console.log();

    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question("Re-authenticate? (y/N) ", resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== "y") {
      console.log("Keeping existing credentials.");
      if (!isMcpServerRegistered()) {
        console.log("\nRegistering MCP server...");
        registerMcpServer();
        console.log("MCP server registered.");
      }
      return;
    }
  }

  const account = await doInteractiveQRLogin();
  if (!account) {
    process.exit(1);
  }

  console.log(`\nWeChat connected successfully!`);
  console.log(`  Account ID: ${account.accountId}`);
  console.log(`  User ID:    ${account.userId ?? "N/A"}`);
  console.log(`  Saved to:   ${CREDENTIALS_FILE}`);
  console.log();

  console.log("Registering MCP server with Claude Code...");
  registerMcpServer();
  console.log("Done!\n");
  console.log("You can now start Claude Code with the WeChat channel:");
  console.log("  claude-wechat start");
}

function startCommand(): void {
  if (!claudeAvailable()) {
    console.error("Error: Claude Code CLI not found. Please install it first:");
    console.error("  https://docs.anthropic.com/en/docs/claude-code");
    process.exit(1);
  }

  const account = loadCredentials();
  if (!account) {
    console.error("No WeChat credentials found. Run setup first:");
    console.error("  claude-wechat setup");
    process.exit(1);
  }

  if (!isMcpServerRegistered()) {
    console.log("MCP server not registered. Registering...");
    registerMcpServer();
    console.log("Registered.\n");
  }

  console.log("Starting Claude Code with WeChat channel...\n");
  try {
    execFileSync("claude", [
      "--dangerously-load-development-channels", "server:wechat",
    ], { stdio: "inherit" });
  } catch (err: unknown) {
    const code = (err as { status?: number }).status;
    process.exit(code ?? 1);
  }
}

function statusCommand(): void {
  console.log("Claude Code WeChat Channel Status\n");

  const account = loadCredentials();
  if (account) {
    console.log(`  Logged in:    Yes`);
    console.log(`  Account ID:   ${account.accountId}`);
    console.log(`  User ID:      ${account.userId ?? "N/A"}`);
    console.log(`  Saved at:     ${account.savedAt}`);
    console.log(`  Credentials:  ${CREDENTIALS_FILE}`);
  } else {
    console.log(`  Logged in:    No`);
  }

  console.log();

  if (claudeAvailable()) {
    console.log(`  Claude Code:  Installed`);
    const registered = isMcpServerRegistered();
    console.log(`  MCP server:   ${registered ? "Registered" : "Not registered"}`);
  } else {
    console.log(`  Claude Code:  Not found`);
  }
}

function logoutCommand(): void {
  const account = loadCredentials();
  if (!account) {
    console.log("No credentials found. Already logged out.");
    return;
  }

  removeCredentials();
  console.log("Credentials removed.");

  if (claudeAvailable()) {
    unregisterMcpServer();
    console.log("MCP server unregistered.");
  }

  console.log("Logged out successfully.");
}

// ── CLI Entry ────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("claude-wechat")
  .description("WeChat channel plugin for Claude Code")
  .version(CHANNEL_VERSION);

program
  .command("setup")
  .description("Authenticate with WeChat via QR code and register the MCP server")
  .option("-f, --force", "Skip confirmation prompt for re-authentication")
  .action(setupCommand);

program
  .command("start", { isDefault: true })
  .description("Launch Claude Code with the WeChat channel")
  .action(startCommand);

program
  .command("status")
  .description("Show current login and configuration status")
  .action(statusCommand);

program
  .command("logout")
  .description("Remove saved credentials and MCP registration")
  .action(logoutCommand);

program.parse();
