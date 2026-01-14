import fs from "node:fs"
import {createRequire} from "node:module"
import path from "node:path"
import {createGenerator} from "@unocss/core"
import MagicString from "magic-string"

const PREFIX = "[UnoCSS-Turbopack]"
const nodeRequire = createRequire(import.meta.url)

const DEFAULT_CONFIG_PATHS = [
  "uno.config.ts",
  "uno.config.js",
  "uno.config.mjs",
  "unocss.config.ts",
  "unocss.config.js",
  "unocss.config.mjs"
]

let uno = null
let unoInitPromise = null
let cfg = null
let cfgLoaded = false
let cfgPath = null
let cfgMtime = 0

function createJiti() {
  try {
    return nodeRequire("jiti")(import.meta.url, {
      interopDefault: true,
      esmResolve: true
    })
  } catch (error) {
    throw new Error(
      `${PREFIX} Failed to initialize jiti: ${error?.message || error}`
    )
  }
}

function resolveConfigPath(configPath) {
  if (path.isAbsolute(configPath)) {
    return configPath
  }

  return path.resolve(process.cwd(), configPath)
}

function loadConfigFromPath(configPath) {
  const jiti = createJiti()
  const resolved = resolveConfigPath(configPath)

  try {
    const mod = jiti(resolved)

    return mod?.default ?? mod
  } catch (error) {
    throw new Error(
      `${PREFIX} Failed to load config from "${resolved}": ${error?.message || error}`
    )
  }
}

function findDefaultConfigPath() {
  for (const p of DEFAULT_CONFIG_PATHS) {
    const fullPath = path.join(process.cwd(), p)

    if (fs.existsSync(fullPath)) {
      return fullPath
    }
  }

  return null
}

function loadPostcssConfig() {
  const jiti = createJiti()
  const possiblePaths = [
    "postcss.config.mjs",
    "postcss.config.js",
    "postcss.config.cjs"
  ]

  let mod = null

  for (const p of possiblePaths) {
    const fullPath = path.join(process.cwd(), p)

    try {
      mod = jiti(fullPath)
      break
    } catch {
      // File not found, try next
    }
  }

  if (!mod) {
    throw new Error(
      `${PREFIX} Could not find postcss.config.{mjs,js,cjs} in ${process.cwd()}`
    )
  }

  return mod?.default ?? mod
}

function checkIsUnoPlugin(entry) {
  if (typeof entry === "string") {
    return entry === "@unocss/postcss"
  }

  if (typeof entry === "function") {
    const name = entry.name || ""

    return name.toLowerCase().includes("unocss") || name.includes("Uno")
  }

  if (typeof entry === "object" && entry !== null) {
    const postcssPlugin = entry.postcssPlugin || ""

    return postcssPlugin.toLowerCase().includes("unocss")
  }

  return false
}

function extractConfigFromPlugin(entry) {
  if (Array.isArray(entry)) {
    const [nameOrFn, opts] = entry

    if (checkIsUnoPlugin(nameOrFn) && opts?.configOrPath) {
      return opts.configOrPath
    }

    if (checkIsUnoPlugin(nameOrFn)) {
      return null
    }
  }

  if (checkIsUnoPlugin(entry)) {
    if (typeof entry === "object" && entry.configOrPath) {
      return entry.configOrPath
    }

    return null
  }

  return undefined
}

function invalidateIfConfigChanged() {
  if (!cfgPath) return false

  try {
    const stat = fs.statSync(cfgPath)

    if (stat.mtimeMs !== cfgMtime) {
      cfgMtime = stat.mtimeMs
      cfgLoaded = false
      cfg = null
      uno = null
      unoInitPromise = null

      return true
    }
  } catch {
    // File not accessible, keep cache
  }

  return false
}

