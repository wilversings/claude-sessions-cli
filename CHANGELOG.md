# Changelog

All notable changes to `@wilversings/claude-sessions-cli` are documented here.

This project is a fork of [kud/claude-sessions-cli](https://github.com/kud/claude-sessions-cli), forked at its v2.5.0. Versioning here starts over from this fork's own `1.0.0` and does not continue upstream's numbering — for changes before the fork, see [upstream's changelog](https://github.com/kud/claude-sessions-cli/blob/main/CHANGELOG.md).

---

## [1.0.0] — 2026-08-09

First release published under the `@wilversings/claude-sessions-cli` name.

### Highlights

- **Star code sessions** — press `s` on a code session to star it. Starred sessions float to the top of their project group and are marked with a `★`, mirroring the pin behaviour chats already had. Stars are stored per profile alongside chat pins, keyed by session id.
- **Export sessions and projects** — press `e` on a session to bundle just that session, or on a project header to bundle every session in the project, into a portable `.tar.gz` written to the current directory. Press `E` to export every session across all projects at once. The archive contains a `manifest.json` recording each session's `cwd` plus the raw `.jsonl` files under `sessions/`, so exports can be moved between machines or restored into the right project later.
- **Import sessions** — press `i` to restore sessions from an exported `.tar.gz`. Each session is placed back into the project recorded in the manifest, and the project is registered in `~/.claude.json` so it shows up immediately. When a session id already exists locally the import pauses and asks per conflict, with the choice to overwrite it, keep the existing one, or switch to overwrite-all / overwrite-none for the remaining conflicts.
- **Startup is roughly twice as fast, and more on a large history** — time from launch to a usable list drops from ~1.6s to ~0.85s on a typical install (60 sessions, 35 MB of transcripts), and from ~3.1s to ~1.2s on a large one (320 sessions, ~500 MB). With `--no-banner` it is ~0.33s and ~0.69s respectively, down from ~0.64s and ~2.2s. Three things were costing that time:

  - Every transcript was read from disk **twice** and JSON-parsed line by line: once to find the opening prompt, once to find the title. Both facts now come from a single read that decodes only the slices it needs — a bounded prefix for the prompt, and a byte search backwards from the end for the title, which for the majority of transcripts that were never renamed costs no parsing at all.
  - Transcript reads were **synchronous**, which blocked the event loop and left the startup animation frozen rather than playing while the list loaded. They are now async and windowed, which also keeps peak memory flat instead of holding every transcript at once.
  - React and Ink are now **bundled into the published file** and built against React's production build, removing a few hundred milliseconds of module resolution from every launch.

- **The startup animation adapts to how long loading takes** — the intro and the closing beat always play, but the pulse in the middle now loops only while sessions are still loading and is skipped entirely when they are already there, instead of always burning a flat second. It also hands off to the list's own spinner rather than stranding you on the splash if a load runs long. `--no-banner` still skips it altogether.
- **Integration test suite** — the tool is now covered end to end by tests that drive the built CLI exactly as a user does: a real pseudo-terminal, real keystrokes, and a VT emulator interpreting the output, asserted against the rendered screen and the files written to disk. Every session lives in a throwaway `HOME` with a stub `claude` on `PATH`, so tests never touch a real install. Run them with `npm test`; they run on every push and again on the release tag before anything is published.
- **Node 22 is now supported** — the minimum supported version drops from 24 to 22. Nothing in the tool or its dependency tree needed anything newer (`ink` itself declares `>=22`), and CI now runs the full integration suite on both 22 and 24 so the floor is actually exercised rather than assumed.

### Fixes

- Fixed deleting a session doing nothing on machines without the `trash` command installed. The session vanished from the list but its `.jsonl` was never touched, so it came back the next time the tool was launched. Deletion now falls back to a permanent remove when no `trash`, `trash-put`, or `gio trash` is available, and the list only drops a session once it is actually gone from disk — a failure is reported in the UI instead of being swallowed. The same fallback applies to clean mode, moving a session between projects, and discarding an empty new chat.
- Fixed the title and header block duplicating (stacking up multiple copies) when the terminal was made narrower. The header is now cleared and repainted once per resize instead of being drawn on top of stale, reflowed rows.
- Fixed `--mock` being rejected as an unknown option. The flag was implemented but missing from the known-flag list, so the demo mode it enables could never actually be reached.
- Updated the transitive `ws` dependency from 8.20.0 to 8.21.3, clearing two advisories (uninitialized memory disclosure, and a memory-exhaustion denial of service). The fixed versions were already inside the range `ink` asks for, so only the lockfile needed refreshing.

### Internal

- Renamed the npm package to `@wilversings/claude-sessions-cli` and repointed the repository and homepage links to this fork.
