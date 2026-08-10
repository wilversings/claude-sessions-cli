export type Tab = "code" | "chat" | "schedule"
export type CodeFilter = "all" | "named"

export type Session = {
  dir: string
  label: string
  title?: string
  prompt?: string
  path: string
  type: "chat" | "code"
  mtime: number
  ago: string
  claudeProjectDir: string
  sessionId?: string
  projectLabel?: string
  hasClaudeMd?: boolean
  pinned?: boolean
  tag?: string
}

export type DisplayItem =
  | { kind: "new" }
  | {
      kind: "header"
      label: string
      dir: string
      expanded: boolean
      count: number
      recentSession: Session
    }
  | { kind: "session"; session: Session }
  | { kind: "tag-header"; label: string; expanded: boolean; count: number }

export type CleanItem = {
  label: string
  reason: string
  execute: () => void
}

export type SessionMeta = { prompt: string; title: string }

export const EMPTY_META: SessionMeta = { prompt: "", title: "" }

export type ExportEntry = {
  jsonlPath: string
  sessionId: string
  cwd: string
  title: string
}

export type ImportEntry = {
  sessionId: string
  cwd: string
  src: string // extracted .jsonl inside the staging dir
  target: string // where it lands under CLAUDE_PROJECTS
}
