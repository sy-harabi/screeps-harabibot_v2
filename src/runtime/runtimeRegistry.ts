interface RuntimeCacheOptions<K, V> {
  readonly cleanupInterval?: number
  readonly cleanup?: (cache: Map<K, V>) => void
}

interface RuntimeCache {
  readonly name: string
  readonly clear: () => void
  readonly size: () => number
  readonly cleanupInterval?: number
  readonly cleanupOffset?: number
  readonly cleanup?: () => void
}

export interface RuntimeCacheStat {
  readonly name: string
  readonly size: number
  readonly cleanupInterval?: number
}

const caches = new Map<string, RuntimeCache>()

function createCache<K, V>(name: string, options: RuntimeCacheOptions<K, V> = {}): Map<K, V> {
  if (caches.has(name)) {
    throw new Error(`Runtime cache already registered: ${name}`)
  }

  const { cleanupInterval, cleanup } = options

  if ((cleanupInterval === undefined) !== (cleanup === undefined)) {
    throw new Error(`Runtime cache ${name} must provide cleanupInterval and cleanup together`)
  }

  if (cleanupInterval !== undefined && (!Number.isInteger(cleanupInterval) || cleanupInterval <= 0)) {
    throw new Error(`Invalid cleanup interval for runtime cache ${name}: ${cleanupInterval}`)
  }

  const cache = new Map<K, V>()

  caches.set(name, {
    name,
    clear: () => cache.clear(),
    size: () => cache.size,
    cleanupInterval,
    cleanupOffset: cleanupInterval === undefined ? undefined : getCleanupOffset(name, cleanupInterval),
    cleanup: cleanup === undefined ? undefined : () => cleanup(cache),
  })

  return cache
}

function cleanup(): void {
  for (const cache of caches.values()) {
    if (cache.cleanup === undefined || cache.cleanupInterval === undefined || cache.cleanupOffset === undefined) {
      continue
    }

    if (Game.time % cache.cleanupInterval !== cache.cleanupOffset) {
      continue
    }

    cache.cleanup()
  }
}

function getStats(): readonly RuntimeCacheStat[] {
  return [...caches.values()]
    .map((cache) => ({
      name: cache.name,
      size: cache.size(),
      cleanupInterval: cache.cleanupInterval,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function clearAll(): void {
  for (const cache of caches.values()) {
    cache.clear()
  }
}

function getCleanupOffset(name: string, interval: number): number {
  let hash = 0

  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0
  }

  return hash % interval
}

export const runtimeRegistry = {
  createCache,
  cleanup,
  getStats,
  clearAll,
}
