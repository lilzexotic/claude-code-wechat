const PREFIX = "[claude-wechat]";

export function log(msg: string): void {
  process.stderr.write(`${PREFIX} ${msg}\n`);
}

export function logError(msg: string): void {
  process.stderr.write(`${PREFIX} ERROR: ${msg}\n`);
}
