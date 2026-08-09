# Changelog

All notable changes to this project are documented here.

---

## Unreleased — 2026-08-09

### Highlights

- **Startup is roughly twice as fast, and more on a large history** — time from launch to a usable list drops from ~1.6s to ~0.85s on a typical install (60 sessions, 35 MB of transcripts), and from ~3.1s to ~1.2s on a large one (320 sessions, ~500 MB). With `--no-banner` it is ~0.33s and ~0.69s respectively, down from ~0.64s and ~2.2s. Three things were costing that time:

  - Every transcript was read from disk **twice** and JSON-parsed line by line: once to find the opening prompt, once to find the title. Both facts now come from a single read that decodes only the slices it needs — a bounded prefix for the prompt, and a byte search backwards from the end for the title, which for the majority of transcripts that were never renamed costs no parsing at all.
  - Transcript reads were **synchronous**, which blocked the event loop and left the startup animation frozen rather than playing while the list loaded. They are now async and windowed, which also keeps peak memory flat instead of holding every transcript at once.
  - React and Ink are now **bundled into the published file** and built against React's production build, removing a few hundred milliseconds of module resolution from every launch.

- **The startup animation adapts to how long loading takes** — the intro and the closing beat always play, but the pulse in the middle now loops only while sessions are still loading and is skipped entirely when they are already there, instead of always burning a flat second. It also hands off to the list's own spinner rather than stranding you on the splash if a load runs long. `--no-banner` still skips it altogether.

- **Integration test suite** — the tool is now covered end to end by tests that drive the built CLI exactly as a user does: a real pseudo-terminal, real keystrokes, and a VT emulator interpreting the output, asserted against the rendered screen and the files written to disk. Every session lives in a throwaway `HOME` with a stub `claude` on `PATH`, so tests never touch a real install. Run them with `npm test`; they run on every push and again on the release tag before anything is published.

- **Node 22 is now supported** — the minimum supported version drops from 24 to 22. Nothing in the tool or its dependency tree needed anything newer (`ink` itself declares `>=22`), and CI now runs the full integration suite on both 22 and 24 so the floor is actually exercised rather than assumed.

### Fixes

- Fixed `--mock` being rejected as an unknown option. The flag was implemented but missing from the known-flag list, so the demo mode it enables could never actually be reached.
- Updated the transitive `ws` dependency from 8.20.0 to 8.21.3, clearing two advisories (uninitialized memory disclosure, and a memory-exhaustion denial of service). The fixed versions were already inside the range `ink` asks for, so only the lockfile needed refreshing.

---

## Unreleased — 2026-08-07

### Highlights

- **Star code sessions** — press `s` on a code session to star it. Starred sessions float to the top of their project group and are marked with a `★`, mirroring the pin behaviour chats already had. Stars are stored per profile alongside chat pins, keyed by session id.
- **Export sessions and projects** — press `e` on a session to bundle just that session, or on a project header to bundle every session in the project, into a portable `.tar.gz` written to the current directory. Press `E` to export every session across all projects at once. The archive contains a `manifest.json` recording each session's `cwd` plus the raw `.jsonl` files under `sessions/`, so exports can be moved between machines or restored into the right project later.
- **Import sessions** — press `i` to restore sessions from an exported `.tar.gz`. Each session is placed back into the project recorded in the manifest, and the project is registered in `~/.claude.json` so it shows up immediately. When a session id already exists locally the import pauses and asks per conflict, with the choice to overwrite it, keep the existing one, or switch to overwrite-all / overwrite-none for the remaining conflicts.

### Fixes

- Fixed deleting a session doing nothing on machines without the `trash` command installed. The session vanished from the list but its `.jsonl` was never touched, so it came back the next time the tool was launched. Deletion now falls back to a permanent remove when no `trash`, `trash-put`, or `gio trash` is available, and the list only drops a session once it is actually gone from disk — a failure is reported in the UI instead of being swallowed. The same fallback applies to clean mode, moving a session between projects, and discarding an empty new chat.
- Fixed the title and header block duplicating (stacking up multiple copies) when the terminal was made narrower. The header is now cleared and repainted once per resize instead of being drawn on top of stale, reflowed rows.

---

## Unreleased — 2026-07-20

### Highlights

