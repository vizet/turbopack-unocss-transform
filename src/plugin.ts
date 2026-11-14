import {readFile, stat} from "node:fs/promises"
import path from "node:path"
import {pathToFileURL} from "node:url"
import type {GenerateResult} from "@unocss/core"
import type {AtRule, Helpers, Root} from "postcss"
import {glob} from "tinyglobby"
import {CONFIG_FILE_ENV, NAME} from "./constants"
import type {Context} from "./context"
import {getContext, resolveOfficialPlugin} from "./context"
import type {Options} from "./postcss"
import {SKIP_COMMENT_RE, transform} from "./transform"

type Extracted = {
  mtime: number
  revision: number
  tokens: Set<string>
}

type Directives = (root: Root, result: Helpers["result"]) => Promise<void>

type Official = (options: {cwd: string; configOrPath: object}) => {
  plugins: Directives[]
}

const CONCURRENCY = 50
const DIRECTIVE_RE = /@unocss|@apply|@screen|theme\(/
const DEFAULT_GLOBS = [
  "**/*.{html,js,ts,jsx,tsx,vue,svelte,astro,elm,php,phtml,mdx,md,marko}"
]

const depend = (result: Helpers["result"], file: string) => {
  result.messages.push({
    plugin: NAME,
    parent: result.opts.from,
    type: "dependency",
    file: path.normalize(file)
  })
}

const importOfficial = async (root: string): Promise<Official> => {
  const official = await import(pathToFileURL(resolveOfficialPlugin(root)).href)

  return official.default.default ?? official.default
}

const createDirectives = async (
  official: Promise<Official>,
  context: Context
) =>
  (await official)({
    cwd: context.root,
    configOrPath: {
      ...context.uno.userConfig,
      configFile: false
    }
  }).plugins[0]

const extract = async (context: Context, file: string) => {
  const code = await readFile(file, "utf8")
  const tokens = new Set<string>()

  if (code.includes("@unocss-ignore")) return tokens

  const result = await transform(context, code, file)

  await context.uno.applyExtractors(
    (result?.code ?? code).replace(SKIP_COMMENT_RE, ""),
    file,
    tokens
  )

  return tokens
}

const collect = async (
  context: Context,
  cache: Map<string, Extracted>,
  files: string[]
) => {
  const tokens = new Set<string>()
  const present = new Set(files)
  let next = 0

  for (const file of cache.keys()) {
    if (!present.has(file)) cache.delete(file)
  }

  const worker = async () => {
    while (next < files.length) {
      const file = files[next]

      next += 1

      try {
        const {mtimeMs} = await stat(file)
        let entry = cache.get(file)

        if (entry?.mtime !== mtimeMs || entry.revision !== context.revision) {
          entry = {
            mtime: mtimeMs,
            revision: context.revision,
            tokens: await extract(context, file)
          }
          cache.set(file, entry)
        }

        for (const token of entry.tokens) tokens.add(token)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
    }
  }

  await Promise.all(Array.from({length: CONCURRENCY}, worker))

  for (const [index, item] of (
    context.uno.config.content?.inline ?? []
  ).entries()) {
    const resolved = typeof item === "function" ? await item() : item
    const {code, id} =
      typeof resolved === "string" ? {code: resolved, id: undefined} : resolved

    await context.uno.applyExtractors(
      code.replace(SKIP_COMMENT_RE, ""),
      id ?? `__plain_content_${index}__`,
      tokens
    )
  }

  return tokens
}

const watchRoots = (root: string, globs: string[]) => {
  const dirs = globs
    .filter((item) => !item.startsWith("!"))
    .map((item) => {
      const literal = item.split(/[*?[{]/)[0]

      return path.resolve(
        root,
        literal.endsWith("/") ? literal : path.dirname(literal)
      )
    })
    .sort((a, b) => a.length - b.length)

  return dirs.filter(
    (dir, index) =>
      !dirs
        .slice(0, index)
        .some((parent) => dir === parent || dir.startsWith(parent + path.sep))
  )
}

const pickLayers = (
  generated: GenerateResult,
  params: string,
  emitted: string[]
) => {
  const names = params
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
  const included = names.filter((name) => !name.startsWith("!"))
  const excluded = names
    .filter((name) => name.startsWith("!"))
    .map((name) => name.slice(1))

  if (included.length) {
    emitted.push(...included)

    return included
      .map(
        (name) =>
          (name === "all" ? generated.getLayers() : generated.getLayer(name)) ??
          ""
      )
      .filter(Boolean)
      .join("\n")
  }

  if (excluded.length) {
    emitted.push(...excluded)

    return generated.getLayers(undefined, excluded) ?? ""
  }

  return generated.getLayers(undefined, emitted) ?? ""
}

export const createPlugin = (options: Options = {}) => {
  const root = process.cwd()
  const configFile = options.configFile ?? process.env[CONFIG_FILE_ENV]
  const cache = new Map<string, Extracted>()
  let official: Promise<Official> | undefined
  let directives: Directives | undefined
  let revision = -1

  const generate = async (
    css: Root,
    {result, postcss}: Helpers,
    context: Context
  ) => {
    const rules: AtRule[] = []

    css.walkAtRules("unocss", (rule) => {
      rules.push(rule)
    })

    if (!rules.length) return

    const globs = context.uno.config.content?.filesystem ?? DEFAULT_GLOBS
    const files = await glob(globs, {
      cwd: root,
      absolute: true,
      expandDirectories: false,
      ignore: globs.some((item) => item.includes("node_modules"))
        ? undefined
        : ["**/node_modules/**"]
    })

    for (const file of files) depend(result, file)

    for (const dir of watchRoots(root, globs)) {
      result.messages.push({
        plugin: NAME,
        parent: result.opts.from,
        type: "dir-dependency",
        dir,
        glob: "**/*"
      })
    }

    const tokens = await collect(context, cache, files)
    const generated = await context.uno.generate([...tokens].sort())
    const emitted: string[] = []

    for (const rule of rules) {
      const nodes = postcss.parse(pickLayers(generated, rule.params, emitted))

      nodes.walkDecls((declaration) => {
        declaration.source = rule.source
      })
      rule.replaceWith(nodes)
    }
  }

  return async (css: Root, helpers: Helpers) => {
    if (!DIRECTIVE_RE.test(css.source?.input.css ?? css.toString())) return

    const context = await getContext(root, configFile)

    for (const file of context.sources) depend(helpers.result, file)

    await generate(css, helpers, context)

    if (!directives || revision !== context.revision) {
      official ??= importOfficial(root)
      directives = await createDirectives(official, context)
      revision = context.revision
    }

    await directives(css, helpers.result)
  }
}
