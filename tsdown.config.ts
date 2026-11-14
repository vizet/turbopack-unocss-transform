import {defineConfig} from "tsdown"

export default defineConfig([
  {
    entry: ["src/index.ts", "src/postcss.ts"],
    format: ["esm", "cjs"],
    dts: true,
    shims: true
  },
  {
    entry: ["src/loader.ts", "src/plugin.ts"],
    format: "esm",
    dts: false,
    clean: false
  }
])
