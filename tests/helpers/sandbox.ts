// Builds a throwaway HOME that looks exactly like a real Claude Code install:
// a ~/.claude.json project registry, ~/.claude/projects/<slug>/<uuid>.jsonl
// transcripts, and ~/.claude-sessions state. The CLI is pointed at it through
// HOME (which os.homedir() honours) and CLAUDE_CONFIG_DIR, so tests never touch
// the developer's real sessions.
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  utimesSync,
  chmodSync,
  realpathSync,
} from "fs"
import { join, basename } from "path"
import { tmpdir } from "os"
import { Cli, type LaunchOptions } from "./terminal"

export const toProjectDirName = (absPath: string) => absPath.replace(/[^a-zA-Z0-9]/g, "-")

export type SessionSpec = {
  /** Session uuid; also the transcript filename. Generated when omitted. */
  id?: string
  /** First user message — what the list shows when there is no title. */
  prompt?: string
  /** Claude's own session title, shown as `title · prompt`. */
  title?: string
  /** Seconds in the past for the transcript mtime; drives sort order and `ago`. */
  secondsAgo?: number
  /** Extra raw JSONL records appended to the transcript. */
  extra?: unknown[]
}

let uuidCounter = 0
const nextId = () => {
  uuidCounter++
  const n = String(uuidCounter).padStart(12, "0")
  return `aaaaaaaa-bbbb-cccc-dddd-${n}`
}

/** The stub `claude` binary. Records every invocation so tests can assert on
 *  the exact argv and cwd the CLI handed to Claude Code, and can optionally
 *  fabricate a transcript so the "did this new chat produce anything?" branch
 *  can be exercised both ways. */
const CLAUDE_STUB = `#!/usr/bin/env node
const fs = require("fs")
const path = require("path")

fs.appendFileSync(
  process.env.CS_CLAUDE_LOG,
  JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n",
)

if (process.env.CS_CLAUDE_WRITE_SESSION === "1") {
  const projects = process.env.CS_CLAUDE_PROJECTS
  const dir = path.join(projects, process.cwd().replace(/[^a-zA-Z0-9]/g, "-"))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, "eeeeeeee-ffff-0000-1111-222222222222.jsonl"),
    JSON.stringify({
      type: "user",
      cwd: process.cwd(),
      message: { role: "user", content: "hello from the stub" },
    }) + "\\n",
  )
}
`

/** Stub for the folder-reveal command, so \`f\` can be asserted without a GUI. */
const OPEN_STUB = `#!/usr/bin/env node
const fs = require("fs")
fs.appendFileSync(
  process.env.CS_OPEN_LOG,
  JSON.stringify({ args: process.argv.slice(2) }) + "\\n",
)
`

export type ClaudeCall = { args: string[]; cwd: string }

export class Sandbox {
  readonly root: string
  readonly home: string
  readonly configDir: string
  readonly binDir: string
  readonly claudeLog: string
  readonly openLog: string
  private readonly clis: Cli[] = []

  constructor(opts: { profile?: string } = {}) {
    // Resolved up front: macOS's tmpdir lives under a symlink (/var ->
    // /private/var), and a spawned child's cwd reports the resolved path, so
    // comparing against the unresolved one would fail there.
    this.root = realpathSync(mkdtempSync(join(tmpdir(), "claude-sessions-test-")))
    this.home = join(this.root, "home")
    this.binDir = join(this.root, "bin")
    this.claudeLog = join(this.root, "claude-calls.jsonl")
    this.openLog = join(this.root, "open-calls.jsonl")
    // An explicit profile exercises the CLAUDE_CONFIG_DIR branch; the default
    // profile keeps its registry at ~/.claude.json instead of inside the dir.
    this.configDir = join(this.home, opts.profile ?? ".claude")

    mkdirSync(this.home, { recursive: true })
    mkdirSync(this.configDir, { recursive: true })
    mkdirSync(this.projectsDir, { recursive: true })
    mkdirSync(this.binDir, { recursive: true })

    for (const [name, body] of [
      ["claude", CLAUDE_STUB],
      ["open", OPEN_STUB],
    ] as const) {
      const file = join(this.binDir, name)
      writeFileSync(file, body)
      chmodSync(file, 0o755)
    }
    writeFileSync(this.claudeLog, "")
    writeFileSync(this.openLog, "")
  }

