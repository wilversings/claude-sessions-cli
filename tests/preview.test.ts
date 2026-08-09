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
    await cli.pressUntil("right", "Documented")

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
    await cli.pressUntil("right", "Documented")
    await cli.selectRow("Documented")

    await cli.writeUntil("m", "CLAUDE.md")
    expect(cli.screen()).toContain("line-01")
    // The viewport is shorter than the document, so the tail is off-screen.
    expect(cli.screen()).not.toContain("line-40")

    // Each step is verified, so a dropped keypress fails loudly here rather
    // than showing up as an off-by-one further down.
    await cli.pressUntil("down", "line-21")
    expect(cli.screen()).not.toContain("line-01")

    await cli.pressUntil("up", "line-01")
    expect(cli.screen()).not.toContain("line-21")

    await cli.pressUntil("escape", "Documented")
    expect(cli.screen()).not.toContain("line-01")
    await cli.quit()
  })

  test("m does nothing for a chat without a CLAUDE.md", async () => {
    box = createSandbox()
    box.addChat("Bare")

    const cli = await box.launchReady()
    await cli.pressUntil("right", "Bare")
    await cli.selectRow("Bare")

    await cli.write("m")
    // Nothing should happen, so give the preview a chance to appear before
    // concluding that it did not.
    await new Promise((r) => setTimeout(r, 1000))
    expect(cli.screen()).toContain("Bare")
    expect(cli.screen()).not.toContain("CLAUDE.md")
    await cli.quit()
  })
})
