import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      cli: "src/cli.ts",
      channel: "src/channel.ts",
    },
    format: "esm",
    target: "node18",
    platform: "node",
    splitting: false,
    clean: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: {
      index: "src/index.ts",
    },
    format: "esm",
    target: "node18",
    platform: "node",
    dts: true,
  },
]);
