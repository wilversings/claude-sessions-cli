import { describe, test, expect, afterEach } from "vitest"
import { join } from "path"
import { createSandbox, type Sandbox } from "./helpers/sandbox"

let box: Sandbox
afterEach(() => box?.cleanup())

const seed = (b: Sandbox) => {
  const shop = join(b.home, "code", "web-shop")
  const infra = join(b.home, "code", "infra")
  b.addProject(shop, [
    { prompt: "fix the checkout bug", title: "Checkout", secondsAgo: 60 * 5 },
    { prompt: "add a coupon field", secondsAgo: 60 * 90 },
  ])
  b.addProject(infra, [{ prompt: "tighten the firewall rules", secondsAgo: 60 * 60 * 26 }])
  return { shop, infra }
}

describe("code tab", () => {
  test("groups sessions by project and counts them", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    const screen = cli.screen()

    expect(screen).toContain("web-shop (2)")
    expect(screen).toContain("infra")
    // Collapsed groups show the most recent session's age.
    expect(screen).toMatch(/web-shop \(2\)\s+5m/)
    expect(screen).toMatch(/infra\s+yesterday/)
    await cli.quit()
  })

  test("orders projects by most recent activity", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    const rows = cli.screen().split("\n")
    const shopRow = rows.findIndex((l) => l.includes("web-shop"))
    const infraRow = rows.findIndex((l) => l.includes("infra"))

    expect(shopRow).toBeGreaterThanOrEqual(0)
    expect(shopRow).toBeLessThan(infraRow)
    await cli.quit()
  })

  test("expands a project on space and collapses it again", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    expect(cli.screen()).not.toContain("fix the checkout bug")

    await cli.pressUntil("space", "fix the checkout bug")
    expect(cli.screen()).toContain("add a coupon field")

    await cli.pressUntilGone("space", "fix the checkout bug")
    await cli.quit()
  })

  test("shows a named session as title then prompt", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    await cli.pressUntil("space", "Checkout · fix the checkout bug")
    await cli.quit()
  })

  test("expanding another project collapses the first", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    await cli.pressUntil("space", "fix the checkout bug")

    // Move past the two now-visible sessions onto the infra header.
    await cli.selectRow("infra")
    await cli.pressUntil("space", "tighten the firewall rules")
    expect(cli.screen()).not.toContain("fix the checkout bug")
    await cli.quit()
  })

  test("moves the cursor with the arrow keys", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    const selected = () =>
      cli
        .screen()
        .split("\n")
        .find((l) => l.trimStart().startsWith("›")) ?? ""

    expect(selected()).toContain("web-shop")
    await cli.pressUntil("down", /›.*infra/)
    await cli.pressUntil("up", /›.*web-shop/)
    await cli.quit()
  })

  test("filters to named sessions with n and back again", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    // Only web-shop has a titled session, so infra drops out entirely.
    await cli.writeUntilTrue("n", () => !cli.screen().includes("infra"), "infra to drop out")
    expect(cli.screen()).toContain("named")
    expect(cli.screen()).toContain("web-shop")

    await cli.writeUntil("n", "infra")
    await cli.quit()
  })
})

describe("tabs", () => {
  test("cycles code → chat → scheduled with the arrow keys", async () => {
    box = createSandbox()
    seed(box)
    box.addChat("Trip planning")

    const cli = await box.launchReady()
    expect(cli.screen()).toContain("web-shop")

    await cli.pressUntil("right", "+ New chat")
    expect(cli.screen()).toContain("Trip planning")

    await cli.pressUntil("right", "no scheduled tasks yet")

    // Wraps back around to the code tab.
    await cli.pressUntil("right", "web-shop")

    await cli.pressUntil("left", "no scheduled tasks yet")
    await cli.quit()
  })

  test("cycles forward with the tab key", async () => {
    box = createSandbox()
    box.addChat("Trip planning")

    const cli = await box.launchReady()
    await cli.pressUntil("tab", "+ New chat")
    await cli.quit()
  })
})

describe("search", () => {
  test("filters the code list as you type and clears on escape", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    await cli.writeUntilTrue("/", () => !cli.screen().includes("search…"), "the search box to open")
    await cli.type("checkout")
    await cli.waitForGone("infra")
    expect(cli.screen()).toContain("web-shop")

    await cli.pressUntil("escape", "infra")
    await cli.quit()
  })

  test("matches on the project path too", async () => {
    box = createSandbox()
    seed(box)

    const cli = await box.launchReady()
    await cli.writeUntilTrue("/", () => !cli.screen().includes("search…"), "the search box to open")
    await cli.type("infra")
    await cli.waitForGone("web-shop")
    expect(cli.screen()).toContain("infra")
    await cli.quit()
  })

  test("filters chats by label", async () => {
    box = createSandbox()
    box.addChat("Trip planning")
    box.addChat("Tax return")

    const cli = await box.launchReady()
    await cli.pressUntil("right", "Trip planning")

    await cli.writeUntilTrue("/", () => !cli.screen().includes("search…"), "the search box to open")
    await cli.type("tax")
    await cli.waitForGone("Trip planning")
    expect(cli.screen()).toContain("Tax return")
    await cli.quit()
  })
})

describe("empty states", () => {
  test("shows the scheduled placeholder", async () => {
    box = createSandbox()
    const cli = await box.launchReady()
    await cli.pressUntil("left", "no scheduled tasks yet")
    await cli.quit()
  })

  test("offers a new chat when there are no sessions at all", async () => {
    box = createSandbox()
    const cli = await box.launchReady()
    await cli.pressUntil("right", "+ New chat")
    await cli.quit()
  })
})
