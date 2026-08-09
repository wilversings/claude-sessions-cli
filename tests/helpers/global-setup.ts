import { execFileSync } from "child_process"
import { existsSync } from "fs"
import { join } from "path"

// Tests drive the published artifact — dist/index.js — rather than the source,
// so the build has to run first or they would exercise a stale bundle.
export default function setup() {
  execFileSync("npm", ["run", "build"], { stdio: "inherit" })
  const entry = join(process.cwd(), "dist", "index.js")
  if (!existsSync(entry)) throw new Error(`Build did not produce ${entry}`)
}
