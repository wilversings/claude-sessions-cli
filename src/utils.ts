export const slugify = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

export const humanLabel = (dir: string) => {
  const base = dir.split("/").pop() || dir
  const words = base
    .replace(/^[._-]+/, "")
    .replace(/[-_]+/g, " ")
    .trim()
  return (words || base).replace(/\b\w/g, (c) => c.toUpperCase())
}

export const kebabLabel = (dir: string) => dir.split("/").pop() || dir

export const toProjectDirName = (absPath: string) =>
  absPath.replace(/[^a-zA-Z0-9]/g, "-")

export const windowed = <T,>(
  arr: T[],
  cursor: number,
  height: number,
): { start: number; items: T[] } => {
  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(height / 2), Math.max(0, arr.length - height)),
  )
  return { start, items: arr.slice(start, start + height) }
}

export const timeAgo = (mtime: number) => {
  const diff = Date.now() / 1000 - mtime
  const m = Math.floor(diff / 60)
  const h = Math.floor(diff / 3600)
  const d = Math.floor(diff / 86400)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m`
  if (h < 24) return `${h}h`
  if (d === 1) return "yesterday"
  if (d < 7) return `${d}d`
  return new Date(mtime * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })
}

// Reads go through the libuv threadpool (4 threads by default), so firing
// hundreds at once only queues them up while pinning peak memory to the sum of
// every transcript. A window keeps memory flat and leaves the event loop free
// to keep the startup animation running.
export const READ_CONCURRENCY = 8

export const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return results
}
