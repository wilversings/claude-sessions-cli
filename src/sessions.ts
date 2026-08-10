import { readdir, stat, readFile } from "fs/promises"
import {
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { CHATS_DIR, CLAUDE_JSON, CLAUDE_PROJECTS, HOME } from "./config"
import type { CleanItem, Session } from "./types"
import { EMPTY_META } from "./types"
import { readSessionMetaFromBuffer, buildSessionLabel } from "./transcript"
import {
  loadSessionLabels,
  loadSessionPins,
  loadSessionTags,
  removeSessionLabel,
} from "./state"
import {
  humanLabel,
  kebabLabel,
  mapLimit,
  READ_CONCURRENCY,
  timeAgo,
  toProjectDirName,
} from "./utils"

export const removeFromClaudeJson = (dir: string) => {
  try {
    const json = JSON.parse(readFileSync(CLAUDE_JSON, "utf8"))
    if (json.projects?.[dir]) {
      delete json.projects[dir]
      writeFileSync(CLAUDE_JSON, JSON.stringify(json, null, 2))
    }
  } catch {}
}

const ensureClaudeJsonProject = (dir: string) => {
  try {
    const json = JSON.parse(readFileSync(CLAUDE_JSON, "utf8"))
    if (!json.projects) json.projects = {}
    if (!json.projects[dir]) {
      json.projects[dir] = {}
      writeFileSync(CLAUDE_JSON, JSON.stringify(json, null, 2))
    }
  } catch {}
}

export const loadSessions = async (): Promise<Session[]> => {
  const sessions: Session[] = []

  if (existsSync(CLAUDE_JSON)) {
    try {
      const projectPaths = Object.keys(
        JSON.parse(readFileSync(CLAUDE_JSON, "utf8")).projects ?? {},
      )
      type Candidate = {
        cwd: string
        claudeProjectDir: string
        jsonlPath: string
        sessionId: string
        type: "chat" | "code"
        shortPath: string
        projectLabel: string
      }
      const candidates: Candidate[] = []
      await Promise.all(
        projectPaths.map(async (cwd) => {
          try {
            const claudeProjectDir = join(
              CLAUDE_PROJECTS,
              toProjectDirName(cwd),
            )
            if (!existsSync(claudeProjectDir)) return
            const jsonlFiles = (await readdir(claudeProjectDir)).filter(
              (f: string) => f.endsWith(".jsonl"),
            )
            if (!jsonlFiles.length) return
            const type =
              cwd === HOME || cwd.startsWith(CHATS_DIR) ? "chat" : "code"
            const projectLabel =
              type === "chat" ? humanLabel(cwd) : kebabLabel(cwd)
            for (const f of jsonlFiles)
              candidates.push({
                cwd,
                claudeProjectDir,
                jsonlPath: join(claudeProjectDir, f),
                sessionId: f.replace(".jsonl", ""),
                type,
                shortPath: cwd.replace(HOME, "~"),
                projectLabel,
              })
          } catch {}
        }),
      )

      await mapLimit(candidates, READ_CONCURRENCY, async (c) => {
        try {
          const mtime = (await stat(c.jsonlPath)).mtimeMs / 1000
          const meta =
            c.type === "code"
              ? readSessionMetaFromBuffer(await readFile(c.jsonlPath))
              : EMPTY_META

          sessions.push({
            dir: c.cwd,
            label: buildSessionLabel(meta.title, meta.prompt, c.projectLabel),
            title: meta.title || undefined,
            prompt: meta.prompt || undefined,
            path: c.shortPath,
            type: c.type,
            mtime,
            ago: timeAgo(mtime),
            claudeProjectDir: c.claudeProjectDir,
            sessionId: c.sessionId,
            projectLabel: c.projectLabel,
            hasClaudeMd:
              c.type === "chat" && existsSync(join(c.cwd, "CLAUDE.md")),
          })
        } catch {}
      })
    } catch {}
  }

  if (existsSync(CHATS_DIR)) {
    try {
      const existingDirs = new Set(sessions.map((s) => s.dir))
      for (const dir of await readdir(CHATS_DIR)) {
        try {
          const fullPath = join(CHATS_DIR, dir)
          const dirStat = await stat(fullPath)
          if (!dirStat.isDirectory() || existingDirs.has(fullPath)) continue
          const mtime = dirStat.mtimeMs / 1000
          sessions.push({
            dir: fullPath,
            label: humanLabel(fullPath),
            path: fullPath.replace(HOME, "~"),
            type: "chat",
            mtime,
            ago: timeAgo(mtime),
            claudeProjectDir: "",
            projectLabel: humanLabel(fullPath),
            hasClaudeMd: existsSync(join(fullPath, "CLAUDE.md")),
          })
        } catch {}
      }
    } catch {}
  }

  const labelOverrides = loadSessionLabels()
  for (const s of sessions) {
    const override =
      (s.sessionId && labelOverrides[s.sessionId]) || labelOverrides[s.dir]
    if (override) {
      s.label = override
      s.title = undefined
      s.prompt = undefined
    }
  }

  const pins = loadSessionPins()
  const tagOverrides = loadSessionTags()
  for (const s of sessions) {
    if (s.type === "chat") {
      s.pinned = pins.has(s.dir)
      s.tag = tagOverrides[s.dir]
    } else if (s.sessionId) {
      // Code sessions are starred by sessionId (chats are keyed by dir); both
      // live in the same pins file — path keys and uuid keys never collide.
      s.pinned = pins.has(s.sessionId)
    }
  }

  return sessions.sort((a, b) => b.mtime - a.mtime)
}

export const findCleanItems = async (): Promise<CleanItem[]> => {
  const items: CleanItem[] = []

  if (!existsSync(CLAUDE_JSON)) return items

  let projects: Record<string, unknown> = {}
  try {
    projects = JSON.parse(readFileSync(CLAUDE_JSON, "utf8")).projects ?? {}
  } catch {
    return items
  }

  const projectPaths = Object.keys(projects)

  for (const cwd of projectPaths) {
    const projectDir = join(CLAUDE_PROJECTS, toProjectDirName(cwd))
    const shortCwd = cwd.replace(HOME, "~")

    if (!existsSync(cwd)) {
      items.push({
        label: shortCwd,
        reason: "ghost (directory deleted)",
        execute: () => {
          removeFromClaudeJson(cwd)
          moveToTrash(projectDir)
        },
      })
      continue
    }

    if (!existsSync(projectDir)) {
      items.push({
        label: shortCwd,
        reason: "no history",
        execute: () => removeFromClaudeJson(cwd),
      })
      continue
    }

    try {
      const jsonlFiles = (await readdir(projectDir)).filter((f: string) =>
        f.endsWith(".jsonl"),
      )
      if (!jsonlFiles.length)
        items.push({
          label: shortCwd,
          reason: "no history",
          execute: () => {
            removeFromClaudeJson(cwd)
            moveToTrash(projectDir)
          },
        })
    } catch {}
  }

  if (existsSync(CLAUDE_PROJECTS)) {
    const knownDirNames = new Set(projectPaths.map(toProjectDirName))
    try {
      for (const dir of await readdir(CLAUDE_PROJECTS)) {
        if (!knownDirNames.has(dir)) {
          const fullPath = join(CLAUDE_PROJECTS, dir)
          items.push({
            label: fullPath.replace(HOME, "~"),
            reason: "orphaned history",
            execute: () => {
              moveToTrash(fullPath)
            },
          })
        }
      }
    } catch {}
  }

  return items
}

// `trash` is a separate package that plenty of machines don't have, and a
// missing binary just exits 127 — which used to be swallowed, leaving the
// session on disk while the TUI acted as if it were gone. Probe once for
// whichever recoverable-delete CLI exists, and fall back to a real remove so a
// delete is always a delete.
const TRASH_CMD = (() => {
  for (const [bin, cmd] of [
    ["trash", "trash"],
    ["trash-put", "trash-put"],
    ["gio", "gio trash"],
  ] as const) {
    try {
      execSync(`command -v ${bin}`, { stdio: "ignore" })
      return cmd
    } catch {}
  }
  return null
})()

export const moveToTrash = (path: string): boolean => {
  if (!existsSync(path)) return true
  if (TRASH_CMD) {
    try {
      execSync(`${TRASH_CMD} "${path}"`, { stdio: "ignore" })
      if (!existsSync(path)) return true
    } catch {}
  }
  try {
    rmSync(path, { recursive: true, force: true })
    return !existsSync(path)
  } catch {
    return false
  }
}

export const deleteSession = (session: Session): boolean => {
  if (session.sessionId) {
    const jsonlPath = join(
      session.claudeProjectDir,
      `${session.sessionId}.jsonl`,
    )
    return moveToTrash(jsonlPath)
  }
  if (session.type === "chat") {
    if (!moveToTrash(session.dir)) return false
    removeSessionLabel(session.dir)
    return true
  }
  return false
}

export const analyzeSessionMove = (
  sessionId: string,
  fromDir: string,
): { lineCount: number; embeddedRefs: number } => {
  try {
    const srcPath = join(
      CLAUDE_PROJECTS,
      toProjectDirName(fromDir),
      `${sessionId}.jsonl`,
    )
    const lines = readFileSync(srcPath, "utf8")
      .split("\n")
      .filter((l) => l.trim())
    let embeddedRefs = 0
    for (const line of lines) {
      const occurrences = line.split(fromDir).length - 1
      let cwd: unknown
      try {
        cwd = JSON.parse(line).cwd
      } catch {}
      embeddedRefs += Math.max(0, occurrences - (cwd === fromDir ? 1 : 0))
    }
    return { lineCount: lines.length, embeddedRefs }
  } catch {
    return { lineCount: 0, embeddedRefs: 0 }
  }
}

export const moveSession = (
  sessionId: string,
  fromDir: string,
  toDir: string,
): { ok: boolean; error?: string } => {
  if (toDir === fromDir)
    return { ok: false, error: "destination is the same as the source" }
  try {
    const fromProjectDir = join(CLAUDE_PROJECTS, toProjectDirName(fromDir))
    const toProjectDir = join(CLAUDE_PROJECTS, toProjectDirName(toDir))
    const srcPath = join(fromProjectDir, `${sessionId}.jsonl`)
    const destPath = join(toProjectDir, `${sessionId}.jsonl`)
    if (!existsSync(srcPath))
      return { ok: false, error: "source session not found" }
    if (existsSync(destPath))
      return {
        ok: false,
        error: "a session with this id already exists at the destination",
      }

    const rewritten = readFileSync(srcPath, "utf8")
      .split("\n")
      .map((line) => {
        if (!line.trim()) return line
        try {
          const obj = JSON.parse(line)
          if (obj.cwd === fromDir) obj.cwd = toDir
          return JSON.stringify(obj)
        } catch {
          return line
        }
      })
      .join("\n")

    mkdirSync(toDir, { recursive: true })
    mkdirSync(toProjectDir, { recursive: true })
    writeFileSync(destPath, rewritten)
    if (!moveToTrash(srcPath)) {
      // Leaving both copies would make the session show up twice, so undo the
      // half we did manage to write.
      rmSync(destPath, { force: true })
      return { ok: false, error: "could not remove the original session file" }
    }

    ensureClaudeJsonProject(toDir)

    const remaining = existsSync(fromProjectDir)
      ? readdirSync(fromProjectDir).filter((f) => f.endsWith(".jsonl"))
      : []
    if (!remaining.length) {
      removeFromClaudeJson(fromDir)
      moveToTrash(fromProjectDir)
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
