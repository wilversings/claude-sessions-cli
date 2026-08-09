import { describe, test, expect, afterEach } from "vitest"
import { join } from "path"
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "fs"
import { execFileSync } from "child_process"
import { createSandbox, type Sandbox } from "./helpers/sandbox"
import { waitUntil } from "./helpers/terminal"

let box: Sandbox
afterEach(() => box?.cleanup())

type Manifest = {
  tool: string
  format: number
  sessions: { sessionId: string; file: string; cwd: string; title: string }[]
}

const readManifest = (archive: string): Manifest =>
  JSON.parse(execFileSync("tar", ["-xzOf", archive, "manifest.json"], { encoding: "utf8" }))

const oneArchive = async (b: Sandbox) => {
  const found = await waitUntil(() => b.archives(), (a) => a.length === 1, "an archive to be written")
  return found[0]!
}

describe("export", () => {
  test("e on a session writes a one-session archive", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [id] = box.addProject(proj, [{ prompt: "export me", title: "Exportable" }])

    const cli = await box.launchReady()
    await cli.press("space")
    await cli.waitFor("export me")
    await cli.press("down")
    await cli.write("e")

    await cli.waitFor("exported 1 session")
    const manifest = readManifest(await oneArchive(box))
    expect(manifest.tool).toBe("claude-sessions-cli")
    expect(manifest.sessions).toHaveLength(1)
    expect(manifest.sessions[0]).toMatchObject({ sessionId: id, cwd: proj, title: "Exportable" })
    await cli.quit()
  })

  test("e on a project header exports the whole group", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    box.addProject(proj, [{ prompt: "first" }, { prompt: "second" }])

    const cli = await box.launchReady()
    await cli.waitFor("app (2)")
    await cli.write("e")

    await cli.waitFor("exported 2 sessions")
    expect(readManifest(await oneArchive(box)).sessions).toHaveLength(2)
    await cli.quit()
  })

  test("E exports every session across every project", async () => {
    box = createSandbox()
    const a = join(box.home, "code", "alpha")
    const b = join(box.home, "code", "beta")
    box.addProject(a, [{ prompt: "one" }, { prompt: "two" }])
    box.addProject(b, [{ prompt: "three" }])

    const cli = await box.launchReady()
    await cli.write("E")

    await cli.waitFor("exported 3 sessions")
    const manifest = readManifest(await oneArchive(box))
    expect(manifest.sessions.map((s) => s.cwd).sort()).toEqual([a, a, b].sort())
    await cli.quit()
  })

  test("says so when there is nothing with history to export", async () => {
    box = createSandbox()
    box.addChat("Just a chat")

    const cli = await box.launchReady()
    await cli.write("E")

    await cli.waitFor("nothing to export")
    expect(box.archives()).toHaveLength(0)
    await cli.quit()
  })

  test("any key dismisses the export result", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    box.addProject(proj, [{ prompt: "export me" }])

    const cli = await box.launchReady()
    await cli.write("E")
    await cli.waitFor("exported 1 session")

    await cli.press("enter")
    await cli.waitFor("app")
    await cli.quit()
  })
})

