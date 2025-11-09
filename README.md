# turbopack-unocss-transform
A Turbopack loader for Next.js that applies UnoCSS transformers (like variant-group and attributify-jsx) directly to your TS/JS/TSX/JSX source before CSS generation. Actual CSS is produced by @unocss/postcss; this loader only transforms source code.

**Usage**

`next.config.ts`
```typescript
import type {NextConfig} from "next"
import withUnoTransform from "turbopack-unocss-transform"

const nextConfig: NextConfig = withUnoTransform({
  // your Next.js config
})

export default nextConfig
```

`postcss.config.mjs`
```js
import unoConfig from "./src/styles/uno.config"

export default {
  plugins: [
    ["@unocss/postcss", {
      configOrPath: unoConfig
    }],
    "autoprefixer"
  ]
}
```
