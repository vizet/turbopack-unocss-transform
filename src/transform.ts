import remapping from "@jridgewell/remapping"
import type {UnocssPluginContext} from "@unocss/core"
import MagicString from "magic-string"
import {parseSync, Visitor} from "oxc-parser"
import type {Context} from "./context"

type Part = {
  start: number
  end: number
  wrap: readonly [open: string, close: string]
}

const IGNORE_COMMENT = "@unocss-ignore"
const PLACEHOLDER = "@unocss-placeholder-"
const PHASES = ["pre", "default", "post"]
const JSX_RE = /\.(?:[cm]?js|[jt]sx)$/
const COMMENT = ["/*", "*/"] as const
const MARKUP = ["<!--", "-->"] as const
const TEXT = ["", "@"] as const

export const SKIP_COMMENT_RE =
  /(\/\/\s*?@unocss-skip-start\s*?|\/\*\s*?@unocss-skip-start\s*?\*\/|<!--\s*?@unocss-skip-start\s*?-->)[\s\S]*?(\/\/\s*?@unocss-skip-end\s*?|\/\*\s*?@unocss-skip-end\s*?\*\/|<!--\s*?@unocss-skip-end\s*?-->)/g

const findSkipped = (code: string) =>
  [...code.matchAll(SKIP_COMMENT_RE)].map(
    (match): Part => ({
      start: match.index,
      end: match.index + match[0].length,
      wrap: match[0].startsWith("<!--") ? MARKUP : COMMENT
    })
  )

const findJsxText = (code: string, id: string) => {
  const found: Part[] = []

  if (!(JSX_RE.test(id) && code.includes("</"))) return found

  const {program, errors} = parseSync(id, code, {
    lang: id.endsWith(".tsx") ? "tsx" : "jsx"
  })

  if (errors.length) return found

  new Visitor({
    JSXText: (node) => {
      if (/\S/.test(node.value)) {
        found.push({
          start: node.start,
          end: node.end,
          wrap: TEXT
        })
      }
    }
  }).visit(program)

  return found
}

const hide = (code: string, parts: Part[]) => {
  const s = new MagicString(code)
  const hidden = new Map<string, string>()

  for (const {start, end, wrap} of parts) {
    const key = `${wrap[0]}${PLACEHOLDER}${hidden.size}${wrap[1]}`

    hidden.set(key, code.slice(start, end))
    s.overwrite(start, end, key)
  }

  return {
    s,
    hidden
  }
}

const restore = (code: string, hidden: Map<string, string>) => {
  const s = new MagicString(code)

  for (const [key, text] of hidden) {
    for (
      let at = code.indexOf(key);
      at !== -1;
      at = code.indexOf(key, at + key.length)
    ) {
      s.overwrite(at, at + key.length, text)
    }
  }

  return s
}

const apply = async (context: Context, source: string, id: string) => {
  const pluginContext = {
    uno: context.uno,
    root: context.root,
    filter: context.filter,
    tokens: new Set<string>(),
    invalidate: () => undefined
  } as unknown as UnocssPluginContext
  const steps: MagicString[] = []
  let code = source

  for (const phase of PHASES) {
    for (const transformer of context.uno.config.transformers ?? []) {
      if ((transformer.enforce ?? "default") !== phase) continue

      if (
        transformer.idFilter
          ? !transformer.idFilter(id)
          : !context.filter(code, id)
      )
        continue

      if (transformer.codeFilter && !transformer.codeFilter(code, id)) continue

      const s = new MagicString(code)

      await transformer.transform(s as never, id, pluginContext)

      if (s.hasChanged()) {
        steps.push(s)
        code = s.toString()
      }
    }
  }

  return {
    code,
    steps
  }
}

export const transform = async (
  context: Context,
  original: string,
  id: string
) => {
  if (
    !context.uno.config.transformers?.length ||
    original.includes(IGNORE_COMMENT)
  )
    return null

  const skipped = findSkipped(original)
  let protection = hide(original, skipped)
  let result = await apply(context, protection.s.toString(), id)

  if (!result.steps.length) return null

  const texts = findJsxText(original, id).filter((text) =>
    skipped.every((part) => text.end <= part.start || text.start >= part.end)
  )

  if (texts.length) {
    protection = hide(original, [...skipped, ...texts])
    result = await apply(context, protection.s.toString(), id)

    if (!result.steps.length) return null
  }

  const steps = [
    protection.s,
    ...result.steps,
    restore(result.code, protection.hidden)
  ]
  const maps = steps
    .filter((step) => step.hasChanged())
    .map((step) =>
      step.generateMap({
        hires: true,
        source: id
      })
    )

  return {
    code: steps[steps.length - 1].toString(),
    map: remapping(maps.reverse() as never, () => null)
  }
}
