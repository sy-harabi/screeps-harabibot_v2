interface RuntimeCache {
  readonly name: string
  readonly clear: () => void
  readonly size: () => number
}

const caches = new Map<string, RuntimeCache>()

function createCache<K, V>(name: string): Map<K, V> {
  if (caches.has(name)) {
    throw new Error(`Runtime cache already registered: ${name}`)
  }

  const cache = new Map<K, V>()

  caches.set(name, {
    name,
    clear: () => cache.clear(),
    size: () => cache.size,
  })

  return cache
}

export const runtimeRegistry = {
  createCache,
}
