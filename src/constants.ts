import path from "node:path";

export const CHANNEL_NAME = "wechat";
export const CHANNEL_VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const BOT_TYPE = "3";

export const CREDENTIALS_DIR = path.join(
  process.env.HOME || "~",
  ".claude",
  "channels",
  "wechat",
);
export const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "account.json");
export const SYNC_BUF_FILE = path.join(CREDENTIALS_DIR, "sync_buf.txt");

export const LONG_POLL_TIMEOUT_MS = 35_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const BACKOFF_DELAY_MS = 30_000;
export const RETRY_DELAY_MS = 2_000;
export const QR_LOGIN_TIMEOUT_MS = 480_000;
export const QR_POLL_TIMEOUT_MS = 35_000;
export const SEND_TIMEOUT_MS = 15_000;

export const MSG_TYPE_USER = 1;
export const MSG_ITEM_TEXT = 1;
export const MSG_ITEM_VOICE = 3;
export const MSG_TYPE_BOT = 2;
export const MSG_STATE_FINISH = 2;
