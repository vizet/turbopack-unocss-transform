import {fileURLToPath} from "node:url"
import {CONFIG_FILE_ENV} from "./constants"

export type Options = {
  configFile?: string
}

type WebpackConfig = {
  module: {
    rules: unknown[]
  }
}

type NextConfig = {
  turbopack?: {
    rules?: Record<string, unknown>
  }
  webpack?: ((config: WebpackConfig, context: unknown) => unknown) | null
}

type Factory = (...args: never[]) => object | Promise<object>

const SOURCE_RE = /\.(?:[cm]?[jt]sx?|mdx?)$/
const loader = fileURLToPath(new URL("./loader.mjs", import.meta.url))

const toArray = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

const extend = <T extends object>(input: T, options: Options): T => {
  const nextConfig: NextConfig = input
  const rules = nextConfig.turbopack?.rules ?? {}

  if (options.configFile) process.env[CONFIG_FILE_ENV] = options.configFile

  const use = {
    loader,
    options
  }
  const rule = {
    condition: {
      all: [
        {
          not: "foreign"
        },
        {
          path: SOURCE_RE
        }
      ]
    },
    loaders: [use]
  }

  return {
    ...input,
    turbopack: {
      ...nextConfig.turbopack,
      rules: {
        ...rules,
        "*": [rule, ...toArray(rules["*"])]
      }
    },
    webpack: (config: WebpackConfig, context: unknown) => {
      config.module.rules.unshift({
        test: SOURCE_RE,
        exclude: /node_modules/,
        enforce: "pre",
        use: [use]
      })

      return nextConfig.webpack ? nextConfig.webpack(config, context) : config
    }
  }
}

function withUnoCSS<F extends Factory>(
  nextConfig: F,
  options?: Options
): (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>
function withUnoCSS<T extends object>(nextConfig?: T, options?: Options): T
function withUnoCSS(nextConfig: object | Factory = {}, options: Options = {}) {
  if (typeof nextConfig === "function") {
    const factory = nextConfig as (...args: unknown[]) => object

    return async (...args: unknown[]) => extend(await factory(...args), options)
  }

  return extend(nextConfig, options)
}

export default withUnoCSS
