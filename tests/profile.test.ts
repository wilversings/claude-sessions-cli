// CLAUDE_CONFIG_DIR selects which Claude Code profile the tool browses. Each
// profile keeps its own registry, its own history, and its own tool state, and
// none of it may leak between them.
import { describe, test, expect, afterEach } from "vitest"
import { join } from "path"
import { mkdirSync, writeFileSync, existsSync } from "fs"
import { createSandbox, toProjectDirName, type Sandbox } from "./helpers/sandbox"

let box: Sandbox
afterEach(() => box?.cleanup())

/** Plants a default-profile install (~/.claude.json + ~/.claude/projects) in
 *  the same home, so we can prove the work profile ignores it. */
const seedDefaultProfile = (home: string) => {
  const dir = join(home, "code", "personal-app")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ projects: { [dir]: {} } }, null, 2))

  const history = join(home, ".claude", "projects", toProjectDirName(dir))
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, "dddddddd-0000-0000-0000-000000000001.jsonl"),
    JSON.stringify({
      type: "user",
      cwd: dir,
      message: { role: "user", content: "personal session" },
    }) + "\n",
  )
  return dir
}

describe("profiles", () => {
  test("reads the profile named by CLAUDE_CONFIG_DIR", async () => {
    box = createSandbox({ profile: ".claude-work" })
    box.addProject(join(box.home, "code", "work-app"), [{ prompt: "work session" }])

    const cli = await box.launchReady()
    await cli.waitFor("work-app")
    expect(cli.screen()).toContain("work-app")
    await cli.quit()
  })

  test("keeps its own state folder", async () => {
    box = createSandbox({ profile: ".claude-work" })
    const proj = join(box.home, "code", "work-app")
    const [id] = box.addProject(proj, [{ prompt: "work session" }])

    const cli = await box.launchReady()
    await cli.pressUntil("space", "work session")
    await cli.selectRow("work session")
    await cli.writeUntil("s", "★")
    expect(box.stateDir).toBe(join(box.home, ".claude-sessions-work"))
    expect(box.pins()).toContain(id!)
    // The default profile's state folder is never created.
    expect(existsSync(join(box.home, ".claude-sessions"))).toBe(false)
    await cli.quit()
  })

  test("does not surface the default profile's sessions", async () => {
    box = createSandbox({ profile: ".claude-work" })
    box.addProject(join(box.home, "code", "work-app"), [{ prompt: "work session" }])
    seedDefaultProfile(box.home)

    const cli = await box.launchReady()
    await cli.waitFor("work-app")
    expect(cli.screen()).not.toContain("personal-app")

    await cli.pressUntil("space", "work session")
    expect(cli.screen()).not.toContain("personal session")
    await cli.quit()
  })

  test("the default profile reads ~/.claude.json", async () => {
    box = createSandbox()
    expect(box.claudeJson).toBe(join(box.home, ".claude.json"))
    box.addProject(join(box.home, "code", "default-app"), [{ prompt: "default session" }])

    const cli = await box.launchReady()
    await cli.waitFor("default-app")
    expect(box.stateDir).toBe(join(box.home, ".claude-sessions"))
    await cli.quit()
  })
})
