# turbopack-unocss-transform

A Turbopack loader for Next.js that applies UnoCSS transformers (like variant-group and attributify-jsx) directly to your TS/JS/TSX/JSX source before CSS generation.

Actual CSS is produced by `@unocss/postcss`; this loader only transforms source code.

## Installation

```bash
pnpm add -D turbopack-unocss-transform
```

## Usage

### next.config.ts

```typescript
import type {NextConfig} from "next"
import withUnoTransform from "turbopack-unocss-transform"

const nextConfig: NextConfig = withUnoTransform({
  // your Next.js config
})

export default nextConfig
```

### postcss.config.mjs

**Option 1: Import config object**

```js
import unoConfig from "./uno.config"

export default {
  plugins: [
    ["@unocss/postcss", {configOrPath: unoConfig}],
    "autoprefixer"
  ]
}
```

**Option 2: Pass config path as string**

```js
export default {
  plugins: [
    ["@unocss/postcss", {configOrPath: "./uno.config.ts"}],
    "autoprefixer"
  ]
}
```

## Requirements

- Next.js 15+ with Turbopack
- UnoCSS 0.58+
