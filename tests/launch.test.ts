// Covers the handoff to Claude Code itself: which argv the CLI builds, which
// working directory it hands over, and what it does with a chat folder that
// produced no conversation. A stub `claude` on PATH records every invocation.
import { describe, test, expect, afterEach } from "vitest"
import { join } from "path"
import { existsSync, readFileSync } from "fs"
import { createSandbox, type Sandbox } from "./helpers/sandbox"
import { waitUntil } from "./helpers/terminal"

let box: Sandbox
afterEach(() => box?.cleanup())

const firstCall = async (b: Sandbox) =>
  (await waitUntil(() => b.claudeCalls(), (c) => c.length > 0, "claude to be invoked"))[0]!

describe("resuming code sessions", () => {
  test("enter on a session resumes it by id in the project directory", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [id] = box.addProject(proj, [{ prompt: "resume me" }])

    const cli = await box.launchReady()
    await cli.press("space")
    await cli.waitFor("resume me")
    await cli.press("down")
    await cli.press("enter")

    const call = await firstCall(box)
    expect(call.args).toEqual(["--resume", id])
    expect(call.cwd).toBe(proj)
    await cli.quit()
  })

  test("enter on a collapsed project resumes its most recent session", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [recent] = box.addProject(proj, [
      { prompt: "most recent", secondsAgo: 60 },
      { prompt: "older", secondsAgo: 6000 },
    ])

    const cli = await box.launchReady()
    await cli.waitFor("app (2)")
    await cli.press("enter")

    const call = await firstCall(box)
    expect(call.args).toEqual(["--resume", recent])
    await cli.quit()
  })

  test("returns to the list after Claude Code exits", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    box.addProject(proj, [{ prompt: "resume me" }])

    const cli = await box.launchReady()
    await cli.press("space")
    await cli.waitFor("resume me")
    await cli.press("down")
    await cli.press("enter")

    await firstCall(box)
    // The TUI relaunches itself once the child process is done.
    await cli.waitFor("app")
    await cli.quit()
  })
})

describe("opening chats", () => {
  test("continues a chat that already has history", async () => {
    box = createSandbox()
    const dir = join(box.chatsDir, "chat-with-history")
    box.addProject(dir, [{ prompt: "carry on" }])
    box.setLabel(dir, "Ongoing chat")

    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("Ongoing chat")
    await cli.press("down")
    await cli.press("enter")

    const call = await firstCall(box)
    expect(call.args).toEqual(["--continue"])
    expect(call.cwd).toBe(dir)
    await cli.quit()
  })

  test("f reveals a chat folder", async () => {
    box = createSandbox()
    const dir = box.addChat("Reveal me")

    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("Reveal me")
    await cli.press("down")
    await cli.write("f")

    const calls = await waitUntil(
      () => box.openCalls(),
      (c) => c.length > 0,
      "the folder to be revealed",
    )
    expect(calls[0]!.args).toEqual([dir])
    await cli.quit()
  })
})

describe("creating a new chat", () => {
  test("starts Claude Code with the chosen name and a bootstrapped CLAUDE.md", async () => {
    box = createSandbox()
    const cli = await box.launchReady({ env: { CS_CLAUDE_WRITE_SESSION: "1" } })
    await cli.press("right")
    await cli.waitFor("+ New chat")
    await cli.press("enter")

    await cli.waitFor("New chat")
    await cli.type("Holiday plans")
    await cli.press("enter")

    const call = await firstCall(box)
    expect(call.args).toEqual(["--name", "Holiday plans"])
    expect(call.cwd.startsWith(box.chatsDir)).toBe(true)

    // The chat produced a conversation, so its folder and label survive.
    await waitUntil(
      () => existsSync(join(call.cwd, "CLAUDE.md")),
      (there) => there,
      "CLAUDE.md to be created",
    )
    expect(readFileSync(join(call.cwd, "CLAUDE.md"), "utf8")).toContain("# Holiday plans")
    expect(box.labels()[call.cwd]).toBe("Holiday plans")
    await cli.quit()
  })

  test("cleans up a chat folder that produced no conversation", async () => {
    box = createSandbox()
    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("+ New chat")
    await cli.press("enter")

    await cli.waitFor("New chat")
    await cli.type("Abandoned")
    await cli.press("enter")

    const call = await firstCall(box)
    expect(call.args).toEqual(["--name", "Abandoned"])

    // The stub wrote no transcript, so the empty folder is taken back out.
    await waitUntil(() => existsSync(call.cwd), (there) => !there, "the empty chat to be removed")
    await waitUntil(() => box.labels(), (l) => !l[call.cwd], "its label to be forgotten")
    await cli.quit()
  })

  test("submitting an empty name just returns to the list", async () => {
    box = createSandbox()
    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("+ New chat")
    await cli.press("enter")

    await cli.waitFor("New chat")
    await cli.press("enter")

    await cli.waitFor("+ New chat")
    expect(box.claudeCalls()).toHaveLength(0)
    await cli.quit()
  })

  test("escape cancels the new chat prompt", async () => {
    box = createSandbox()
    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("+ New chat")
    await cli.press("enter")

    await cli.waitFor("New chat")
    await cli.type("Nope")
    await cli.press("escape")

    await cli.waitFor("+ New chat")
    expect(box.claudeCalls()).toHaveLength(0)
    await cli.quit()
  })
})
