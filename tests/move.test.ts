import { describe, test, expect, afterEach } from "vitest"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync } from "fs"
import { createSandbox, type Sandbox } from "./helpers/sandbox"
import { waitUntil, type Cli } from "./helpers/terminal"

let box: Sandbox
afterEach(() => box?.cleanup())

/** A session in code/project-a, with code/project-b sitting alongside it.
 *  The destination browser opens on the parent, listing both folders. */
const seed = (b: Sandbox, spec: { extra?: unknown[] } = {}) => {
  const from = join(b.home, "code", "project-a")
  const to = join(b.home, "code", "project-b")
  const [id] = b.addProject(from, [{ prompt: "move me", extra: spec.extra }])
  mkdirSync(to, { recursive: true })
  return { from, to, id: id! }
}

/** Opens the move wizard on the project's only session. */
const openWizard = async (cli: Cli) => {
  await cli.pressUntil("space", "move me")
  await cli.selectRow("move me")
  await cli.writeUntil("M", "choose destination")
}

const cwdsIn = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l).cwd)
    .filter(Boolean)

describe("moving a session", () => {
  test("moves it into a sibling project and rewrites the recorded cwd", async () => {
    box = createSandbox()
    const { from, to, id } = seed(box)

    const cli = await box.launchReady()
    await openWizard(cli)

    // Rows are: ../ then project-a, project-b, then the two "+" entries.
    await cli.selectRow("project-b/")
    await cli.pressUntil("enter", "rewrites cwd")
    expect(cli.screen()).toContain("project-b")

    await cli.writeUntil("y", "moved")
    await waitUntil(
      () => existsSync(box.transcriptPath(to, id)),
      (there) => there,
      "the transcript to land in the destination",
    )
    expect(existsSync(box.transcriptPath(from, id))).toBe(false)
    // Every record that pointed at the old folder now points at the new one.
    expect(cwdsIn(box.transcriptPath(to, id))).toEqual([to, to])
    expect(box.registeredProjects()).toContain(to)
    expect(box.registeredProjects()).not.toContain(from)
    await cli.quit()
  })

  test("creates a new subfolder from a typed name", async () => {
    box = createSandbox()
    const { id } = seed(box)

    const cli = await box.launchReady()
    await openWizard(cli)

    // The "+ New subfolder here…" row sits after ../ and the two folders.
    await cli.selectRow("New subfolder here")
    await cli.pressUntil("enter", "kebab-case")

    await cli.type("Payments Service")
    await cli.pressUntil("enter", "rewrites cwd")

    // The typed name is slugified into a kebab-case folder.
    const expected = join(box.home, "code", "payments-service")
    expect(cli.screen()).toContain("payments-service")

    await cli.writeUntil("y", "moved")
    await waitUntil(
      () => existsSync(box.transcriptPath(expected, id)),
      (there) => there,
      "the transcript to land in the new subfolder",
    )
    expect(existsSync(expected)).toBe(true)
    await cli.quit()
  })

  test("accepts an absolute path typed by hand", async () => {
    box = createSandbox()
    const { id } = seed(box)
    const target = join(box.home, "elsewhere", "archive")

    const cli = await box.launchReady()
    await openWizard(cli)

    await cli.selectRow("Other path")
    await cli.pressUntil("enter", "Destination path")

    await cli.type(target)
    await cli.pressUntil("enter", "rewrites cwd")

    await cli.writeUntil("y", "moved")
    await waitUntil(
      () => existsSync(box.transcriptPath(target, id)),
      (there) => there,
      "the transcript to land at the typed path",
    )
    await cli.quit()
  })

  test("navigates into a folder and back out again", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    await openWizard(cli)
    expect(cli.screen()).toContain("project-b")

    // Step onto project-a and descend into it; it has no subfolders.
    await cli.selectRow("project-a/")
    await cli.pressUntilGone("right", "project-b")

    await cli.pressUntil("left", "project-b")
    await cli.quit()
  })

  test("warns about path references it cannot rewrite", async () => {
    box = createSandbox()
    const from = join(box.home, "code", "project-a")
    const { to } = seed(box, {
      extra: [
        {
          type: "user",
          cwd: from,
          message: { role: "user", content: `check ${from}/README.md` },
        },
      ],
    })

    const cli = await box.launchReady()
    await openWizard(cli)
    await cli.selectRow("project-b/")
    await cli.pressUntil("enter", "embedded path reference")
    expect(cli.screen()).toContain(to.split("/").pop()!)
    await cli.quit()
  })

  test("n backs out of the confirmation without moving anything", async () => {
    box = createSandbox()
    const { from, id } = seed(box)

    const cli = await box.launchReady()
    await openWizard(cli)
    await cli.selectRow("project-b/")
    await cli.pressUntil("enter", "rewrites cwd")

    await cli.writeUntil("n", "choose destination")
    expect(existsSync(box.transcriptPath(from, id))).toBe(true)
    await cli.quit()
  })

  test("escape leaves the wizard entirely", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    await openWizard(cli)

    // The wizard lists project-a too, so wait for the wizard itself to go.
    await cli.pressUntilGone("escape", "choose destination")
    expect(cli.screen()).toContain("project-a")
    await cli.quit()
  })
})
