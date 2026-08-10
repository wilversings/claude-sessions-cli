#!/usr/bin/env node
import React from "react"
import { render } from "ink"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs"
import { join } from "path"
import { spawnSync } from "child_process"
import { CHATS_DIR, CLAUDE_PROJECTS, KNOWN_FLAGS } from "./config"
import type { Session } from "./types"
import { loadSessions, moveToTrash } from "./sessions"
import { removeSessionLabel } from "./state"
import { readFirstPrompt } from "./transcript"
import { toProjectDirName } from "./utils"
import { runBanner } from "./banner"
import {
  pendingAction,
  sessionPreload,
  setPendingAction,
  setSessionPreload,
} from "./runtime-state"
import { App } from "./ui/App"
import { CleanApp } from "./ui/CleanConfirm"

const unknownFlag = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("-") && !KNOWN_FLAGS.has(arg))
if (unknownFlag) {
  console.error(`Unknown option: ${unknownFlag}`)
  process.exit(1)
}

mkdirSync(CHATS_DIR, { recursive: true })

if (process.argv[2] === "clean") {
  const { waitUntilExit } = render(<CleanApp />, { exitOnCtrlC: true })
  await waitUntilExit()
} else if (process.argv.includes("--mock")) {
  const now = Date.now() / 1000
  const ago = (s: number) => now - s
  const mockSessions: Session[] = [
    // ~/Projects/todo-app — the eternal side project
    {
      dir: "/Users/hal/Projects/todo-app",
      label: "todo-app — add dark mode before I write a single feature",
      title: "todo-app",
      prompt: "add dark mode before I write a single feature",
      path: "~/Projects/todo-app",
      type: "code",
      mtime: ago(3600 * 12),
      ago: "12h",
      claudeProjectDir: "",
      sessionId: "mock-0002-0000-0000-000000000001",
      projectLabel: "todo-app",
    },
    {
      dir: "/Users/hal/Projects/todo-app",
      label: "rewrite in Go because why not",
      path: "~/Projects/todo-app",
      type: "code",
      mtime: ago(3600 * 24 * 2),
      ago: "2d",
      claudeProjectDir: "",
      sessionId: "mock-0002-0000-0000-000000000002",
      projectLabel: "todo-app",
    },
    // ~/Projects/robot-butler — smart home chaos
    {
      dir: "/Users/hal/Projects/robot-butler",
      label:
        "robot-butler — make my coffee maker send me passive-aggressive slack messages",
      title: "robot-butler",
      prompt: "make my coffee maker send me passive-aggressive slack messages",
      path: "~/Projects/robot-butler",
      type: "code",
      mtime: ago(3600 * 36),
      ago: "yesterday",
      claudeProjectDir: "",
      sessionId: "mock-0003-0000-0000-000000000001",
      projectLabel: "robot-butler",
    },
    // ~/Projects/ai-girlfriend-for-my-terminal — don't ask
    {
      dir: "/Users/hal/Projects/cursed",
      label: "is it ethical to use AI to write my apology emails",
      path: "~/Projects/cursed",
      type: "code",
      mtime: ago(86400 * 3),
      ago: "3d",
      claudeProjectDir: "",
      sessionId: "mock-0004-0000-0000-000000000001",
      projectLabel: "cursed",
    },
    {
      dir: "/Users/hal/Projects/cursed",
      label: "blockchain-but-useful — find one use case, any use case",
      title: "blockchain-but-useful",
      prompt: "find one use case, any use case",
      path: "~/Projects/cursed",
      type: "code",
      mtime: ago(86400 * 4),
      ago: "4d",
      claudeProjectDir: "",
      sessionId: "mock-0004-0000-0000-000000000002",
      projectLabel: "cursed",
    },
  ]
  setSessionPreload(Promise.resolve(mockSessions))
  process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l")
  const { waitUntilExit } = render(<App />, { exitOnCtrlC: true })
  await waitUntilExit()
  process.stdout.write("\x1b[2J\x1b[H\x1b[?1049l\x1b[2J\x1b[H\x1b[?25h")
} else {
  let firstLaunch = true
  while (true) {
    process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l")
    setPendingAction(null)

    if (firstLaunch && !process.argv.includes("--no-banner")) {
      setSessionPreload(loadSessions())
      await runBanner(sessionPreload ?? undefined)
      firstLaunch = false
    }

    const { waitUntilExit } = render(<App />, { exitOnCtrlC: true })
    await waitUntilExit()

    process.stdout.write("\x1b[2J\x1b[H\x1b[?1049l\x1b[2J\x1b[H\x1b[?25h")

    if (!pendingAction) break

    const { type, dir, sessionId, name } = pendingAction
    mkdirSync(dir, { recursive: true })
    if (type === "new" && name) {
      const claudeMdPath = join(dir, "CLAUDE.md")
      if (!existsSync(claudeMdPath)) writeFileSync(claudeMdPath, `# ${name}\n`)
    }
    process.chdir(dir)
    const args =
      type === "resume" && sessionId
        ? ["--resume", sessionId]
        : type === "open"
          ? ["--continue"]
          : name
            ? ["--name", name]
            : []
    spawnSync("claude", args, { stdio: "inherit" })

    if (type === "new") {
      const claudeProjectDir = join(CLAUDE_PROJECTS, toProjectDirName(dir))
      const hasConversation =
        existsSync(claudeProjectDir) &&
        readdirSync(claudeProjectDir)
          .filter((f) => f.endsWith(".jsonl"))
          .some((f) => readFirstPrompt(join(claudeProjectDir, f)) !== "")
      if (!hasConversation) {
        moveToTrash(dir)
        removeSessionLabel(dir)
      }
    }
  }
}