  get isDefaultProfile() {
    return basename(this.configDir) === ".claude"
  }

  /** ~/.claude/projects — where Claude Code keeps transcripts. */
  get projectsDir() {
    return join(this.configDir, "projects")
  }

  /** The project registry the CLI walks to discover sessions. */
  get claudeJson() {
    return this.isDefaultProfile
      ? join(this.home, ".claude.json")
      : join(this.configDir, ".claude.json")
  }

  /** ~/.claude-sessions[-profile] — this tool's own state. */
  get stateDir() {
    const suffix = basename(this.configDir).replace(/^\.claude-?/, "")
    return join(this.home, suffix ? `.claude-sessions-${suffix}` : ".claude-sessions")
  }

  get chatsDir() {
    return join(this.stateDir, "chats")
  }

  get labelsFile() {
    return join(this.stateDir, "session-labels.json")
  }

  get pinsFile() {
    return join(this.stateDir, "session-pins.json")
  }

  get tagsFile() {
    return join(this.stateDir, "session-tags.json")
  }

  // ---- fixture builders -------------------------------------------------

  /** Registers a project in ~/.claude.json and writes its transcripts. */
  addProject(dir: string, sessions: SessionSpec[] = []): string[] {
    mkdirSync(dir, { recursive: true })
    this.registerProject(dir)
    return sessions.map((spec) => this.addSession(dir, spec))
  }

  /** Registers a cwd without creating any transcript for it. */
  registerProject(dir: string) {
    const json = this.readClaudeJson()
    json.projects ??= {}
    json.projects[dir] ??= {}
    this.writeClaudeJson(json)
  }

  /** Writes one transcript under the project's history folder. */
  addSession(dir: string, spec: SessionSpec = {}): string {
    const id = spec.id ?? nextId()
    const historyDir = join(this.projectsDir, toProjectDirName(dir))
    mkdirSync(historyDir, { recursive: true })

    const records: unknown[] = [
      {
        type: "user",
        cwd: dir,
        sessionId: id,
        message: { role: "user", content: spec.prompt ?? "do the thing" },
      },
      {
        type: "assistant",
        cwd: dir,
        sessionId: id,
        message: { role: "assistant", content: [{ type: "text", text: "on it" }] },
      },
    ]
    if (spec.title) records.push({ type: "custom-title", customTitle: spec.title })
    records.push(...(spec.extra ?? []))

    const file = join(historyDir, `${id}.jsonl`)
    writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n")

    if (spec.secondsAgo !== undefined) {
      const when = Date.now() / 1000 - spec.secondsAgo
      utimesSync(file, when, when)
    }
    return id
  }

  /** Creates a chat session folder the way the "+ New chat" flow does. */
  addChat(
    label: string,
    opts: { claudeMd?: string; pinned?: boolean; tag?: string; id?: string } = {},
  ): string {
    const dir = join(this.chatsDir, opts.id ?? `chat-${label.replace(/\W+/g, "-").toLowerCase()}`)
    mkdirSync(dir, { recursive: true })
    this.setLabel(dir, label)
    if (opts.claudeMd !== undefined) writeFileSync(join(dir, "CLAUDE.md"), opts.claudeMd)
    if (opts.pinned) this.addPin(dir)
    if (opts.tag) this.setTag(dir, opts.tag)
    return dir
  }

  transcriptPath(dir: string, sessionId: string) {
    return join(this.projectsDir, toProjectDirName(dir), `${sessionId}.jsonl`)
  }

