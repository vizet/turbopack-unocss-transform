# turbopack-unocss-transform

Turbopack loader for Next.js that applies UnoCSS transformers (`transformerAttributifyJsx`, `transformerVariantGroup`, `transformerDirectives`) to source files.

`@unocss/postcss` handles CSS generation; this loader transforms JS/TS/JSX/TSX source code.

## Requirements

| Dependency | Version                                                            |
| ---------- | ------------------------------------------------------------------ |
| Node.js    | **≥23.6.0** (native TypeScript support if you use `uno.config.ts`) |
| Next.js    | ≥15.0.0                                                            |
| UnoCSS     | ≥66.0.0                                                            |

## Installation

```bash
pnpm add -D turbopack-unocss-transform @unocss/postcss
```

## Setup

### 1. next.config.ts

```typescript
import type {NextConfig} from "next"
import withUnoTransform from "turbopack-unocss-transform"

const nextConfig: NextConfig = withUnoTransform({
  // your config
})

export default nextConfig
```

### 2. postcss.config.mjs

> [!IMPORTANT]
> **Import the config object, not a path string.** Passing a string or without the `configOrPath` setting disables HMR - Turbopack won't detect config changes.

```javascript
import config from "./uno.config.ts"

export default {
  plugins: [
    ["@unocss/postcss", {configOrPath: config}]
  ]
}
```

### 3. tsconfig.json

> [!IMPORTANT]
> **Required.** Node.js 23+ executes TypeScript natively but requires explicit `.ts` extensions in imports. This flag allows TypeScript to accept them.

```json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}
```

### 4. uno.config.ts

> [!WARNING]
> **All local imports must include `.ts` extension.** PostCSS runs via Node.js worker (not Turbopack), which requires explicit extensions for TypeScript files.

```typescript
import type {UserConfig} from "@unocss/core"
import {presetAttributify} from "@unocss/preset-attributify"
import {presetWind4} from "@unocss/preset-wind4"
import transformerAttributifyJsx from "@unocss/transformer-attributify-jsx"
import transformerDirectives from "@unocss/transformer-directives"
import transformerVariantGroup from "@unocss/transformer-variant-group"
import theme from "./src/styles/theme/index.ts"
import preflights from "./src/styles/theme/preflights.ts"

export default {
  presets: [presetWind4(), presetAttributify()],
  transformers: [
    transformerAttributifyJsx(),
    transformerDirectives(),
    transformerVariantGroup()
  ],
  theme,
  preflights
} satisfies UserConfig
```

> [!CAUTION]
> **Avoid importing from the `unocss` meta-package.** It re-exports all presets including `@unocss/preset-icons`, which depends on `mlly` that uses dynamic `import(dataURL)` - not supported by Turbopack.
>
> This will fail:
>
> ```typescript
> import {defineConfig, presetWind4} from "unocss" // ❌ Pulls in mlly
> ```
>
> Use separate packages instead:
>
> ```typescript
> import {presetWind4} from "@unocss/preset-wind4" // ✅
> ```
>
> You can try the meta-package - it might work in future versions, but this setup was tested with separate packages only.

### 5. Global styles (e.g., global.sass)

```sass
@unocss all

html, body
  @apply text-dark font-sans
```

## Why explicit `.ts` extensions?

PostCSS config is executed by a **Node.js worker**, not Turbopack. Node.js 23+ runs TypeScript natively but doesn't resolve `.ts` extensions automatically — they must be explicit.

Without explicit extensions:

```
Module not found: Can't resolve './src/styles/theme'
```

## HMR behavior

| postcss.config.mjs                     | HMR      |
| -------------------------------------- | -------- |
| `import config from "./uno.config.ts"` | ✅ Works  |
| `{configOrPath: "./uno.config.ts"}`    | ❌ No HMR |

When using path string, Turbopack doesn't track `uno.config.ts` as a dependency — changes require `next dev` restart.

## Tested with

- Next.js **16.1.3**
- UnoCSS **66.5.6**
- Node.js **23.11.0**
