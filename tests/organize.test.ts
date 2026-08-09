import { describe, test, expect, afterEach } from "vitest"
import { join } from "path"
import { utimesSync } from "fs"
import { createSandbox, type Sandbox } from "./helpers/sandbox"
import { waitUntil, type Cli } from "./helpers/terminal"

let box: Sandbox
afterEach(() => box?.cleanup())

const rowIndex = (cli: Cli, text: string) =>
  cli
    .screen()
    .split("\n")
    .findIndex((l) => l.includes(text))

/** Empties a prefilled text input so a fresh value can be typed. Presses a few
 *  more times than there are characters: extra backspaces on an empty field do
 *  nothing, so this self-corrects if one is dropped. */
const clearInput = async (cli: Cli, length: number) => {
  await cli.press("backspace", length + 4)
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
    await cli.pressUntil("space", "older work")
    expect(rowIndex(cli, "newer work")).toBeLessThan(rowIndex(cli, "older work"))

    await cli.selectRow("older work")
    // Starred code sessions are keyed by session id, not by path.
    await cli.writeUntilTrue("s", () => box.pins().includes(older!), "the star to persist")
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
    await cli.pressUntil("space", "some work")
    await cli.selectRow("some work")

    await cli.writeUntilTrue("s", () => box.pins().includes(only!), "the star to persist")
    await cli.writeUntilTrue("s", () => !box.pins().includes(only!), "the star to be removed")
    await cli.quit()
  })
})

describe("pinning and tagging chats", () => {
  test("p pins a chat and floats it above the rest", async () => {
    box = createSandbox()
    const zebra = box.addChat("Zebra chat")
    const apple = box.addChat("Apple chat")
    // Chats sort newest first; make that explicit rather than relying on the
    // order the fixtures happened to be written in.
    const now = Date.now() / 1000
    utimesSync(apple, now - 600, now - 600)
    utimesSync(zebra, now - 60, now - 60)

    const cli = await box.launchReady()
    await cli.pressUntil("right", "Apple chat")
    expect(rowIndex(cli, "Zebra chat")).toBeLessThan(rowIndex(cli, "Apple chat"))

    await cli.selectRow("Apple chat")
    await cli.writeUntilTrue("p", () => box.pins().length === 1, "the pin to persist")
    expect(box.pins()).toEqual([apple])

    // Pinned chats are listed above the unpinned ones.
    await waitUntil(
      () => rowIndex(cli, "Apple chat") < rowIndex(cli, "Zebra chat"),
      (above) => above,
      "the pinned chat to float to the top",
    )
    await cli.quit()
  })

  test("t files a chat under a tag folder that expands on space", async () => {
    box = createSandbox()
    const dir = box.addChat("Budget review")

    const cli = await box.launchReady()
    await cli.pressUntil("right", "Budget review")
    await cli.selectRow("Budget review")

    await cli.writeUntil("t", "Tag")
    await cli.type("finance")
    await cli.pressUntilTrue("enter", () => box.tags()[dir] === "finance", "the tag to persist")
    // The chat is now tucked inside a collapsed #finance folder.
    await cli.waitForGone("Budget review")
    await cli.waitFor("finance")

    await cli.pressUntil("space", "Budget review")
    await cli.quit()
  })

  test("submitting an empty tag removes it", async () => {
    box = createSandbox()
    const dir = box.addChat("Budget review", { tag: "finance" })

    const cli = await box.launchReady()
    await cli.pressUntil("right", "finance")
    // Expand the folder, then step onto the chat inside it.
    await cli.selectRow("finance")
    await cli.pressUntil("space", "Budget review")
    await cli.selectRow("Budget review")

    await cli.writeUntil("t", "Tag")
    await clearInput(cli, "finance".length)
    await cli.pressUntilTrue("enter", () => !box.tags()[dir], "the tag to be removed")
    await cli.quit()
  })
})

describe("renaming", () => {
  test("r renames a code session and remembers it by session id", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [id] = box.addProject(proj, [{ prompt: "old name" }])

    const cli = await box.launchReady()
    await cli.pressUntil("space", "old name")
    await cli.selectRow("old name")

    await cli.writeUntil("r", "Rename")
    await clearInput(cli, "old name".length)
    await cli.type("Payment retries")
    await cli.pressUntilTrue(
      "enter",
      () => box.labels()[id!] === "Payment retries",
      "the rename to persist",
    )
    await cli.waitFor("Payment retries")
    await cli.quit()
  })

  test("r renames a chat and remembers it by folder", async () => {
    box = createSandbox()
    const dir = box.addChat("Old chat")

    const cli = await box.launchReady()
    await cli.pressUntil("right", "Old chat")
    await cli.selectRow("Old chat")

    await cli.writeUntil("r", "Rename")
    await clearInput(cli, "Old chat".length)
    await cli.type("New chat name")
    await cli.pressUntilTrue(
      "enter",
      () => box.labels()[dir] === "New chat name",
      "the rename to persist",
    )
    await cli.quit()
  })

  test("escape cancels a rename", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [id] = box.addProject(proj, [{ prompt: "keep me" }])

    const cli = await box.launchReady()
    await cli.pressUntil("space", "keep me")
    await cli.selectRow("keep me")

    await cli.writeUntil("r", "Rename")
    await cli.type("throwaway")
    await cli.pressUntilGone("escape", "Rename")
    await cli.waitFor("keep me")
    expect(box.labels()[id!]).toBeUndefined()
    await cli.quit()
  })
})