  historyDir(dir: string) {
    return join(this.projectsDir, toProjectDirName(dir))
  }

  // ---- state file access ------------------------------------------------

  readClaudeJson(): { projects?: Record<string, unknown> } {
    try {
      return JSON.parse(readFileSync(this.claudeJson, "utf8"))
    } catch {
      return {}
    }
  }

  writeClaudeJson(json: unknown) {
    mkdirSync(join(this.claudeJson, ".."), { recursive: true })
    writeFileSync(this.claudeJson, JSON.stringify(json, null, 2))
  }

  registeredProjects(): string[] {
    return Object.keys(this.readClaudeJson().projects ?? {})
  }

  private readJsonFile<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T
    } catch {
      return fallback
    }
  }

  private writeJsonFile(file: string, value: unknown) {
    mkdirSync(this.stateDir, { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2))
  }

  labels(): Record<string, string> {
    return this.readJsonFile(this.labelsFile, {})
  }

  setLabel(key: string, label: string) {
    this.writeJsonFile(this.labelsFile, { ...this.labels(), [key]: label })
  }

  pins(): string[] {
    return this.readJsonFile<string[]>(this.pinsFile, [])
  }

  addPin(key: string) {
    this.writeJsonFile(this.pinsFile, [...new Set([...this.pins(), key])])
  }

  tags(): Record<string, string> {
    return this.readJsonFile(this.tagsFile, {})
  }

  setTag(dir: string, tag: string) {
    this.writeJsonFile(this.tagsFile, { ...this.tags(), [dir]: tag })
  }

  /** Every invocation of the stub `claude`, in order. */
  claudeCalls(): ClaudeCall[] {
    return this.readLog(this.claudeLog) as ClaudeCall[]
  }

  /** Every invocation of the stub folder-reveal command. */
  openCalls(): { args: string[] }[] {
    return this.readLog(this.openLog) as { args: string[] }[]
  }

  private readLog(file: string): unknown[] {
    try {
      return readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    } catch {
      return []
    }
  }

  /** Archives the CLI wrote into the working directory. */
  archives(cwd = this.home): string[] {
    try {
      return readdirSync(cwd)
        .filter((f) => /^claude-sessions-.*\.tar\.gz$/.test(f))
        .map((f) => join(cwd, f))
    } catch {
      return []
    }
  }

  exists(path: string) {
    return existsSync(path)
  }

  // ---- launching --------------------------------------------------------

  env(extra: Record<string, string> = {}): Record<string, string> {
    const base: Record<string, string> = {
      PATH: `${this.binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: this.home,
      TERM: "xterm-256color",
      LANG: process.env.LANG ?? "C.UTF-8",
      CS_CLAUDE_LOG: this.claudeLog,
      CS_OPEN_LOG: this.openLog,
      CS_CLAUDE_PROJECTS: this.projectsDir,
    }
    if (!this.isDefaultProfile) base.CLAUDE_CONFIG_DIR = this.configDir
    return { ...base, ...extra }
  }

  /** Launches the built CLI against this sandbox. */
  launch(opts: Partial<LaunchOptions> & { args?: string[] } = {}): Cli {
    const cli = new Cli({
      args: opts.args ?? ["--no-banner"],
      cwd: opts.cwd ?? this.home,
      env: this.env(opts.env),
      cols: opts.cols,
      rows: opts.rows,
    })
    this.clis.push(cli)
    return cli
  }

  /** Launches and waits for the session list to finish loading. */
  async launchReady(opts: Parameters<Sandbox["launch"]>[0] = {}): Promise<Cli> {
    const cli = this.launch(opts)
    // The hint row only renders once sessions have finished loading, so it is
    // the signal that the list is ready for input.
    await cli.waitFor("quit")
    return cli
  }

  cleanup() {
    for (const cli of this.clis) cli.kill()
    rmSync(this.root, { recursive: true, force: true })
  }
}

export const createSandbox = (opts?: { profile?: string }) => new Sandbox(opts)
