# turbopack-unocss-transform

UnoCSS transformers for Next.js. Variant groups, attributify JSX and compile class work with Turbopack and with webpack.

`@unocss/postcss` alone generates CSS from your source files as they are on disk. It never runs transformers, so `hover:(bg-red-500 text-white)` is neither rewritten in the bundle nor present in the CSS. This package runs the transformers from your `uno.config.ts` in both places:

- a loader rewrites your source modules while Next.js compiles them;
- a PostCSS plugin extracts classes from the same transformed code, then hands `@apply`, `@screen` and `theme()` to `@unocss/postcss`.

## Requirements

| Dependency | Version |
| --- | --- |
| Next.js | ≥16.0.0 |
| UnoCSS (`unocss`, `@unocss/postcss`) | ≥66.5.0 |
| Node.js | ^20.19.0 or ≥22.12.0 |

## Install

```bash
pnpm add -D unocss @unocss/postcss turbopack-unocss-transform
```

Keep `unocss` and `@unocss/postcss` on the same version. The package takes `@unocss/core` and `@unocss/config` from your `@unocss/postcss` installation, so it always runs the UnoCSS version you installed.

## Setup

```ts
// next.config.ts
import type {NextConfig} from "next"
import withUnoCSS from "turbopack-unocss-transform"

const nextConfig: NextConfig = {}

export default withUnoCSS(nextConfig)
```

```js
// postcss.config.mjs
export default {
  plugins: ["turbopack-unocss-transform/postcss"]
}
```

```ts
// uno.config.ts
import {
  defineConfig,
  presetAttributify,
  presetWind4,
  transformerAttributifyJsx,
  transformerCompileClass,
  transformerVariantGroup
} from "unocss"

export default defineConfig({
  presets: [presetWind4(), presetAttributify()],
  transformers: [
    transformerAttributifyJsx(),
    transformerVariantGroup(),
    transformerCompileClass()
  ]
})
```

```css
/* app/globals.css */
@unocss all;
```

The config is a regular UnoCSS config, loaded by UnoCSS's own loader and never bundled by Turbopack. Imports from `unocss`, local imports with or without a file extension and JSON imports work, and `defineConfig` is optional.

`withUnoCSS` also accepts a function that returns the Next.js config.

## What you get

```tsx
<div className="hover:(bg-red-500 text-white)" />
// <div class="hover:bg-red-500 hover:text-white">

<div flex items-center />
// <div flex="" items-center="">

<div className=":uno: text-center sm:text-left p-3" />
// <div class="uno-lwhhx5">

<p>hover:(bg-red-500 text-white)</p>
// <p>hover:(bg-red-500 text-white)</p>
```

The CSS for every rewritten class is generated. JSX text is never rewritten. Sass, including the indented syntax, works because the PostCSS plugin runs after the preprocessor.

Changes are picked up without restarting `next dev`:

- a class added to or removed from a source file;
- a new or deleted source file;
- an edit to `uno.config.ts`;
- an edit to a file that the config imports with a relative path, at any depth.

A file the config reads in another way is watched when you list it in `configDeps`:

```ts
export default defineConfig({
  configDeps: ["./tokens.yaml"]
})
```

## Config file

`uno.config.*` and `unocss.config.*` in the project root are found automatically. For any other location, set `configFile` in `next.config`. The PostCSS plugin picks the same path up.

```ts
export default withUnoCSS(nextConfig, {
  configFile: "./config/uno.config.ts"
})
```

| Config | Works | Edits picked up without a restart |
| --- | --- | --- |
| `uno.config.ts`, `uno.config.mts`, `unocss.config.ts` | yes | yes |
| `uno.config.js` in a package without `"type": "module"` | yes | yes |
| `uno.config.mjs`, `uno.config.cjs`, `uno.config.js` with `"type": "module"` | yes | no |
| `configFile` with a relative or an absolute path, any file name | yes | yes |
| `configFile` outside the Next.js project directory | with `turbopack.root` set to a directory that contains it | not tested |

Limits that come from the UnoCSS config loader:

- Node.js caches `.mjs` and `.cjs` modules, so a config in one of those formats is read once per `next dev` run. Use `uno.config.ts` to have edits applied.
- Imports through `tsconfig.json` path aliases (`@/styles/theme`) are not resolved. Use relative imports in the config.

## Which files are transformed

The package follows the UnoCSS pipeline rules, the same ones the Vite plugin uses.

- By default only `.jsx` and `.tsx` modules are transformed. A plain `.ts` or `.js` module is transformed when it contains `// @unocss-include`, or when `content.pipeline.include` matches it:

  ```ts
  export default defineConfig({
    content: {
      pipeline: {
        include: [/\.[jt]sx?$/]
      }
    }
  })
  ```

- A file containing `@unocss-ignore` is left alone.
- Code between `@unocss-skip-start` and `@unocss-skip-end` comments is left alone:

  ```tsx
  {/* @unocss-skip-start */}
  <input placeholder="font-(light mono)" />
  {/* @unocss-skip-end */}
  ```

Transformers rewrite string literals and JSX attributes wherever they are, because a class list can live in any of them. JSX text is the exception: it is displayed, never used as a class list, so it stays as written. Use the skip comments for an attribute or a string constant that must stay as written.

`content.filesystem` decides which files are scanned for classes, as with `@unocss/postcss`. Its globs are relative to the project root.

## Migrating from 1.x

1. In `postcss.config.mjs`, replace the `@unocss/postcss` entry with `"turbopack-unocss-transform/postcss"` and remove the `import config from "./uno.config.ts"` line.
2. `next.config.ts` stays as it is.
3. Plain `.ts` and `.js` modules are no longer transformed by default. See "Which files are transformed".
4. `.ts` extensions in config imports, `allowImportingTsExtensions` and Node.js 23 are no longer required, and the config may import from `unocss`.
5. Next.js 15 is no longer supported.

## Known issues

- With `next build --webpack`, webpack prints a cache warning about a dynamic `import()` in this package. The build is not affected.

## Tested with

- Turbopack: Next.js 16.4.6 with UnoCSS 66.5.6, 66.12.0 and 66.13.0
- webpack: Next.js 16.4.6 with UnoCSS 66.13.0
- Node.js 26.4.0
