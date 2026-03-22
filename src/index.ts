export type {
  AccountData,
  QRCodeResponse,
  QRStatusResponse,
  WeixinMessage,
  GetUpdatesResp,
} from "./types.js";

export {
  loadCredentials,
  saveCredentials,
  removeCredentials,
} from "./credentials.js";

export {
  fetchQRCode,
  pollQRStatus,
  getUpdates,
  sendTextMessage,
  extractTextFromMessage,
} from "./api.js";

export {
  CHANNEL_NAME,
  CHANNEL_VERSION,
  DEFAULT_BASE_URL,
  CREDENTIALS_DIR,
  CREDENTIALS_FILE,
} from "./constants.js";
