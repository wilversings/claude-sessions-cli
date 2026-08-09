import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Every test builds a temp HOME and drives a real pty, so give them room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Forks keep each pty in its own process; node-pty is unhappy in workers.
    pool: "forks",
    maxWorkers: 4,
    globalSetup: ["tests/helpers/global-setup.ts"],
    reporters: process.env.CI ? ["default", "github-actions"] : ["default"],
  },
})
