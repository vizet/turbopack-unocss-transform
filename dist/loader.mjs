import path from "node:path"
import MagicString from "magic-string"
import {createGenerator} from "unocss"
import {createRequire} from "node:module"

const nodeRequire = createRequire(import.meta.url)

let uno = null
let unoInitPromise = null
let cfg = null
let cfgLoaded = false

function loadPostcssConfig() {
  const jiti = nodeRequire("jiti")(import.meta.url, {
    interopDefault: true,
    esmResolve: true
  })
  const pcPath = path.join(process.cwd(), "postcss.config.mjs")

  let mod = jiti(pcPath)

  return mod?.default ?? mod
}

function loadUnoConfigFromPostcss() {
  if (cfgLoaded) return cfg

  try {
    nodeRequire("tsconfig-paths/register")
  } catch {}

  const pc = loadPostcssConfig()

  if (!pc || !Array.isArray(pc.plugins)) {
    throw new Error("[UnoCSS-TP] postcss.config.mjs is invalid (no plugins).")
  }

  let found = null

  for (const entry of pc.plugins) {
    if (!Array.isArray(entry)) continue

    const [nameOrFn, opts] = entry
    const isUno = (
      typeof nameOrFn === "string" && nameOrFn === "@unocss/postcss"
    ) || (
      typeof nameOrFn === "function" && (nameOrFn.name?.toLowerCase().includes("unocss") || nameOrFn.name?.includes("Uno"))
    )

    if (!isUno) continue

    found = opts?.configOrPath

    break
  }

  if (!found || typeof found !== "object") {
    throw new Error("[UnoCSS-TP] Required object unoConfig: [\"@unocss/postcss\", { configOrPath: unoConfig }]")
  }

  cfg = found
  cfgLoaded = true

  return cfg
}

async function getUno() {
  if (uno) return uno
  if (unoInitPromise) return unoInitPromise

  const config = loadUnoConfigFromPostcss()

  unoInitPromise = createGenerator(config).then(u => (uno = u))

  return unoInitPromise
}

function isProcessable(id) {
  return !!id
    && !id.includes("node_modules")
    && !/\.d\.ts$/.test(id)
    && !/\.(test|spec)\.(t|j)sx?$/.test(id)
    && /\.(t|j)sx?$/.test(id)
}

function pickTransformers(enforce = "default") {
  const list = (cfg?.transformers || [])

  return list.filter(t => (t?.enforce || "default") === enforce)
}

async function applyTransformersPipeline(code, id) {
  const u = await getUno()
  const original = code
  const phases = ["pre","default","post"]
  let current = code

  for (const phase of phases) {
    const transformers = pickTransformers(phase)

    if (!transformers.length) continue

    let s = new MagicString(current)
    let changed = false

    for (const t of transformers) {
      if (!t) continue

      if (t.idFilter) {
        try {
          if (!t.idFilter(id)) continue
        } catch {}
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
        console.error(`[UnoCSS-TP] transform failed in ${t.name || "transform"} for ${path.relative(process.cwd(), id)}:`, error?.stack || error?.message || error)
      }

      if (s.hasChanged()) {
        current = s.toString()
        s = new MagicString(current)
        changed = true
      }
    }

    if (!changed) continue
  }

  if (current !== original) {
    return {
      code: current
    }
  }

  return null
}

const memo = new Map()
const MEMO_LIMIT = 500

function sha1Sync(s) {
  const {createHash} = nodeRequire("node:crypto")

  return createHash("sha1").update(s).digest("hex")
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

  const key = file + ":" + sha1Sync(code)
  const cached = memoGet(key)

  if (cached) return cached

  const res = await applyTransformersPipeline(code, file)
  const out = (res?.code && res.code !== code) ? res.code : code

  memoSet(key, out)

  return out
}
