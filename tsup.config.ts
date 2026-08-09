import { defineConfig } from "tsup"

// Ink imports react-devtools-core, but only behind a `DEV === 'true'` check and
// an `import.meta.resolve` probe — it is opt-in via installing the package
// alongside, and is not a dependency here. esbuild still has to resolve it to
// bundle the branch, so mark it external and let Node resolve it at runtime
// exactly as it does today: present when a developer installed it, absent (and
// never reached) otherwise.
const externaliseDevtools = {
  name: "externalise-react-devtools",
  setup(build: {
    onResolve: (o: { filter: RegExp }, cb: () => unknown) => void
  }) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      external: true,
    }))
  },
}

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  clean: true,
  // React and Ink cost a few hundred milliseconds of module resolution and
  // small file reads on every launch — the largest fixed slice of startup for a
  // tool whose whole job is to appear immediately. Bundling them into the
  // output collapses that into a single read.
  noExternal: [/.*/],
  esbuildPlugins: [externaliseDevtools as never],
  // Left to itself esbuild bundles React's development build, which carries the
  // warning and fiber-instrumentation paths and is both larger to parse and
  // slower to render.
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  // Some of what we now pull in (signal-exit and friends) is CommonJS and calls
  // require() for node builtins. That identifier does not exist in an ESM
  // output, so hand esbuild's interop helper a real one.
  banner: {
    js: [
      `import { createRequire as __createRequire } from "module";`,
      `const require = __createRequire(import.meta.url);`,
    ].join("\n"),
  },
})