- Session browsing and resuming now follow Claude Code's own `CLAUDE_CONFIG_DIR` convention, so the tool works with whichever profile you're actually running in instead of always reading the default `~/.claude/projects` — resuming a session lands you back in that same profile rather than the default one. ([7fdd383](https://github.com/kud/claude-sessions-cli/commit/7fdd383e1bf6cfd8c1605acb35e6d7bbb67c79ff))

### Fixes

- Fixed a leak where chats, labels, pins, and tags from every profile were listed together regardless of which profile was active — this state is now scoped per profile, matching the session data itself. ([7fdd383](https://github.com/kud/claude-sessions-cli/commit/7fdd383e1bf6cfd8c1605acb35e6d7bbb67c79ff))
- Unrecognised CLI flags are now rejected with an error instead of being silently swallowed and running the tool against the wrong data with no warning. ([7fdd383](https://github.com/kud/claude-sessions-cli/commit/7fdd383e1bf6cfd8c1605acb35e6d7bbb67c79ff))

### Internal

- Consolidated the README's preview screenshots into a single hero image and removed the unused `next`-tag publish workflow. ([353bbdc](https://github.com/kud/claude-sessions-cli/commit/353bbdc5fb17b87f8f3d312dd04f371738726fa5), [64d5c93](https://github.com/kud/claude-sessions-cli/commit/64d5c9347f88bdea6ca64c737652def904cafd4e))

---

## [2.4.0] — 2026-06-23

### Highlights

- **Move session — folder browser replaces wizard** — pressing `M` on a session in the Code list now drops you straight into a live filesystem folder browser instead of a three-step wizard. Navigate with `↑↓`, `←` to go up a level, `→` to enter a subfolder, and `Enter` to confirm the destination. Folders that already contain Claude sessions are flagged with a dim `sessions` tag. Any directory is a valid target — it does not need to be an existing session folder. `+ New subfolder here…` and `+ Other path…` cover edge cases the browser cannot reach. The move rewrites the session's `cwd` throughout the conversation history and reconciles `~/.claude.json`, while warning about any embedded path references that are intentionally left untouched to avoid corrupting unrelated path prefixes. ([5f99ab6](https://github.com/kud/claude-sessions-cli/commit/5f99ab653fa4b9848fb6a60f42bbf8f11298c83d))

---

## [2.3.0] — 2026-06-22

### Added

- **`--mock` flag** — run `claude-sessions --mock` to launch the TUI with a set of pre-populated fake sessions. Useful for screenshots, demos, and testing UI changes without needing real Claude history.
- **Preview screenshot** — `assets/preview.png` added and wired into the README and docs so visitors see what the TUI looks like immediately.

### Changed

- **README feature list** — expanded to surface recently shipped features: named sessions (`name · prompt` display), the named-only filter (`n`), move (`M`), rename (`r`), delete (`d`), and the correct `--resume`/`--continue`/`--name` flag behaviour on resume.
- **Install instruction simplified** — the docs no longer point to `@next`; the stable `@latest` tag is now the default install path (`npm install -g @kud/claude-sessions-cli`).
- **Homepage updated** — `package.json` homepage now points to `kud.io/projects/claude-sessions-cli` instead of the old GitHub Pages URL.
- **Docs quick-start trimmed** — removed the verbose ASCII-art session-browser example from the docs; the preview image replaces it with something more accurate and easier to maintain.

---

## [2.2.0] — 2026-06-22

### Added

- **Session titles in the code tab** — sessions that have a saved title (set by Claude's `custom-title` event) now display it in **cyan** alongside the opening prompt. This makes it much easier to tell sessions apart at a glance without having to open them.
- **Named-only filter (`n`)** — press `n` while on the Code tab to toggle a filter that hides sessions without a title, leaving only the named ones. The current filter state is shown in the status bar and as a hint in the key legend. The filter resets automatically when you switch tabs.
- **Faster startup animation** — the intro sparkle sequence plays roughly twice as fast, reducing the perceived load time before the session list appears.

### Changed

- Session labels are now cleaned more aggressively before display: leading Markdown heading markers (`#`), list bullets (`-`, `*`, `+`), checkbox syntax (`[ ]`/`[x]`), and inline formatting (`*`, `_`, `` ` ``) are all stripped. This means prompts or titles that were authored in Markdown render as clean plain text rather than showing raw syntax.
- When both a title and a first-prompt are available and they differ, the label is displayed as **title · prompt**, giving you the context of the opening message alongside the session name.
- Manual label overrides (set via the rename wizard) now clear the stored `title` and `prompt` fields so the override is displayed without the dual-part format.