function loadUnoConfigFromPostcss() {
  if (cfgLoaded) return cfg

  try {
    nodeRequire("tsconfig-paths/register")
  } catch {
    // Optional dependency
  }

  let pc

  try {
    pc = loadPostcssConfig()
  } catch (error) {
    throw new Error(
      `${PREFIX} Failed to load postcss config: ${error?.message || error}`
    )
  }

  if (!(pc && Array.isArray(pc.plugins))) {
    throw new Error(
      `${PREFIX} postcss.config is invalid: "plugins" must be an array`
    )
  }

  let found

  for (const entry of pc.plugins) {
    const result = extractConfigFromPlugin(entry)

    if (result !== undefined) {
      found = result
      break
    }
  }

  if (found === undefined) {
    throw new Error(
      `${PREFIX} UnoCSS plugin not found in postcss.config plugins`
    )
  }

  if (found === null) {
    const defaultPath = findDefaultConfigPath()

    if (defaultPath) {
      cfgPath = defaultPath

      try {
        const stat = fs.statSync(cfgPath)
        cfgMtime = stat.mtimeMs
      } catch {
        // Will be handled below
      }

      try {
        cfg = loadConfigFromPath(defaultPath)
      } catch (error) {
        throw new Error(
          `${PREFIX} Failed to load default UnoCSS config from "${defaultPath}": ${error?.message || error}`
        )
      }
    } else {
      throw new Error(
        `${PREFIX} No configOrPath provided and no default config found. Expected one of: ${DEFAULT_CONFIG_PATHS.join(", ")}`
      )
    }
  } else if (typeof found === "string") {
    cfgPath = resolveConfigPath(found)

    try {
      const stat = fs.statSync(cfgPath)
      cfgMtime = stat.mtimeMs
    } catch {
      // Will be handled below
    }

    try {
      cfg = loadConfigFromPath(found)
    } catch (error) {
      throw new Error(
        `${PREFIX} Failed to load UnoCSS config from path "${found}": ${error?.message || error}`
      )
    }
  } else if (typeof found === "object" && found !== null) {
    cfg = found
  } else {
    throw new Error(
      `${PREFIX} configOrPath must be an object (UnoCSS config) or a string (path to config file). Got: ${typeof found}`
    )
  }

  if (!cfg || typeof cfg !== "object") {
    throw new Error(`${PREFIX} Loaded config is not a valid object`)
  }

  cfgLoaded = true

  return cfg
}

async function getUno() {
  invalidateIfConfigChanged()

  if (uno) return uno
  if (unoInitPromise) return unoInitPromise

  let config

  try {
    config = loadUnoConfigFromPostcss()
  } catch (error) {
    console.error(error.message)
    throw error
  }

  try {
    unoInitPromise = createGenerator(config).then((u) => {
      uno = u
      return u
    })

    return unoInitPromise
  } catch (error) {
    throw new Error(
      `${PREFIX} Failed to create UnoCSS generator: ${error?.message || error}`
    )
  }
}

function isProcessable(id) {
  if (!id) return false
  if (id.includes("node_modules")) return false
  if (/\.d\.ts$/.test(id)) return false
  if (/\.(test|spec)\.(t|j)sx?$/.test(id)) return false

  return /\.(t|j)sx?$/.test(id)
}

function pickTransformers(enforce = "default") {
  const list = cfg?.transformers || []

  return list.filter((t) => (t?.enforce || "default") === enforce)
}

async function applyTransformersPipeline(code, id) {
  let u

  try {
    u = await getUno()
  } catch {
    return null
  }

  const original = code
  const phases = ["pre", "default", "post"]
  let current = code

  for (const phase of phases) {
    const transformers = pickTransformers(phase)

    if (!transformers.length) continue

    let s = new MagicString(current)

    for (const t of transformers) {
      if (!t) continue

      if (t.idFilter) {
        try {
          if (!t.idFilter(id)) continue
        } catch (error) {
          console.warn(
            `${PREFIX} idFilter failed for transformer "${t.name || "unknown"}": ${error?.message || error}`
          )
          continue
        }
      }

      const fn = t.transform || t

      if (typeof fn !== "function") continue

      const ctx = {
        uno: u,
        filename: id,
        tokens: new Set(),
        filter: isProcessable
      }

      try {
        await fn(s, id, ctx)
      } catch (error) {
        const relativePath = path.relative(process.cwd(), id)
        console.error(
          `${PREFIX} Transform failed in "${t.name || "unknown"}" for ${relativePath}: ${error?.stack || error?.message || error}`
        )
      }

      if (s.hasChanged()) {
        current = s.toString()
        s = new MagicString(current)
      }
    }
  }

  if (current !== original) {
    return {code: current}
  }

  return null
}

const memo = new Map()
const MEMO_LIMIT = 500

function sha1Sync(s) {
  try {
    const {createHash} = nodeRequire("node:crypto")
    return createHash("sha1").update(s).digest("hex")
  } catch {
    return `${s.length}_${s.slice(0, 100)}`
  }
}

function memoGet(key) {
  if (!memo.has(key)) return null

  const v = memo.get(key)

  memo.delete(key)
  memo.set(key, v)

  return v
}

function memoSet(key, val) {
  memo.set(key, val)

  if (memo.size > MEMO_LIMIT) {
    memo.delete(memo.keys().next().value)
  }
}

export default async function unoLoader(source) {
  const code = String(source)
  const file = this?.resourcePath || this?.resource || ""

  if (!isProcessable(file)) return code
  if (code.length < 10) return code

  const key = `${file}:${sha1Sync(code)}`
  const cached = memoGet(key)

  if (cached) return cached

  try {
    const res = await applyTransformersPipeline(code, file)
    const out = res?.code && res.code !== code ? res.code : code

    memoSet(key, out)

    return out
  } catch (error) {
    console.error(
      `${PREFIX} Loader error for ${path.relative(process.cwd(), file)}: ${error?.message || error}`
    )

    return code
  }
}
