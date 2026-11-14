import {getContext} from "./context"
import {transform} from "./transform"

type LoaderContext = {
  resourcePath: string
  getOptions: () => {
    configFile?: string
  }
  addDependency: (file: string) => void
  async: () => (error: Error | null, code?: string, map?: unknown) => void
}

const run = async (loader: LoaderContext, source: string) => {
  const context = await getContext(
    process.cwd(),
    loader.getOptions().configFile
  )

  for (const file of context.sources) loader.addDependency(file)

  return transform(context, source, loader.resourcePath)
}

export default function unocssLoader(
  this: LoaderContext,
  source: string,
  map?: unknown
) {
  const callback = this.async()

  run(this, source).then(
    (result) => callback(null, result?.code ?? source, result?.map ?? map),
    callback
  )
}