describe("import", () => {
  test("restores a session and re-registers its project", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [id] = box.addProject(proj, [{ prompt: "round trip" }])

    const exporter = await box.launchReady()
    await exporter.write("E")
    await exporter.waitFor("exported 1 session")
    await exporter.quit()

    // Wipe every trace of the session, then bring it back from the archive.
    rmSync(box.historyDir(proj), { recursive: true, force: true })
    box.writeClaudeJson({ projects: {} })

    const cli = await box.launchReady()
    await cli.write("i")
    await cli.waitFor("Import sessions")
    // The newest archive in the working directory is prefilled.
    await cli.press("enter")

    await cli.waitFor("import complete")
    expect(cli.screen()).toContain("1 added")
    expect(existsSync(box.transcriptPath(proj, id!))).toBe(true)
    expect(box.registeredProjects()).toContain(proj)
    await cli.quit()
  })

  test("asks what to do when a session already exists and can overwrite it", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    box.addProject(proj, [{ prompt: "already here" }])

    const exporter = await box.launchReady()
    await exporter.write("E")
    await exporter.waitFor("exported 1 session")
    await exporter.quit()

    const cli = await box.launchReady()
    await cli.write("i")
    await cli.waitFor("Import sessions")
    await cli.press("enter")

    await cli.waitFor("Conflict (1/1)")
    await cli.write("o")

    await cli.waitFor("import complete")
    expect(cli.screen()).toContain("1 overwritten")
    await cli.quit()
  })

  test("keeps the existing session when told to", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    box.addProject(proj, [{ prompt: "already here" }])

    const exporter = await box.launchReady()
    await exporter.write("E")
    await exporter.waitFor("exported 1 session")
    await exporter.quit()

    const cli = await box.launchReady()
    await cli.write("i")
    await cli.waitFor("Import sessions")
    await cli.press("enter")

    await cli.waitFor("Conflict")
    await cli.write("n")

    await cli.waitFor("import complete")
    expect(cli.screen()).toContain("1 kept")
    await cli.quit()
  })

  test("a applies overwrite to every remaining conflict", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    box.addProject(proj, [{ prompt: "first" }, { prompt: "second" }])

    const exporter = await box.launchReady()
    await exporter.write("E")
    await exporter.waitFor("exported 2 sessions")
    await exporter.quit()

    const cli = await box.launchReady()
    await cli.write("i")
    await cli.waitFor("Import sessions")
    await cli.press("enter")

    await cli.waitFor("Conflict (1/2)")
    await cli.write("a")

    await cli.waitFor("import complete")
    expect(cli.screen()).toContain("2 overwritten")
    await cli.quit()
  })

  test("x skips every remaining conflict", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    box.addProject(proj, [{ prompt: "first" }, { prompt: "second" }])

    const exporter = await box.launchReady()
    await exporter.write("E")
    await exporter.waitFor("exported 2 sessions")
    await exporter.quit()

    const cli = await box.launchReady()
    await cli.write("i")
    await cli.waitFor("Import sessions")
    await cli.press("enter")

    await cli.waitFor("Conflict (1/2)")
    await cli.write("x")

    await cli.waitFor("import complete")
    expect(cli.screen()).toContain("2 kept")
    await cli.quit()
  })

  test("reports a missing archive instead of crashing", async () => {
    box = createSandbox()

    const cli = await box.launchReady()
    await cli.write("i")
    await cli.waitFor("Import sessions")
    await cli.type("/definitely/not/here.tar.gz")
    await cli.press("enter")

    await cli.waitFor("import failed")
    expect(cli.screen()).toContain("Archive not found")
    await cli.quit()
  })

  test("rejects a tarball that is not a session export", async () => {
    box = createSandbox()
    // Built from a directory outside the sandbox home, so tar never has to read
    // the archive it is writing.
    const source = join(box.root, "junk-src")
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, "notes.txt"), "not a session export\n")
    execFileSync("tar", ["-czf", join(box.home, "claude-sessions-junk.tar.gz"), "-C", source, "."])

    const cli = await box.launchReady()
    await cli.write("i")
    await cli.waitFor("Import sessions")
    await cli.press("enter")

    await cli.waitFor("import failed")
    expect(cli.screen()).toMatch(/manifest|importable/)
    await cli.quit()
  })

  test("escape backs out of the import prompt", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    box.addProject(proj, [{ prompt: "untouched" }])

    const cli = await box.launchReady()
    await cli.write("i")
    await cli.waitFor("Import sessions")
    await cli.press("escape")

    await cli.waitFor("app")
    await cli.quit()
  })
})

describe("round trip", () => {
  test("an exported transcript comes back byte for byte", async () => {
    box = createSandbox()
    const proj = join(box.home, "code", "app")
    const [id] = box.addProject(proj, [{ prompt: "fidelity check", title: "Fidelity" }])
    const original = readFileSync(box.transcriptPath(proj, id!), "utf8")

    const exporter = await box.launchReady()
    await exporter.write("E")
    await exporter.waitFor("exported 1 session")
    await exporter.quit()

    rmSync(box.historyDir(proj), { recursive: true, force: true })

    const cli = await box.launchReady()
    await cli.write("i")
    await cli.waitFor("Import sessions")
    await cli.press("enter")
    await cli.waitFor("import complete")

    await waitUntil(
      () => existsSync(box.transcriptPath(proj, id!)),
      (there) => there,
      "the transcript to be restored",
    )
    expect(readFileSync(box.transcriptPath(proj, id!), "utf8")).toBe(original)
    await cli.quit()
  })
})
