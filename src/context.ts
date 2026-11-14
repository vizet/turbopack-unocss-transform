import {readFileSync, statSync} from "node:fs"
import {createRequire} from "node:module"
import path from "node:path"
import {pathToFileURL} from "node:url"
import type {UnoGenerator, UserConfig} from "@unocss/core"
import {createFilter} from "unplugin-utils"
import {NAME} from "./constants"

type UnoCSS = {
  createGenerator: (config: UserConfig) => Promise<UnoGenerator>
  loadConfig: (
    cwd: string,
    configOrPath: string
  ) => Promise<{
    config: UserConfig
    sources: string[]
  }>
}

type State = {
  unocss?: UnoCSS
  context?: Context
  mtimes: number[]
  queue: Promise<unknown>
}

export type Context = {
  root: string
  uno: UnoGenerator
  sources: string[]
  revision: number
  filter: (code: string, id: string) => boolean
}

const IGNORE_COMMENT = "@unocss-ignore"
const INCLUDE_COMMENT = "@unocss-include"
const DEFAULT_INCLUDE = [
  /\.(vue|svelte|[jt]sx|vine.ts|mdx?|astro|elm|php|phtml|marko|html)($|\?)/
]
const DEFAULT_EXCLUDE = [/\.(css|postcss|sass|scss|less|stylus|styl)($|\?)/]
const SCRIPT_RE = /\.[cm]?[jt]sx?$/
const IMPORT_RE =
  /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g
const EXTENSIONS = [
  "",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".json"
]

const states = new Map<string, State>()

export const resolveOfficialPlugin = (root: string) => {
  try {
    return createRequire(path.join(root, "package.json")).resolve(
      "@unocss/postcss"
    )
  } catch {
    throw new Error(`[${NAME}] "@unocss/postcss" is not installed in ${root}`)
  }
}

const importUnoCSS = async (root: string): Promise<UnoCSS> => {
  const official = createRequire(resolveOfficialPlugin(root))
  const load = (name: string) =>
    import(pathToFileURL(official.resolve(name)).href)
  const [core, config] = await Promise.all([
    load("@unocss/core"),
    load("@unocss/config")
  ])

  return {
    createGenerator: core.createGenerator,
    loadConfig: config.createRecoveryConfigLoader()
  }
}

const isFile = (file: string) =>
  statSync(file, {
    throwIfNoEntry: false
  })?.isFile()

const resolveImport = (importer: string, request: string) => {
  const target = path.resolve(path.dirname(importer), request)

  return [
    ...EXTENSIONS.map((extension) => target + extension),
    target.replace(/\.([cm]?)js$/, ".$1ts"),
    ...EXTENSIONS.slice(1).map((extension) =>
      path.join(target, `index${extension}`)
    )
  ].find(isFile)
}

const withImports = (entries: string[]) => {
  const files = new Set(entries.map((entry) => path.normalize(entry)))

  for (const file of files) {
    if (!(SCRIPT_RE.test(file) && isFile(file))) continue

    for (const [, request] of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      const resolved = resolveImport(file, request)

      if (resolved && !resolved.split(path.sep).includes("node_modules"))
        files.add(resolved)
    }
  }

  return [...files]
}

const readMtimes = (files: string[]) =>
  files.map((file) => {
    try {
      return statSync(file).mtimeMs
    } catch {
      return 0
    }
  })

const toPatterns = (value: unknown) =>
  (Array.isArray(value) ? value : [value]).filter(Boolean) as (
    | string
    | RegExp
  )[]

const createPipelineFilter = (config: UserConfig, root: string) => {
  const pipeline = config.content?.pipeline

  if (pipeline === false) return () => false

  const include = toPatterns(pipeline?.include ?? DEFAULT_INCLUDE)
  const exclude = toPatterns(pipeline?.exclude ?? DEFAULT_EXCLUDE)
  const options = {
    resolve: root
  }
  const included = include.length
    ? createFilter(include, [], options)
    : () => true
  const excluded = exclude.length
    ? createFilter(exclude, [], options)
    : () => false

  return (id: string) => included(id) && !excluded(id)
}

const reload = async (state: State, root: string, configFile?: string) => {
  state.unocss ??= await importUnoCSS(root)

  const loaded = await state.unocss.loadConfig(root, configFile ?? root)
  const sources = withImports(loaded.sources)
  const matchesPipeline = createPipelineFilter(loaded.config, root)
  const previous = state.context

  if (previous) await previous.uno.setConfig(loaded.config)

  state.mtimes = readMtimes(sources)
  state.context = {
    root,
    sources,
    uno: previous?.uno ?? (await state.unocss.createGenerator(loaded.config)),
    revision: previous ? previous.revision + 1 : 0,
    filter: (code, id) =>
      !code.includes(IGNORE_COMMENT) &&
      (code.includes(INCLUDE_COMMENT) || matchesPipeline(id))
  }
}

const refresh = async (state: State, root: string, configFile?: string) => {
  const {context, mtimes} = state

  if (
    !context ||
    readMtimes(context.sources).some((mtime, index) => mtime !== mtimes[index])
  ) {
    await reload(state, root, configFile)
  }

  return state.context as Context
}

export const getContext = (root: string, configFile?: string) => {
  const key = `${root}\0${configFile ?? ""}`
  const state = states.get(key) ?? {
    mtimes: [],
    queue: Promise.resolve()
  }
  const next = state.queue.then(
    () => refresh(state, root, configFile),
    () => refresh(state, root, configFile)
  )

  state.queue = next
  states.set(key, state)

  return next
}
