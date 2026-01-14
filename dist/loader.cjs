let loaderPromise = null

async function getLoader() {
  if (!loaderPromise) {
    loaderPromise = import("./loader.mjs").then((m) => m.default)
  }

  return loaderPromise
}

module.exports = async function unoLoader(source) {
  const loader = await getLoader()

  return loader.call(this, source)
}
