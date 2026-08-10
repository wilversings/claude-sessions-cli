import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "fs"
import { join, dirname, resolve } from "path"
import { spawnSync } from "child_process"
import { tmpdir } from "os"
import { CLAUDE_JSON, CLAUDE_PROJECTS } from "./config"
import type { ExportEntry, ImportEntry, Session } from "./types"
import { toProjectDirName } from "./utils"

// A filesystem-safe timestamp 'YYYYMMDD-HHMMSS' for default export filenames.
const exportStamp = (): string => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours(),
  )}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// Bundle sessions into a portable .tar.gz next to the cwd. The archive holds a
// manifest.json (recording each session's cwd so the sessions can later be
// restored into the right project) plus the raw .jsonl files under sessions/.
// Mirrors the format used by claude-session-manager's `export`. Returns the
// absolute path of the archive written.
export const writeSessionArchive = (
  entries: ExportEntry[],
  outName?: string,
): string => {
  if (!entries.length) throw new Error("No sessions to export.")

  const hasTar = spawnSync("tar", ["--version"], { stdio: "ignore" })
  if (hasTar.status !== 0 || hasTar.error)
    throw new Error("'tar' is required on PATH to write a .tar.gz archive.")

  const outAbs = resolve(outName || `claude-sessions-${exportStamp()}.tar.gz`)
  const staging = mkdtempSync(join(tmpdir(), "claude-sessions-export-"))
  try {
    const manifest = {
      tool: "claude-sessions-cli",
      format: 1,
      exportedAt: new Date().toISOString(),
      sessions: entries.map((e) => ({
        sessionId: e.sessionId,
        file: `sessions/${e.sessionId}.jsonl`,
        cwd: e.cwd,
        title: e.title,
      })),
    }
    const sessDir = join(staging, "sessions")
    mkdirSync(sessDir)
    for (const e of entries)
      copyFileSync(e.jsonlPath, join(sessDir, `${e.sessionId}.jsonl`))
    writeFileSync(
      join(staging, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    )

    // Start clean so re-exports to the same name don't accrete.
    try {
      rmSync(outAbs)
    } catch {}

    const r = spawnSync(
      "tar",
      ["-czf", outAbs, "-C", staging, "manifest.json", "sessions"],
      { stdio: "ignore" },
    )
    if (r.status !== 0)
      throw new Error(`Archiving failed (tar exited ${r.status}).`)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }

  return outAbs
}

// Collect the export entries for a set of code sessions (those with a jsonl on
// disk). Chat sessions without a sessionId can't be bundled and are skipped.
export const toExportEntries = (sessions: Session[]): ExportEntry[] =>
  sessions
    .filter((s) => s.sessionId && s.claudeProjectDir)
    .map((s) => ({
      jsonlPath: join(s.claudeProjectDir, `${s.sessionId}.jsonl`),
      sessionId: s.sessionId!,
      cwd: s.dir,
      title: s.title || s.label,
    }))
    .filter((e) => existsSync(e.jsonlPath))

// Ensure a project cwd is registered in ~/.claude.json so imported sessions
// surface in the list (loadSessions only walks projects listed there). Creates
// the file if this profile has none yet.
const addToClaudeJson = (dir: string) => {
  try {
    let json: { projects?: Record<string, unknown> } = {}
    if (existsSync(CLAUDE_JSON)) {
      try {
        json = JSON.parse(readFileSync(CLAUDE_JSON, "utf8"))
      } catch {}
    }
    if (!json.projects) json.projects = {}
    if (!json.projects[dir]) {
      json.projects[dir] = {}
      writeFileSync(CLAUDE_JSON, JSON.stringify(json, null, 2))
    }
  } catch {}
}

// Extract an archive produced by the export feature into a temp staging dir and
// resolve every session it lists to a target path. The caller owns the returned
// staging dir and must remove it when done. Throws on any structural problem.
export const extractArchive = (
  archivePath: string,
): { entries: ImportEntry[]; staging: string } => {
  const abs = resolve(archivePath)
  if (!existsSync(abs)) throw new Error(`Archive not found: ${archivePath}`)

  const hasTar = spawnSync("tar", ["--version"], { stdio: "ignore" })
  if (hasTar.status !== 0 || hasTar.error)
    throw new Error("'tar' is required on PATH to read a .tar.gz archive.")

  const staging = mkdtempSync(join(tmpdir(), "claude-sessions-import-"))
  try {
    const r = spawnSync("tar", ["-xzf", abs, "-C", staging], { stdio: "ignore" })
    if (r.status !== 0)
      throw new Error(`Extraction failed (tar exited ${r.status}).`)

    let manifest: { sessions?: unknown }
    try {
      manifest = JSON.parse(readFileSync(join(staging, "manifest.json"), "utf8"))
    } catch {
      throw new Error(
        "Archive has no valid manifest.json — not a claude-sessions export.",
      )
    }

    const raw = Array.isArray(manifest.sessions)
      ? (manifest.sessions as Array<Record<string, string>>)
      : []
    const entries: ImportEntry[] = []
    for (const e of raw) {
      if (!e.sessionId || !e.cwd) continue
      const src = join(staging, e.file || `sessions/${e.sessionId}.jsonl`)
      if (!existsSync(src)) continue
      entries.push({
        sessionId: e.sessionId,
        cwd: e.cwd,
        src,
        target: join(
          CLAUDE_PROJECTS,
          toProjectDirName(e.cwd),
          `${e.sessionId}.jsonl`,
        ),
      })
    }
    if (!entries.length) throw new Error("Archive lists no importable sessions.")
    return { entries, staging }
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    throw err
  }
}

// Copy one imported session into place and register its project.
export const applyImportEntry = (e: ImportEntry) => {
  mkdirSync(dirname(e.target), { recursive: true })
  copyFileSync(e.src, e.target)
  addToClaudeJson(e.cwd)
}
