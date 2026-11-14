export type Options = {
  configFile?: string
}

type Run = (root: unknown, helpers: unknown) => Promise<void>

const IMPLEMENTATION = "turbopack-unocss-transform/plugin"

function unocss(options: Options = {}) {
  let run: Promise<Run> | undefined

  return {
    postcssPlugin: "turbopack-unocss-transform",
    Once: async (root: unknown, helpers: unknown) => {
      run ??= import(IMPLEMENTATION).then((plugin) =>
        plugin.createPlugin(options)
      )

      await (await run)(root, helpers)
    }
  }
}

unocss.postcss = true as const

export default unocss
