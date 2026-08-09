import { describe, test, expect, afterEach } from "vitest"
import { join } from "path"
import { createSandbox, type Sandbox } from "./helpers/sandbox"

let box: Sandbox
afterEach(() => box?.cleanup())

describe("command line", () => {
  test("rejects an unknown flag and exits non-zero", async () => {
    box = createSandbox()
    const cli = box.launch({ args: ["--wat"] })

    expect(await cli.waitForExit()).toBe(1)
    expect(cli.output()).toContain("Unknown option: --wat")
  })

  test("accepts --no-banner and goes straight to the list", async () => {
    box = createSandbox()
    box.addProject(join(box.home, "code", "app"), [{ prompt: "ship it" }])

    const cli = await box.launchReady()

    expect(cli.screen()).toContain("app")
    expect(cli.output()).not.toContain("claude sessions")
    expect(await cli.quit()).toBe(0)
  })

  test("plays the intro banner on first launch", async () => {
    box = createSandbox()
    box.addProject(join(box.home, "code", "app"), [{ prompt: "ship it" }])

    const cli = box.launch({ args: [] })

    // The banner is animated and then erased, so assert on the byte stream.
    await cli.waitForOutput("claude sessions")
    await cli.waitFor("app")
    expect(await cli.quit()).toBe(0)
  })

  test("--mock renders the demo sessions without touching disk", async () => {
    box = createSandbox()
    const cli = box.launch({ args: ["--mock"] })

    await cli.waitFor("todo-app")
    const screen = cli.screen()
    expect(screen).toContain("robot-butler")
    expect(screen).toContain("cursed")
    // Nothing was registered, so the sandbox registry stays empty.
    expect(box.registeredProjects()).toEqual([])
    expect(await cli.quit()).toBe(0)
  })

  test("quits on q and on escape", async () => {
    box = createSandbox()

    const byQ = await box.launchReady()
    await byQ.write("q")
    expect(await byQ.waitForExit()).toBe(0)

    const byEsc = await box.launchReady()
    await byEsc.pressUntilTrue("escape", () => byEsc.hasExited, "escape to quit")
    expect(await byEsc.waitForExit()).toBe(0)
  })

  test("redraws cleanly when the terminal is resized", async () => {
    box = createSandbox()
    box.addProject(join(box.home, "code", "app"), [{ prompt: "ship it" }])

    const cli = await box.launchReady({ cols: 100, rows: 30 })
    cli.resize(60, 20)
    await cli.waitFor("app")

    // A botched repaint leaves duplicate header rows behind.
    const headers = cli.screen().split("\n").filter((l) => l.includes("Claude"))
    expect(headers).toHaveLength(1)
    expect(await cli.quit()).toBe(0)
  })
})
