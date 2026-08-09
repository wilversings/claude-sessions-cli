import { describe, test, expect, afterEach } from "vitest"
import { createSandbox, type Sandbox } from "./helpers/sandbox"

let box: Sandbox
afterEach(() => box?.cleanup())

const longDoc = Array.from({ length: 40 }, (_, i) => `line-${String(i + 1).padStart(2, "0")}`).join(
  "\n",
)

describe("CLAUDE.md preview", () => {
  test("marks chats that have a CLAUDE.md", async () => {
    box = createSandbox()
    box.addChat("Documented", { claudeMd: "# Documented\n" })
    box.addChat("Bare")

    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("Documented")

    const row = cli.screen().split("\n").find((l) => l.includes("Documented")) ?? ""
    expect(row).toContain("md")
    const bare = cli.screen().split("\n").find((l) => l.includes("Bare")) ?? ""
    expect(bare).not.toContain("md")
    await cli.quit()
  })

  test("m opens the file, scrolls it, and closes on escape", async () => {
    box = createSandbox()
    box.addChat("Documented", { claudeMd: longDoc })

    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("Documented")
    await cli.press("down")

    await cli.write("m")
    await cli.waitFor("CLAUDE.md")
    expect(cli.screen()).toContain("line-01")
    // The viewport is shorter than the document, so the tail is off-screen.
    expect(cli.screen()).not.toContain("line-40")

    await cli.press("down", 3)
    await cli.waitFor("line-23")

    await cli.press("up", 3)
    await cli.waitFor("line-01")

    await cli.press("escape")
    await cli.waitFor("Documented")
    expect(cli.screen()).not.toContain("line-01")
    await cli.quit()
  })

  test("m does nothing for a chat without a CLAUDE.md", async () => {
    box = createSandbox()
    box.addChat("Bare")

    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("Bare")
    await cli.press("down")

    await cli.write("m")
    // Still on the list rather than in a preview.
    await cli.waitFor("Bare")
    expect(cli.screen()).not.toContain("CLAUDE.md")
    await cli.quit()
  })
})
