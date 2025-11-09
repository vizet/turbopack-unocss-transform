import path from "node:path"

export default function withUnoTransform(userConfig = {}) {
  const loaderPath = path.resolve(process.cwd(), "node_modules/turbopack-unocss-transform/dist/loader.mjs")
  const base = {
    turbopack: {
      rules: {
        "**/*.{ts,tsx,js,jsx}": {
          loaders: [loaderPath]
        }
      }
    }
  }

  return merge(base, userConfig)
}

function merge(a, b) {
  if (!b) return a

  const out = JSON.parse(JSON.stringify(a))

  mergeInto(out, b)

  return out
}

function mergeInto(t, s) {
  for (const k of Object.keys(s)) {
    const sv = s[k], tv = t[k]

    if (Array.isArray(sv)) {
      t[k] = Array.isArray(tv) ? [...tv, ...sv] : [...sv]
    }

    else if (sv && typeof sv === "object") {
      if (!tv || typeof tv !== "object") t[k] = {}

      mergeInto(t[k], sv)
    } else {
      t[k] = sv
    }
  }
}
