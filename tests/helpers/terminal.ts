// Drives the built CLI the way a user does: a real pseudo-terminal, real
// keystrokes, and a real VT emulator interpreting the escape sequences Ink
// emits. Assertions run against the emulated screen, so a test only passes if
// the text truly ended up on the terminal.
import { spawn, type IPty } from "node-pty"
import xterm from "@xterm/headless"
import { join } from "path"

type XtermTerminal = {
  rows: number
  write(data: string): void
  resize(cols: number, rows: number): void
  buffer: {
    active: {
      viewportY: number
      getLine(i: number): { translateToString(trim?: boolean): string } | undefined
    }
  }
}
type XtermCtor = new (opts: Record<string, unknown>) => XtermTerminal

// @xterm/headless ships as UMD; Node's CJS interop exposes it either directly
// or under .default depending on how the module lexer reads it.
const xtermModule = xterm as unknown as {
  Terminal?: XtermCtor
  default?: { Terminal: XtermCtor }
}
const Terminal = xtermModule.Terminal ?? xtermModule.default!.Terminal

const ESC = "\u001B"

const ANSI_PATTERN = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*" +
    "(?:(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007)" +
    "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  "g",
)

export const stripAnsi = (s: string) => s.replace(ANSI_PATTERN, "")

export const KEYS = {
  enter: "\r",
  escape: ESC,
  up: `${ESC}[A`,
  down: `${ESC}[B`,
  right: `${ESC}[C`,
  left: `${ESC}[D`,
  tab: "\t",
  space: " ",
  backspace: "\u007F",
} as const

export type Key = keyof typeof KEYS

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Ink coalesces bytes that land in one read, so keystrokes need breathing room.
const KEY_GAP_MS = 35

const matches = (haystack: string, pattern: string | RegExp) =>
  typeof pattern === "string" ? haystack.includes(pattern) : pattern.test(haystack)

const describePattern = (pattern: string | RegExp) =>
  typeof pattern === "string" ? JSON.stringify(pattern) : String(pattern)

export type LaunchOptions = {
  args?: string[]
  cwd: string
  env: Record<string, string>
  cols?: number
  rows?: number
}

const CLI_ENTRY = join(process.cwd(), "dist", "index.js")

export class Cli {
  private readonly term: XtermTerminal
  private readonly proc: IPty
  private raw = ""
  private exited = false
  exitCode: number | null = null

  constructor(opts: LaunchOptions) {
    const cols = opts.cols ?? 100
    const rows = opts.rows ?? 30
    this.term = new Terminal({ cols, rows, allowProposedApi: true })
    this.proc = spawn(process.execPath, [CLI_ENTRY, ...(opts.args ?? [])], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: opts.cwd,
      env: opts.env,
    })
    this.proc.onData((data) => {
      this.raw += data
      this.term.write(data)
    })
    this.proc.onExit(({ exitCode }) => {
      this.exited = true
      this.exitCode = exitCode
    })
  }

  /** The emulated screen as the user would see it right now. */
  screen(): string {
    const buf = this.term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < this.term.rows; i++) {
      lines.push((buf.getLine(buf.viewportY + i)?.translateToString(true) ?? "").trimEnd())
    }
    return lines.join("\n").replace(/\n+$/, "")
  }

  /** Everything the process has ever written, with escape sequences removed. */
  output(): string {
    return stripAnsi(this.raw)
  }

  get hasExited() {
    return this.exited
  }

  /** Sends a key. Every send is followed by a pause: two keys written into the
   *  pty back to back arrive as one chunk, which Ink parses as a single
   *  keypress, silently dropping one of them. */
  async press(key: Key, times = 1) {
    for (let i = 0; i < times; i++) {
      this.send(KEYS[key])
      await sleep(KEY_GAP_MS)
    }
  }

  async write(data: string) {
    this.send(data)
    await sleep(KEY_GAP_MS)
  }

  private send(data: string) {
    if (this.exited) return
    try {
      this.proc.write(data)
    } catch {}
  }

  /** Types a string one character at a time, the way a person would. */
  async type(text: string) {
    for (const ch of text) {
      this.send(ch)
      await sleep(KEY_GAP_MS)
    }
  }

  resize(cols: number, rows: number) {
    this.proc.resize(cols, rows)
    this.term.resize(cols, rows)
  }

  /** Waits until `pattern` shows up on screen; returns the matching screen. */
  async waitFor(pattern: string | RegExp, timeout = 15_000): Promise<string> {
    return this.until(
      () => this.screen(),
      (s) => matches(s, pattern),
      `screen to contain ${describePattern(pattern)}`,
      timeout,
    )
  }

  /** Waits until `pattern` is no longer on screen. */
  async waitForGone(pattern: string | RegExp, timeout = 15_000): Promise<string> {
    return this.until(
      () => this.screen(),
      (s) => !matches(s, pattern),
      `screen to stop containing ${describePattern(pattern)}`,
      timeout,
    )
  }

  /** Waits for output that may have been erased from the screen since. */
  async waitForOutput(pattern: string | RegExp, timeout = 15_000): Promise<string> {
    return this.until(
      () => this.output(),
      (s) => matches(s, pattern),
      `output to contain ${describePattern(pattern)}`,
      timeout,
    )
  }

  async waitForExit(timeout = 15_000): Promise<number> {
    await this.until(
      () => this.exitCode,
      () => this.exited,
      "process to exit",
      timeout,
    )
    return this.exitCode ?? -1
  }

  /** Quits the TUI and waits for the process to go away. Escapes unwind any
   *  nested prompt or wizard first, so the trailing `q` reaches the list rather
   *  than landing in a text input or a mode that ignores it. */
  async quit(): Promise<number> {
    for (let i = 0; i < 3 && !this.exited; i++) {
      this.send(KEYS.escape)
      await sleep(100)
    }
    if (!this.exited) this.send("q")
    return this.waitForExit()
  }

  kill() {
    if (!this.exited) {
      try {
        this.proc.kill()
      } catch {}
    }
  }

  private async until<T>(
    read: () => T,
    done: (value: T) => boolean,
    what: string,
    timeout: number,
  ): Promise<T> {
    const deadline = Date.now() + timeout
    let value = read()
    while (!done(value)) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out after ${timeout}ms waiting for ${what}.\n` +
            `--- screen ---\n${this.screen()}\n--- end screen ---`,
        )
      }
      await sleep(20)
      value = read()
    }
    return value
  }
}

/** Polls a value derived from disk, for assertions on files the CLI writes. */
export async function waitUntil<T>(
  read: () => T,
  done: (value: T) => boolean,
  what: string,
  timeout = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeout
  let value = read()
  while (!done(value)) {
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeout}ms waiting for ${what}`)
    await sleep(20)
    value = read()
  }
  return value
}
