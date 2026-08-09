import { describe, test, expect, afterEach } from "vitest"
import { join } from "path"
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { createSandbox, type Sandbox } from "./helpers/sandbox"
import { waitUntil, type Cli } from "./helpers/terminal"

/** Waits for the cleaner to settle. It paints one frame with every group
 *  unchecked before the effect that ticks them all runs, so acting on the
 *  first frame that says "Clean up" would confirm an empty selection. */
const cleanerReady = async (cli: Cli) => {
  await cli.waitFor("Clean up")
  await cli.waitFor("[x]")
}

let box: Sandbox
afterEach(() => box?.cleanup())

/** Plants one of each thing the cleaner knows how to find. */
const seedMess = (b: Sandbox) => {
  // A project whose folder was deleted from disk, but whose history remains.
  const ghost = join(b.home, "code", "deleted-project")
  b.addProject(ghost, [{ prompt: "from a vanished project" }])
  rmSync(ghost, { recursive: true, force: true })

  // A registered project that never accumulated any history.
  const empty = join(b.home, "code", "never-used")
  mkdirSync(empty, { recursive: true })
  b.registerProject(empty)

  // A history folder with no project pointing at it.
  const orphan = join(b.projectsDir, "-tmp-long-forgotten")
  mkdirSync(orphan, { recursive: true })
  writeFileSync(join(orphan, "old.jsonl"), "{}\n")

  // Something healthy that must survive.
  const healthy = join(b.home, "code", "healthy")
  b.addProject(healthy, [{ prompt: "still going" }])

  return { ghost, empty, orphan, healthy }
}

describe("the clean subcommand", () => {
  test("finds ghosts, history-less projects and orphaned history", async () => {
    box = createSandbox()
    seedMess(box)

    const cli = box.launch({ args: ["clean"] })
    await cleanerReady(cli)

    const screen = cli.screen()
    expect(screen).toContain("ghost (directory deleted)")
    expect(screen).toContain("no history")
    expect(screen).toContain("orphaned history")
    await cli.quit()
  })

  test("y removes everything selected and leaves healthy projects alone", async () => {
    box = createSandbox()
    const { ghost, empty, orphan, healthy } = seedMess(box)

    const cli = box.launch({ args: ["clean"] })
    await cleanerReady(cli)
    await cli.writeUntilTrue("y", () => cli.hasExited, "the cleaner to finish")

    expect(await cli.waitForExit()).toBe(0)

    const registered = box.registeredProjects()
    expect(registered).not.toContain(ghost)
    expect(registered).not.toContain(empty)
    expect(registered).toContain(healthy)
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(box.historyDir(healthy))).toBe(true)
  })

  test("n cancels without touching anything", async () => {
    box = createSandbox()
    const { ghost, orphan } = seedMess(box)

    const cli = box.launch({ args: ["clean"] })
    await cleanerReady(cli)
    await cli.writeUntilTrue("n", () => cli.hasExited, "the cleaner to cancel")

    expect(await cli.waitForExit()).toBe(0)
    expect(box.registeredProjects()).toContain(ghost)
    expect(existsSync(orphan)).toBe(true)
  })

  test("space deselects a group so it is spared", async () => {
    box = createSandbox()
    const { ghost, empty } = seedMess(box)

    const cli = box.launch({ args: ["clean"] })
    await cleanerReady(cli)
    // The cursor starts on the first group; unticking it spares those entries.
    await cli.pressUntil("space", "[ ]")
    await cli.writeUntilTrue("y", () => cli.hasExited, "the cleaner to finish")

    expect(await cli.waitForExit()).toBe(0)
    const registered = box.registeredProjects()
    // The first group is "ghost"; it survives while the rest is cleaned.
    expect(registered).toContain(ghost)
    expect(registered).not.toContain(empty)
  })

  test("a toggles every group at once", async () => {
    box = createSandbox()
    const { ghost, empty } = seedMess(box)

    const cli = box.launch({ args: ["clean"] })
    await cleanerReady(cli)
    // Everything starts selected, so `a` clears the lot.
    await cli.writeUntil("a", "[ ]")
    await cli.writeUntilTrue("y", () => cli.hasExited, "the cleaner to finish")

    expect(await cli.waitForExit()).toBe(0)
    expect(box.registeredProjects()).toContain(ghost)
    expect(box.registeredProjects()).toContain(empty)
  })

  test("says there is nothing to clean when the install is tidy", async () => {
    box = createSandbox()
    box.addProject(join(box.home, "code", "healthy"), [{ prompt: "fine" }])

    const cli = box.launch({ args: ["clean"] })
    await cli.waitFor("nothing to clean")
    await cli.pressUntilTrue("escape", () => cli.hasExited, "the cleaner to close")
    expect(await cli.waitForExit()).toBe(0)
  })
})

describe("cleaning from inside the TUI", () => {
  test("C opens the cleaner and refreshes the list afterwards", async () => {
    box = createSandbox()
    const { ghost, healthy } = seedMess(box)

    const cli = await box.launchReady()
    await cli.writeUntil("C", "Clean up")
    await cli.writeUntilTrue(
      "y",
      () => !box.registeredProjects().includes(ghost),
      "the ghost project to be removed",
    )
    // Back on the list, with the healthy project still there.
    await cli.waitFor("healthy")
    expect(box.registeredProjects()).toContain(healthy)
    await cli.quit()
  })

  test("escape closes the cleaner without changing anything", async () => {
    box = createSandbox()
    const { ghost } = seedMess(box)

    const cli = await box.launchReady()
    await cli.writeUntil("C", "Clean up")
    await cli.pressUntilGone("escape", "Clean up")
    await cli.waitFor("healthy")
    expect(box.registeredProjects()).toContain(ghost)
    await cli.quit()
  })
})
