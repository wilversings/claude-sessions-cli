import { readFileSync } from "fs"
import type { SessionMeta } from "./types"

export const normaliseSessionText = (value: string) =>
  value
    .trim()
    .replace(/^#+\s+/, "")
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 200)

// Transcripts routinely run to tens of megabytes, and a heavy user has hundreds
// of them. Decoding every byte to UTF-8 and JSON.parsing every line — which is
// what a naive scan costs — is what used to hold the splash screen hostage for
// seconds. Both facts we want out of a transcript sit at a known end of the
// file, so we work on the raw Buffer and decode only the slices we actually
// need.
const NEWLINE = 0x0a
// The opening prompt is within the first handful of lines in every real
// transcript; this bound just keeps a pathological one from costing a full
// decode.
const PROMPT_SCAN_BYTES = 256 * 1024
const TITLE_NEEDLE = Buffer.from('"custom-title"')

const isFirstPromptLine = (obj: any) =>
  obj.type === "user" &&
  typeof obj.message?.content === "string" &&
  !obj.message.content.startsWith("<") &&
  !obj.message.content.includes("tool_use_id")

// Scans up to 200 non-empty lines of an already-decoded chunk. `truncated` says
// the chunk stops mid-file, in which case its final (partial) line is not ours
// to parse and a miss is inconclusive rather than final.
const scanForPrompt = (
  text: string,
  truncated: boolean,
): { prompt: string; conclusive: boolean } => {
  let count = 0
  let pos = 0
  while (pos < text.length) {
    const nl = text.indexOf("\n", pos)
    const atEnd = nl === -1
    if (atEnd && truncated) return { prompt: "", conclusive: false }
    const line = text.slice(pos, atEnd ? text.length : nl)
    pos = atEnd ? text.length : nl + 1
    if (!line.trim()) continue
    if (++count > 200) return { prompt: "", conclusive: true }
    try {
      const obj = JSON.parse(line)
      if (isFirstPromptLine(obj))
        return {
          prompt: normaliseSessionText(obj.message.content),
          conclusive: true,
        }
    } catch {}
  }
  return { prompt: "", conclusive: !truncated }
}

export const readFirstPromptFromBuffer = (buf: Buffer): string => {
  const head = scanForPrompt(
    buf.toString("utf8", 0, Math.min(buf.length, PROMPT_SCAN_BYTES)),
    buf.length > PROMPT_SCAN_BYTES,
  )
  if (head.conclusive) return head.prompt
  return scanForPrompt(buf.toString("utf8"), false).prompt
}

// A rename appends a `custom-title` line, so the last valid one wins — but
// finding it never justifies parsing the whole transcript. The literal
// `"custom-title"` must appear verbatim in any line that has that type, so a
// byte search backwards from the end lands on the answer directly; a file
// without the needle (the common case) costs one memchr and no parsing at all.
export const readTitleFromBuffer = (buf: Buffer): string => {
  let at = buf.lastIndexOf(TITLE_NEEDLE)
  while (at !== -1) {
    const lineStart = buf.lastIndexOf(NEWLINE, at)
    let lineEnd = buf.indexOf(NEWLINE, at)
    if (lineEnd === -1) lineEnd = buf.length
    try {
      const obj = JSON.parse(buf.toString("utf8", lineStart + 1, lineEnd))
      if (obj.type === "custom-title") {
        const value =
          obj.customTitle ?? obj.sessionTitle ?? obj.title ?? obj.name
        if (typeof value === "string" && value.trim())
          return normaliseSessionText(value)
      }
    } catch {}
    // Not a real title line (the string can also appear inside a tool result),
    // so keep walking backwards through the remaining hits.
    if (at === 0) break
    at = buf.lastIndexOf(TITLE_NEEDLE, at - 1)
  }
  return ""
}

export const readSessionMetaFromBuffer = (buf: Buffer): SessionMeta => ({
  prompt: readFirstPromptFromBuffer(buf),
  title: readTitleFromBuffer(buf),
})

export const readFirstPrompt = (filePath: string): string => {
  try {
    return readFirstPromptFromBuffer(readFileSync(filePath))
  } catch {
    return ""
  }
}

export const buildSessionLabel = (
  sessionTitle: string,
  firstPrompt: string,
  fallback: string,
) => {
  if (sessionTitle && firstPrompt && sessionTitle !== firstPrompt) {
    return `${sessionTitle} — ${firstPrompt}`
  }
  return sessionTitle || firstPrompt || fallback
}
