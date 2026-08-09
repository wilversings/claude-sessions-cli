import { describe, test, expect, afterEach } from "vitest"
import { join } from "path"
import { createSandbox, type Sandbox } from "./helpers/sandbox"
import { waitUntil, type Cli } from "./helpers/terminal"

let box: Sandbox
afterEach(() => box?.cleanup())

const rowIndex = (cli: Cli, text: string) =>
  cli
    .screen()
    .split("\n")
    .findIndex((l) => l.includes(text))

/** Empties a prefilled text input so a fresh value can be typed. */
const clearInput = async (cli: Cli, length: number) => {
  await cli.press("backspace", length)
}

describe("starring code sessions", () => {
  test("s stars a session, persists it, and floats it to the top", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [, older] = box.addProject(proj, [
      { prompt: "newer work", secondsAgo: 60 },
      { prompt: "older work", secondsAgo: 600 },
    ])

    const cli = await box.launchReady()
    await cli.press("space")
    await cli.waitFor("older work")
    expect(rowIndex(cli, "newer work")).toBeLessThan(rowIndex(cli, "older work"))

    await cli.press("down", 2)
    await cli.write("s")

    // Starred code sessions are keyed by session id, not by path.
    await waitUntil(() => box.pins(), (p) => p.includes(older!), "the star to persist")
    await cli.waitFor("★")
    await waitUntil(
      () => rowIndex(cli, "older work") < rowIndex(cli, "newer work"),
      (floated) => floated,
      "the starred session to float to the top",
    )
    await cli.quit()
  })

  test("s again unstars it", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [only] = box.addProject(proj, [{ prompt: "some work" }])

    const cli = await box.launchReady()
    await cli.press("space")
    await cli.waitFor("some work")
    await cli.press("down")

    await cli.write("s")
    await waitUntil(() => box.pins(), (p) => p.includes(only!), "the star to persist")

    await cli.write("s")
    await waitUntil(() => box.pins(), (p) => !p.includes(only!), "the star to be removed")
    await cli.quit()
  })
})

describe("pinning and tagging chats", () => {
  test("p pins a chat and floats it above the rest", async () => {
    box = createSandbox()
    const dirs = {
      "Zebra chat": box.addChat("Zebra chat"),
      "Apple chat": box.addChat("Apple chat"),
    }

    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("Apple chat")

    // Row 0 is "+ New chat"; step onto whichever chat sorts first today.
    await cli.press("down")
    const labels = Object.keys(dirs) as (keyof typeof dirs)[]
    const label = (await waitUntil(
      () => {
        const row = cli.screen().split("\n").find((l) => l.includes("›")) ?? ""
        return labels.find((l) => row.includes(l))
      },
      (found) => Boolean(found),
      "the cursor to land on a chat",
    ))!

    await cli.write("p")
    await waitUntil(() => box.pins(), (p) => p.length === 1, "the pin to persist")
    expect(box.pins()).toEqual([dirs[label]])

    // Pinned chats are listed above the unpinned ones.
    await waitUntil(
      () => rowIndex(cli, label) < rowIndex(cli, label === "Apple chat" ? "Zebra chat" : "Apple chat"),
      (above) => above,
      "the pinned chat to float to the top",
    )
    await cli.quit()
  })

  test("t files a chat under a tag folder that expands on space", async () => {
    box = createSandbox()
    const dir = box.addChat("Budget review")

    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("Budget review")
    await cli.press("down")

    await cli.write("t")
    await cli.waitFor("Tag")
    await cli.type("finance")
    await cli.press("enter")

    await waitUntil(() => box.tags(), (t) => t[dir] === "finance", "the tag to persist")
    // The chat is now tucked inside a collapsed #finance folder.
    await cli.waitForGone("Budget review")
    await cli.waitFor("finance")

    await cli.press("space")
    await cli.waitFor("Budget review")
    await cli.quit()
  })

  test("submitting an empty tag removes it", async () => {
    box = createSandbox()
    const dir = box.addChat("Budget review", { tag: "finance" })

    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("finance")
    // Expand the folder, then step onto the chat inside it.
    await cli.press("down")
    await cli.press("space")
    await cli.waitFor("Budget review")
    await cli.press("down")

    await cli.write("t")
    await cli.waitFor("Tag")
    await clearInput(cli, "finance".length)
    await cli.press("enter")

    await waitUntil(() => box.tags(), (t) => !t[dir], "the tag to be removed")
    await cli.quit()
  })
})

describe("renaming", () => {
  test("r renames a code session and remembers it by session id", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [id] = box.addProject(proj, [{ prompt: "old name" }])

    const cli = await box.launchReady()
    await cli.press("space")
    await cli.waitFor("old name")
    await cli.press("down")

    await cli.write("r")
    await cli.waitFor("Rename")
    await clearInput(cli, "old name".length)
    await cli.type("Payment retries")
    await cli.press("enter")

    await waitUntil(
      () => box.labels(),
      (l) => l[id!] === "Payment retries",
      "the rename to persist",
    )
    await cli.waitFor("Payment retries")
    await cli.quit()
  })

  test("r renames a chat and remembers it by folder", async () => {
    box = createSandbox()
    const dir = box.addChat("Old chat")

    const cli = await box.launchReady()
    await cli.press("right")
    await cli.waitFor("Old chat")
    await cli.press("down")

    await cli.write("r")
    await cli.waitFor("Rename")
    await clearInput(cli, "Old chat".length)
    await cli.type("New chat name")
    await cli.press("enter")

    await waitUntil(
      () => box.labels(),
      (l) => l[dir] === "New chat name",
      "the rename to persist",
    )
    await cli.quit()
  })

  test("escape cancels a rename", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [id] = box.addProject(proj, [{ prompt: "keep me" }])

    const cli = await box.launchReady()
    await cli.press("space")
    await cli.waitFor("keep me")
    await cli.press("down")

    await cli.write("r")
    await cli.waitFor("Rename")
    await cli.type("throwaway")
    await cli.press("escape")

    await cli.waitFor("keep me")
    expect(box.labels()[id!]).toBeUndefined()
    await cli.quit()
  })
})
