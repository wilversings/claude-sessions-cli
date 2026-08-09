import { describe, test, expect, afterEach } from "vitest"
import { join } from "path"
import { existsSync } from "fs"
import { createSandbox, type Sandbox } from "./helpers/sandbox"
import { waitUntil } from "./helpers/terminal"

let box: Sandbox
afterEach(() => box?.cleanup())

describe("deleting a single session", () => {
  test("d then y removes the transcript and the row", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [keep, drop] = box.addProject(proj, [
      { prompt: "keep this one", secondsAgo: 60 },
      { prompt: "delete this one", secondsAgo: 600 },
    ])

    const cli = await box.launchReady()
    await cli.press("space")
    await cli.waitFor("delete this one")
    await cli.press("down", 2)

    await cli.write("d")
    await cli.waitFor("Remove")
    expect(cli.screen()).toContain("delete this one")

    await cli.write("y")
    await waitUntil(
      () => existsSync(box.transcriptPath(proj, drop!)),
      (there) => !there,
      "the transcript to be deleted",
    )
    await cli.waitForGone("delete this one")
    // The untouched session is still listed and still on disk.
    expect(cli.screen()).toContain("keep this one")
    expect(existsSync(box.transcriptPath(proj, keep!))).toBe(true)
    await cli.quit()
  })

  test("d then n keeps the session", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [id] = box.addProject(proj, [{ prompt: "spare me" }])

    const cli = await box.launchReady()
    await cli.press("space")
    await cli.waitFor("spare me")
    await cli.press("down")

    await cli.write("d")
    await cli.waitFor("Remove")
    await cli.write("n")

    await cli.waitFor("spare me")
    expect(existsSync(box.transcriptPath(proj, id!))).toBe(true)
    await cli.quit()
  })

  test("escape also cancels the delete", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [id] = box.addProject(proj, [{ prompt: "spare me" }])

    const cli = await box.launchReady()
    await cli.press("space")
    await cli.waitFor("spare me")
    await cli.press("down")

    await cli.write("d")
    await cli.waitFor("Remove")
    await cli.press("escape")

    await cli.waitFor("spare me")
    expect(existsSync(box.transcriptPath(proj, id!))).toBe(true)
    await cli.quit()
  })

  test("deletes a chat folder and forgets its label", async () => {
    box = createSandbox()
    const dir = box.addChat("Disposable chat")

    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("Disposable chat")
    await cli.press("down")

    await cli.write("d")
    await cli.waitFor("Remove")
    await cli.write("y")

    await waitUntil(() => existsSync(dir), (there) => !there, "the chat folder to be removed")
    await waitUntil(() => box.labels(), (l) => !l[dir], "the label to be forgotten")
    await cli.quit()
  })
})

describe("deleting a whole project", () => {
  test("d on a header removes every session and unregisters the project", async () => {
    box = createSandbox()
    const doomed = join(box.home, "code", "doomed")
    const other = join(box.home, "code", "other")
    box.addProject(doomed, [{ prompt: "first", secondsAgo: 60 }, { prompt: "second", secondsAgo: 90 }])
    box.addProject(other, [{ prompt: "untouched", secondsAgo: 600 }])

    const cli = await box.launchReady()
    await cli.waitFor("doomed (2)")

    await cli.write("d")
    await cli.waitFor("Delete all")
    expect(cli.screen()).toContain("doomed")

    await cli.write("y")
    await waitUntil(
      () => box.registeredProjects(),
      (p) => !p.includes(doomed),
      "the project to be unregistered",
    )
    await cli.waitForGone("doomed")

    expect(existsSync(box.historyDir(doomed))).toBe(false)
    // The other project is untouched.
    expect(box.registeredProjects()).toContain(other)
    expect(cli.screen()).toContain("other")
    await cli.quit()
  })

  test("n on the delete-all prompt keeps everything", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    box.addProject(proj, [{ prompt: "first" }, { prompt: "second" }])

    const cli = await box.launchReady()
    await cli.waitFor("app (2)")

    await cli.write("d")
    await cli.waitFor("Delete all")
    await cli.write("n")

    await cli.waitFor("app (2)")
    expect(box.registeredProjects()).toContain(proj)
    await cli.quit()
  })
})
