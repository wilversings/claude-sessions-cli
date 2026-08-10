import React, { useState, useEffect, useMemo } from "react"
import { Box, Text, useInput, useApp, useStdout } from "ink"
import TextInput from "ink-text-input"
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "fs"
import { join, dirname } from "path"
import { spawnSync } from "child_process"
import { randomUUID } from "crypto"
import { CHATS_DIR, CLAUDE_JSON, HOME, ICON_CHAT, ICON_CODE, SEL_COLOR, TABS, TAB_ICON, TAB_LABEL } from "../config"
import type { CleanItem, CodeFilter, ImportEntry, Session, Tab } from "../types"
import {
  analyzeSessionMove,
  deleteSession,
  findCleanItems,
  loadSessions,
  moveSession,
  moveToTrash,
  removeFromClaudeJson,
} from "../sessions"
import {
  applyImportEntry,
  extractArchive,
  toExportEntries,
  writeSessionArchive,
} from "../archive"
import { buildDisplayItems, contextHints } from "../display"
import {
  removeSessionLabel,
  saveSessionLabel,
  saveSessionTag,
  toggleSessionPin,
} from "../state"
import { kebabLabel, slugify, windowed } from "../utils"
import {
  savedState,
  sessionPreload,
  setPendingAction,
  setSavedState,
  setSessionPreload,
} from "../runtime-state"
import { Hint } from "./Hint"
import { CleanConfirm } from "./CleanConfirm"

export const App = () => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [loadingIndex, setLoadingIndex] = useState(0)
  const [tab, setTab] = useState<Tab>(savedState.tab)
  const [cursor, setCursor] = useState(savedState.cursor)
  const [mode, setMode] = useState<
    | "list"
    | "search"
    | "new"
    | "rename"
    | "tag"
    | "confirm-delete"
    | "confirm-delete-all"
    | "clean-confirm"
    | "preview-claude-md"
    | "move-dest"
    | "move-dest-input"
    | "move-confirm"
    | "move-done"
    | "export-done"
    | "import-input"
    | "import-conflict"
    | "import-done"
  >("list")
  const [newName, setNewName] = useState("")
  const [renameValue, setRenameValue] = useState("")
  const [search, setSearch] = useState("")
  const [cleanItems, setCleanItems] = useState<CleanItem[] | null>(null)
  const [deleteAllTarget, setDeleteAllTarget] = useState<{
    dir: string
    label: string
    sessions: Session[]
  } | null>(null)
  const [previewContent, setPreviewContent] = useState<string[]>([])
  const [previewScroll, setPreviewScroll] = useState(0)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(),
  )
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set())
  const [tagValue, setTagValue] = useState("")
  const [scrollOffset, setScrollOffset] = useState(0)
  const [codeFilter, setCodeFilter] = useState<CodeFilter>("all")
  const [wizCursor, setWizCursor] = useState(0)
  const [moveSessionSel, setMoveSessionSel] = useState<Session | null>(null)
  const [moveToDir, setMoveToDir] = useState<string | null>(null)
  const [moveDestKind, setMoveDestKind] = useState<"new-subfolder" | "other">(
    "new-subfolder",
  )
  const [moveDestInput, setMoveDestInput] = useState("")
  const [browseDir, setBrowseDir] = useState<string>(HOME)
  const [moveAnalysis, setMoveAnalysis] = useState<{
    lineCount: number
    embeddedRefs: number
  } | null>(null)
  const [moveResult, setMoveResult] = useState<{
    ok: boolean
    error?: string
  } | null>(null)
  const [exportResult, setExportResult] = useState<{
    ok: boolean
    count: number
    path?: string
    error?: string
  } | null>(null)
  const [importPath, setImportPath] = useState("")
  const [importJob, setImportJob] = useState<{
    entries: ImportEntry[]
    index: number
    policy: "ask" | "all" | "none"
    imported: number
    overwritten: number
    skipped: number
    staging: string
  } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const LOADING_MESSAGES = [
    "Summoning your sessions…",
    "Reading the scrolls…",
    "Warming up the neurons…",
    "Herding your sessions…",
    "Consulting the oracle…",
    "Charging up…",
    "Loading memories…",
    "Almost there…",
  ]

  useEffect(() => {
    const p = sessionPreload ?? loadSessions()
    setSessionPreload(null)
    p.then(setSessions)
  }, [])

  useEffect(() => {
    if (sessions) return
    const id = setInterval(
      () => setLoadingIndex((i) => (i + 1) % LOADING_MESSAGES.length),
      600,
    )
    return () => clearInterval(id)
  }, [sessions])

  // Repaint cleanly on terminal resize. Ink erases the previous frame by
  // counting the logical lines it emitted; when the terminal narrows, those
  // lines reflow onto more physical rows than Ink accounts for, so the stale
  // header/tab rows survive and pile up with every SIGWINCH. Wiping the screen
  // and scrollback before forcing a fresh render removes the residue.
  const [, forceResize] = useState(0)
  useEffect(() => {
    const onResize = () => {
      stdout.write("\x1b[2J\x1b[3J\x1b[H")
      forceResize((n) => n + 1)
    }
    stdout.on("resize", onResize)
    return () => {
      stdout.off("resize", onResize)
    }
  }, [stdout])

  const CHROME_ROWS = 10
  const listHeight = Math.max(1, (stdout.rows ?? 24) - CHROME_ROWS)

  const displayItems = useMemo(
    () =>
      sessions
        ? buildDisplayItems(
            tab,
            sessions,
            search,
            expandedProjects,
            expandedTags,
            codeFilter,
          )
        : [],
    [sessions, tab, search, expandedProjects, expandedTags, codeFilter],
  )

  const moveFolders = useMemo(
    () =>
      sessions
        ? [
            ...new Set(
              sessions.filter((s) => s.type === "code").map((s) => s.dir),
            ),
          ]
        : [],
    [sessions],
  )

  const destBrowseFolders = useMemo(() => {
    try {
      return readdirSync(browseDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => join(browseDir, e.name))
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  }, [browseDir])

  useEffect(() => {
    if (cursor < scrollOffset) setScrollOffset(cursor)
    else if (cursor >= scrollOffset + listHeight)
      setScrollOffset(cursor - listHeight + 1)
  }, [cursor, listHeight])

  useEffect(() => {
    setScrollOffset(0)
  }, [tab, search])

  const moveCursor = (dir: 1 | -1) =>
    setCursor((c) => Math.max(0, Math.min(displayItems.length - 1, c + dir)))

  const toggleExpand = (dir: string) =>
    setExpandedProjects((prev) => {
      if (prev.has(dir)) return new Set()
      return new Set([dir])
    })

  const toggleExpandTag = (tag: string) =>
    setExpandedTags((prev) => {
      if (prev.has(tag)) {
        const n = new Set(prev)
        n.delete(tag)
        return n
      }
      return new Set([...prev, tag])
    })

  const cycleTab = (dir: 1 | -1) => {
    const next = TABS[(TABS.indexOf(tab) + dir + TABS.length) % TABS.length]!
    setTab(next)
    setSearch("")
    setCodeFilter("all")
  }

  const doOpen = (session: Session) => {
    setSavedState({ tab, cursor })
    const isChat = session.type === "chat"
    setPendingAction({
      type: isChat
        ? session.claudeProjectDir
          ? "open"
          : "new"
        : session.sessionId
          ? "resume"
          : session.claudeProjectDir
            ? "open"
            : "new",
      dir: session.dir,
      sessionId: !isChat ? session.sessionId : undefined,
    })
    exit()
  }

  // Walk the import queue, applying non-conflicting sessions (and conflicting
  // ones the policy already covers) until it either runs out or hits a conflict
  // that needs the user's call, at which point it parks in "import-conflict".
  type ImportJob = NonNullable<typeof importJob>
  const advanceImport = (job: ImportJob) => {
    let { index, imported, overwritten, skipped } = job
    const { entries, policy, staging } = job
    while (index < entries.length) {
      const e = entries[index]!
      if (!existsSync(e.target)) {
        applyImportEntry(e)
        imported++
        index++
        continue
      }
      if (policy === "all") {
        applyImportEntry(e)
        overwritten++
        index++
        continue
      }
      if (policy === "none") {
        skipped++
        index++
        continue
      }
      // policy === "ask": stop and let the user decide on this one.
      setImportJob({ ...job, index, imported, overwritten, skipped })
      setMode("import-conflict")
      return
    }
    rmSync(staging, { recursive: true, force: true })
    setImportJob({ ...job, index, imported, overwritten, skipped })
    setImportError(null)
    setMode("import-done")
    loadSessions().then(setSessions)
  }

  const startImport = (pathStr: string) => {
    try {
      const { entries, staging } = extractArchive(pathStr.trim())
      advanceImport({
        entries,
        index: 0,
        policy: "ask",
        imported: 0,
        overwritten: 0,
        skipped: 0,
        staging,
      })
    } catch (err) {
      setImportJob(null)
      setImportError(err instanceof Error ? err.message : String(err))
      setMode("import-done")
    }
  }

  useEffect(() => {
    setCursor(0)
  }, [tab])

  useInput(
    (input, key) => {
      if (key.upArrow) moveCursor(-1)
      if (key.downArrow) moveCursor(1)
      if (key.leftArrow) cycleTab(-1)
      if (key.rightArrow) cycleTab(1)
      if (key.tab) cycleTab(1)
      if (input === "/") {
        setMode("search")
        setSearch("")
        setCursor(0)
      }

      if (key.return) {
        const item = displayItems[cursor]
        if (!item) return
        if (item.kind === "new") {
          setMode("new")
          setNewName("")
        } else if (item.kind === "header") {
          doOpen(item.recentSession)
        } else if (item.kind === "session") {
          doOpen(item.session)
        }
      }
      if (input === " ") {
        const item = displayItems[cursor]
        if (item?.kind === "header") toggleExpand(item.dir)
        if (item?.kind === "tag-header") toggleExpandTag(item.label)
      }
      if (input === "d") {
        const item = displayItems[cursor]
        if (item?.kind === "session") setMode("confirm-delete")
        if (item?.kind === "header") {
          const groupSessions = sessions!.filter((s) => s.dir === item.dir)
          setDeleteAllTarget({
            dir: item.dir,
            label: item.label,
            sessions: groupSessions,
          })
          setMode("confirm-delete-all")
        }
      }
      if (input === "r") {
        const item = displayItems[cursor]
        if (
          item?.kind === "session" &&
          (item.session.type === "chat" || item.session.sessionId)
        ) {
          setRenameValue(item.session.label)
          setMode("rename")
        }
      }
      if (input === "f") {
        const item = displayItems[cursor]
        const dir =
          item?.kind === "session" && item.session.type === "chat"
            ? item.session.dir
            : null
        if (dir) spawnSync("open", [dir])
      }
      if (input === "m") {
        const item = displayItems[cursor]
        if (item?.kind === "session" && item.session.hasClaudeMd) {
          try {
            const content = readFileSync(
              join(item.session.dir, "CLAUDE.md"),
              "utf8",
            )
            setPreviewContent(content.split("\n"))
            setPreviewScroll(0)
            setMode("preview-claude-md")
          } catch {}
        }
      }
      if (input === "p") {
        const item = displayItems[cursor]
        if (item?.kind === "session" && item.session.type === "chat") {
          toggleSessionPin(item.session.dir)
          setSessions((prev) =>
            prev
              ? prev.map((s) =>
                  s.dir === item.session.dir ? { ...s, pinned: !s.pinned } : s,
                )
              : prev,
          )
        }
      }
      if (input === "s") {
        const item = displayItems[cursor]
        if (
          item?.kind === "session" &&
          item.session.type === "code" &&
          item.session.sessionId
        ) {
          const id = item.session.sessionId
          toggleSessionPin(id)
          setSessions((prev) =>
            prev
              ? prev.map((s) =>
                  s.sessionId === id ? { ...s, pinned: !s.pinned } : s,
                )
              : prev,
          )
        }
      }
      if (input === "e" || input === "E") {
        const item = displayItems[cursor]
        let toExport: Session[] | null = null
        if (input === "E")
          // Export everything: every session with history on disk, any project.
          toExport = sessions!
        else if (item?.kind === "session" && item.session.type === "code")
          toExport = [item.session]
        else if (item?.kind === "header")
          toExport = sessions!.filter((s) => s.dir === item.dir)
        if (toExport) {
          const entries = toExportEntries(toExport)
          if (!entries.length) {
            setExportResult({ ok: true, count: 0 })
          } else {
            try {
              const path = writeSessionArchive(entries)
              setExportResult({ ok: true, count: entries.length, path })
            } catch (err) {
              setExportResult({
                ok: false,
                count: 0,
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }
          setMode("export-done")
        }
      }
      if (input === "i") {
        // Prefill with the newest export archive in the cwd, if any.
        let def = ""
        try {
          const cwd = process.cwd()
          const newest = readdirSync(cwd)
            .filter((f) => /^claude-sessions-.*\.tar\.gz$/.test(f))
            .map((f) => ({ f, m: statSync(join(cwd, f)).mtimeMs }))
            .sort((a, b) => b.m - a.m)[0]
          if (newest) def = join(cwd, newest.f)
        } catch {}
        setImportPath(def)
        setImportError(null)
        setMode("import-input")
      }
      if (input === "t") {
        const item = displayItems[cursor]
        if (item?.kind === "session" && item.session.type === "chat") {
          setTagValue(item.session.tag ?? "")
          setMode("tag")
        }
      }
      if (input === "n" && tab === "code") {
        setCodeFilter((f) => (f === "all" ? "named" : "all"))
        setCursor(0)
      }
      if (input === "C") {
        setCleanItems(null)
        setMode("clean-confirm")
        findCleanItems().then(setCleanItems)
      }
      if (input === "M") {
        const item = displayItems[cursor]
        if (
          item?.kind === "session" &&
          item.session.type === "code" &&
          item.session.sessionId
        ) {
          setMoveSessionSel(item.session)
          setBrowseDir(dirname(item.session.dir))
          setMoveToDir(null)
          setMoveAnalysis(null)
          setWizCursor(0)
          setMode("move-dest")
        }
      }
      if (input === "q" || key.escape) exit()
    },
    { isActive: mode === "list" && !!sessions },
  )

  useInput(
    (input, key) => {
      if (key.upArrow) moveCursor(-1)
      if (key.downArrow) moveCursor(1)
      if (key.return) {
        const item = displayItems[cursor]
        if (!item) return
        if (item.kind === "new") {
          setSearch("")
          setMode("new")
          setNewName("")
        } else if (item.kind === "session") {
          doOpen(item.session)
        }
      }
      if (key.escape) {
        setSearch("")
        setMode("list")
        setCursor(0)
      }
    },
    { isActive: mode === "search" && !!sessions },
  )

  useInput(
    (input, key) => {
      if (input === "y") {
        const item = displayItems[cursor]
        if (item?.kind === "session") {
          // Only drop the row once the file is actually gone, otherwise the
          // session reappears on the next launch and the list was lying.
          if (deleteSession(item.session)) {
            setDeleteError(null)
            setSessions((s) =>
              s!.filter(
                (x) =>
                  !(
                    x.dir === item.session.dir &&
                    x.sessionId === item.session.sessionId
                  ),
              ),
            )
            setCursor((c) => Math.max(0, c - 1))
          } else {
            setDeleteError(`could not delete ${item.session.label}`)
          }
        }
        setMode("list")
      }
      if (input === "n" || key.escape) setMode("list")
    },
    { isActive: mode === "confirm-delete" },
  )

  useInput(
    (input, key) => {
      if (input === "y" && deleteAllTarget) {
        const claudeProjectDir = deleteAllTarget.sessions[0]?.claudeProjectDir
        const failed = deleteAllTarget.sessions.filter((s) => !deleteSession(s))
        if (claudeProjectDir && !failed.length) moveToTrash(claudeProjectDir)
        if (failed.length) {
          setDeleteError(
            `could not delete ${failed.length} of ${deleteAllTarget.sessions.length} sessions in ${deleteAllTarget.label}`,
          )
          // Drop only the ones that really went away; the rest stay visible.
          setSessions((s) =>
            s!.filter(
              (x) =>
                x.dir !== deleteAllTarget.dir ||
                failed.some((f) => f.sessionId === x.sessionId),
            ),
          )
        } else {
          setDeleteError(null)
          removeFromClaudeJson(deleteAllTarget.dir)
          removeSessionLabel(deleteAllTarget.dir)
          setSessions((s) => s!.filter((x) => x.dir !== deleteAllTarget.dir))
        }
        setCursor((c) => Math.max(0, c - 1))
        setDeleteAllTarget(null)
        setMode("list")
      }
      if (input === "n" || key.escape) {
        setDeleteAllTarget(null)
        setMode("list")
      }
    },
    { isActive: mode === "confirm-delete-all" },
  )

  useInput(
    (_, key) => {
      if (key.escape) setMode("list")
    },
    {
      isActive:
        mode === "new" ||
        mode === "rename" ||
        mode === "tag" ||
        mode === "import-input",
    },
  )

  useInput(
    (_, key) => {
      if (key.upArrow) setPreviewScroll((s) => Math.max(0, s - 1))
      if (key.downArrow)
        setPreviewScroll((s) =>
          Math.min(Math.max(0, previewContent.length - listHeight), s + 1),
        )
      if (key.escape) setMode("list")
    },
    { isActive: mode === "preview-claude-md" },
  )

  const goToMoveConfirm = (toDir: string) => {
    if (!moveSessionSel?.sessionId) return
    setMoveToDir(toDir)
    setMoveAnalysis(
      analyzeSessionMove(moveSessionSel.sessionId, moveSessionSel.dir),
    )
    setMode("move-confirm")
  }

  useInput(
    (_, key) => {
      const hasParent = dirname(browseDir) !== browseDir
      const parentOffset = hasParent ? 1 : 0
      const length = parentOffset + destBrowseFolders.length + 2
      if (key.upArrow) setWizCursor((c) => Math.max(0, c - 1))
      if (key.downArrow) setWizCursor((c) => Math.min(length - 1, c + 1))
      if (key.escape) setMode("list")
      if (key.leftArrow && hasParent) {
        setBrowseDir(dirname(browseDir))
        setWizCursor(0)
        return
      }
      if (key.rightArrow) {
        const folder = destBrowseFolders[wizCursor - parentOffset]
        if (wizCursor >= parentOffset && folder) {
          setBrowseDir(folder)
          setWizCursor(0)
        }
        return
      }
      if (key.return) {
        if (hasParent && wizCursor === 0) {
          setBrowseDir(dirname(browseDir))
          setWizCursor(0)
          return
        }
        const folderIdx = wizCursor - parentOffset
        if (folderIdx < destBrowseFolders.length) {
          const dir = destBrowseFolders[folderIdx]
          if (dir) goToMoveConfirm(dir)
        } else {
          setMoveDestKind(
            folderIdx === destBrowseFolders.length ? "new-subfolder" : "other",
          )
          setMoveDestInput("")
          setMode("move-dest-input")
        }
      }
    },
    { isActive: mode === "move-dest" },
  )

  useInput(
    (_, key) => {
      if (key.escape) setMode("move-dest")
    },
    { isActive: mode === "move-dest-input" },
  )

  useInput(
    (input, key) => {
      if (input === "y" && moveSessionSel?.sessionId && moveToDir) {
        const result = moveSession(
          moveSessionSel.sessionId,
          moveSessionSel.dir,
          moveToDir,
        )
        setMoveResult(result)
        if (result.ok) loadSessions().then(setSessions)
        setMode("move-done")
      }
      if (input === "n" || key.escape) setMode("move-dest")
    },
    { isActive: mode === "move-confirm" },
  )

  useInput(
    (_, key) => {
      if (key.return || key.escape) {
        setMoveResult(null)
        setMoveSessionSel(null)
        setMoveToDir(null)
        setMoveAnalysis(null)
        setWizCursor(0)
        setCursor(0)
        setMode("list")
      }
    },
    { isActive: mode === "move-done" },
  )

  useInput(
    () => {
      setExportResult(null)
      setMode("list")
    },
    { isActive: mode === "export-done" },
  )

  useInput(
    (input, key) => {
      if (key.escape) {
        setMode("import-input")
        return
      }
      const job = importJob
      if (!job) return
      const e = job.entries[job.index]!
      const next = job.index + 1
      // o: overwrite this one · n: skip this one · a: overwrite all · x: skip all
      if (input === "o") {
        applyImportEntry(e)
        advanceImport({ ...job, index: next, overwritten: job.overwritten + 1 })
      } else if (input === "n") {
        advanceImport({ ...job, index: next, skipped: job.skipped + 1 })
      } else if (input === "a") {
        applyImportEntry(e)
        advanceImport({
          ...job,
          index: next,
          overwritten: job.overwritten + 1,
          policy: "all",
        })
      } else if (input === "x") {
        advanceImport({
          ...job,
          index: next,
          skipped: job.skipped + 1,
          policy: "none",
        })
      }
    },
    { isActive: mode === "import-conflict" },
  )

  useInput(
    () => {
      setImportJob(null)
      setImportError(null)
      setMode("list")
    },
    { isActive: mode === "import-done" },
  )

  const isSearching = mode === "search"
  const visibleItems =
    mode === "list" || mode === "search"
      ? displayItems.slice(scrollOffset, scrollOffset + listHeight)
      : []

  const renderContent = () => {
    if (!sessions)
      return (
        <Box paddingX={2} gap={1}>
          <Text color={SEL_COLOR}>✻</Text>
          <Text dimColor>{LOADING_MESSAGES[loadingIndex]}</Text>
        </Box>
      )

    if (mode === "new")
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text bold>New chat</Text>
          <Box marginTop={1} gap={1}>
            <Text color="cyan">›</Text>
            <TextInput
              value={newName}
              onChange={setNewName}
              onSubmit={(val) => {
                if (!val.trim()) {
                  setMode("list")
                  return
                }
                const dir = join(CHATS_DIR, randomUUID())
                saveSessionLabel(dir, val.trim())
                setSavedState({ tab, cursor })
                setPendingAction({ type: "new", dir, name: val.trim() })
                exit()
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Hint pairs={[["esc", "cancel"]]} />
          </Box>
        </Box>
      )

    if (mode === "import-input")
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text bold>Import sessions</Text>
          <Text dimColor>path to a .tar.gz exported by this tool</Text>
          <Box marginTop={1} gap={1}>
            <Text color="cyan">›</Text>
            <TextInput
              value={importPath}
              onChange={setImportPath}
              onSubmit={(val) => {
                if (!val.trim()) {
                  setMode("list")
                  return
                }
                startImport(val)
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Hint pairs={[
              ["enter", "import"],
              ["esc", "cancel"],
            ]} />
          </Box>
        </Box>
      )

    if (mode === "rename") {
      const item = displayItems[cursor]
      const session = item?.kind === "session" ? item.session : null
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text bold>Rename</Text>
          {session && <Text dimColor>{session.path}</Text>}
          <Box marginTop={1} gap={1}>
            <Text color="cyan">›</Text>
            <TextInput
              value={renameValue}
              onChange={setRenameValue}
              onSubmit={(val) => {
                if (!val.trim() || !session) {
                  setMode("list")
                  return
                }
                const key =
                  session.type === "chat" ? session.dir : session.sessionId
                if (!key) {
                  setMode("list")
                  return
                }
                saveSessionLabel(key, val.trim())
                setSessions((prev) =>
                  prev
                    ? prev.map((s) =>
                        (
                          session.type === "chat"
                            ? s.dir === session.dir
                            : s.sessionId === session.sessionId
                        )
                          ? { ...s, label: val.trim() }
                          : s,
                      )
                    : prev,
                )
                setMode("list")
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>enter to save · esc to cancel</Text>
          </Box>
        </Box>
      )
    }

    if (mode === "tag") {
      const item = displayItems[cursor]
      const session = item?.kind === "session" ? item.session : null
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text bold>Tag</Text>
          {session && <Text dimColor>{session.label}</Text>}
          <Box marginTop={1} gap={1}>
            <Text color="cyan">›</Text>
            <TextInput
              value={tagValue}
              onChange={setTagValue}
              onSubmit={(val) => {
                if (!session) {
                  setMode("list")
                  return
                }
                saveSessionTag(session.dir, val)
                setSessions((prev) =>
                  prev
                    ? prev.map((s) =>
                        s.dir === session.dir
                          ? { ...s, tag: val.trim() || undefined }
                          : s,
                      )
                    : prev,
                )
                setMode("list")
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              enter to save · empty to remove · esc to cancel
            </Text>
          </Box>
        </Box>
      )
    }

    if (mode === "confirm-delete") {
      const item = displayItems[cursor]
      const session = item?.kind === "session" ? item.session : null
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text>
            Remove{" "}
            <Text color="red" bold>
              {session?.label ?? ""}
            </Text>
            ?
          </Text>
          {session && <Text dimColor>{session.path}</Text>}
          <Box marginTop={1}>
            <Hint
              pairs={[
                ["y", "confirm"],
                ["n / esc", "cancel"],
              ]}
            />
          </Box>
        </Box>
      )
    }

    if (mode === "confirm-delete-all" && deleteAllTarget)
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text>
            Delete all{" "}
            <Text color="red" bold>
              {deleteAllTarget.sessions.length}
            </Text>{" "}
            sessions for{" "}
            <Text color="red" bold>
              {deleteAllTarget.label}
            </Text>
            ?
          </Text>
          {deleteAllTarget.sessions[0]?.sessionId && (
            <Text dimColor>
              session history only — project folder is untouched
            </Text>
          )}
          <Box flexDirection="column" marginTop={1}>
            {deleteAllTarget.sessions.map((s) => (
              <Box key={s.sessionId ?? s.label} gap={1}>
                <Text color="gray">·</Text>
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text dimColor wrap="truncate-end">
                    {s.label}
                  </Text>
                </Box>
                <Box flexShrink={0} minWidth={9} justifyContent="flex-end">
                  <Text dimColor>{s.ago}</Text>
                </Box>
              </Box>
            ))}
          </Box>
          <Box marginTop={1}>
            <Hint
              pairs={[
                ["y", "confirm"],
                ["n / esc", "cancel"],
              ]}
            />
          </Box>
        </Box>
      )

    if (mode === "preview-claude-md") {
      const visibleLines = previewContent.slice(
        previewScroll,
        previewScroll + listHeight,
      )
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text bold>CLAUDE.md</Text>
          <Box flexDirection="column" marginTop={1}>
            {visibleLines.map((line, i) => (
              <Text key={previewScroll + i} wrap="truncate-end">
                {line || " "}
              </Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Hint
              pairs={[
                ["↑↓", "scroll"],
                ["esc", "close"],
              ]}
            />
          </Box>
        </Box>
      )
    }

    const moveHeader = (subtitle?: string) => (
      <>
        <Text bold>
          Move session <Text dimColor>· choose destination</Text>
        </Text>
        {subtitle && (
          <Text dimColor wrap="truncate-end">
            {subtitle}
          </Text>
        )}
      </>
    )

    if (mode === "move-dest") {
      const hasParent = dirname(browseDir) !== browseDir
      const sessionDirs = new Set(moveFolders)
      const rows = [
        ...(hasParent ? [{ kind: "up" as const }] : []),
        ...destBrowseFolders.map((dir) => ({ kind: "folder" as const, dir })),
        { kind: "new" as const },
        { kind: "other" as const },
      ]
      const { start, items } = windowed(rows, wizCursor, listHeight)
      return (
        <Box flexDirection="column" paddingX={2}>
          {moveHeader(moveSessionSel?.label)}
          <Text dimColor>in {browseDir.replace(HOME, "~")}</Text>
          <Box flexDirection="column" marginTop={1}>
            {items.map((row, vi) => {
              const i = start + vi
              const sel = i === wizCursor
              const isSpecial = row.kind === "new" || row.kind === "other"
              const label =
                row.kind === "up"
                  ? "../"
                  : row.kind === "folder"
                    ? `${kebabLabel(row.dir)}/`
                    : row.kind === "new"
                      ? "+ New subfolder here…"
                      : "+ Other path…"
              const hasSessions =
                row.kind === "folder" && sessionDirs.has(row.dir)
              return (
                <Box key={i} gap={1}>
                  <Text color={sel ? "green" : "gray"}>{sel ? "›" : " "}</Text>
                  <Box flexGrow={1} flexShrink={1} minWidth={0}>
                    <Text
                      color={
                        sel
                          ? SEL_COLOR
                          : isSpecial
                            ? "cyan"
                            : row.kind === "up"
                              ? "gray"
                              : "white"
                      }
                      wrap="truncate-end"
                    >
                      {label}
                    </Text>
                  </Box>
                  {hasSessions && <Text dimColor>sessions</Text>}
                </Box>
              )
            })}
          </Box>
          <Box marginTop={1}>
            <Hint
              pairs={[
                ["↑↓", "nav"],
                ["→", "open"],
                ["←", "up"],
                ["enter", "select"],
                ["esc", "back"],
              ]}
            />
          </Box>
        </Box>
      )
    }

    if (mode === "move-dest-input") {
      const isSub = moveDestKind === "new-subfolder"
      return (
        <Box flexDirection="column" paddingX={2}>
          {moveHeader()}
          <Text dimColor>
            {isSub
              ? `New subfolder of ${browseDir.replace(HOME, "~")} (kebab-case)`
              : "Destination path (absolute, ~ allowed)"}
          </Text>
          <Box marginTop={1} gap={1}>
            <Text color="cyan">›</Text>
            <TextInput
              value={moveDestInput}
              onChange={setMoveDestInput}
              onSubmit={(val) => {
                const trimmed = val.trim()
                if (!trimmed) {
                  setMode("move-dest")
                  return
                }
                if (isSub) {
                  const slug = slugify(trimmed)
                  if (!slug) {
                    setMode("move-dest")
                    return
                  }
                  goToMoveConfirm(join(browseDir, slug))
                } else {
                  const toDir = trimmed.replace(/^~(?=$|\/)/, HOME)
                  if (!toDir.startsWith("/")) {
                    setMode("move-dest")
                    return
                  }
                  goToMoveConfirm(toDir)
                }
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>enter to continue · esc to go back</Text>
          </Box>
        </Box>
      )
    }

    if (mode === "move-confirm" && moveSessionSel && moveToDir) {
      const refs = moveAnalysis?.embeddedRefs ?? 0
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text>
            Move{" "}
            <Text color={SEL_COLOR} bold>
              {moveSessionSel.label}
            </Text>
            ?
          </Text>
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>from {moveSessionSel.dir.replace(HOME, "~")}</Text>
            <Text dimColor>to {moveToDir.replace(HOME, "~")}</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>
              rewrites cwd on {moveAnalysis?.lineCount ?? 0} lines · updates{" "}
              {CLAUDE_JSON.replace(HOME, "~")}
            </Text>
            {refs > 0 && (
              <Text color="yellow">
                ⚠ {refs} embedded path reference{refs === 1 ? "" : "s"} to the
                old folder won't be rewritten
              </Text>
            )}
          </Box>
          <Box marginTop={1}>
            <Hint
              pairs={[
                ["y", "move"],
                ["n / esc", "back"],
              ]}
            />
          </Box>
        </Box>
      )
    }

    if (mode === "move-done")
      return (
        <Box flexDirection="column" paddingX={2}>
          {moveResult?.ok ? (
            <>
              <Text color="green">✓ moved</Text>
              <Text dimColor>now under {moveToDir?.replace(HOME, "~")}</Text>
              <Text dimColor>resume it from the Code list</Text>
            </>
          ) : (
            <>
              <Text color="red">✗ move failed</Text>
              <Text dimColor>{moveResult?.error ?? "unknown error"}</Text>
            </>
          )}
          <Box marginTop={1}>
            <Hint pairs={[["enter / esc", "back"]]} />
          </Box>
        </Box>
      )

    if (mode === "export-done")
      return (
        <Box flexDirection="column" paddingX={2}>
          {exportResult?.ok && exportResult.count > 0 ? (
            <>
              <Text color="green">
                ✓ exported {exportResult.count} session
                {exportResult.count === 1 ? "" : "s"}
              </Text>
              <Text dimColor>{exportResult.path?.replace(HOME, "~")}</Text>
            </>
          ) : exportResult?.ok ? (
            <>
              <Text color="yellow">nothing to export</Text>
              <Text dimColor>no sessions with history on disk</Text>
            </>
          ) : (
            <>
              <Text color="red">✗ export failed</Text>
              <Text dimColor>{exportResult?.error ?? "unknown error"}</Text>
            </>
          )}
          <Box marginTop={1}>
            <Hint pairs={[["any key", "back"]]} />
          </Box>
        </Box>
      )

    if (mode === "import-conflict" && importJob) {
      const e = importJob.entries[importJob.index]!
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text bold color="yellow">
            Conflict ({importJob.index + 1}/{importJob.entries.length})
          </Text>
          <Text dimColor>a session already exists at this location:</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text dimColor>project </Text>
              {e.cwd.replace(HOME, "~")}
            </Text>
            <Text>
              <Text dimColor>session </Text>
              {e.sessionId}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Hint
              pairs={[
                ["o", "overwrite"],
                ["n", "keep existing"],
                ["a", "overwrite all"],
                ["x", "overwrite none"],
                ["esc", "cancel"],
              ]}
            />
          </Box>
        </Box>
      )
    }

    if (mode === "import-done")
      return (
        <Box flexDirection="column" paddingX={2}>
          {importError ? (
            <>
              <Text color="red">✗ import failed</Text>
              <Text dimColor>{importError}</Text>
            </>
          ) : (
            <>
              <Text color="green">✓ import complete</Text>
              <Text dimColor>
                {importJob?.imported ?? 0} added · {importJob?.overwritten ?? 0}{" "}
                overwritten · {importJob?.skipped ?? 0} kept
              </Text>
            </>
          )}
          <Box marginTop={1}>
            <Hint pairs={[["any key", "back"]]} />
          </Box>
        </Box>
      )

    if (mode === "clean-confirm")
      return (
        <CleanConfirm
          items={cleanItems}
          onConfirm={(selected) => {
            for (const item of selected) item.execute()
            setMode("list")
            loadSessions().then(setSessions)
          }}
          onCancel={() => setMode("list")}
        />
      )

    return (
      <>
        {tab === "schedule" && displayItems.length === 0 && (
          <Box paddingX={2} gap={1}>
            <Text color="blue">i</Text>
            <Text>no scheduled tasks yet</Text>
          </Box>
        )}
        {visibleItems.map((item, vi) => {
          const i = scrollOffset + vi
          const sel = i === cursor
          if (item.kind === "new") {
            return (
              <Box key="new" flexDirection="column">
                <Box paddingX={2} gap={1}>
                  <Text color={sel ? "green" : "gray"}>{sel ? "›" : " "}</Text>
                  <Text color={sel ? SEL_COLOR : "white"} bold={sel}>
                    + New chat
                  </Text>
                </Box>
                <Text> </Text>
              </Box>
            )
          }
          if (item.kind === "header") {
            return (
              <Box key={`h-${item.dir}`} paddingLeft={2} gap={1}>
                <Text color={sel ? "green" : "gray"}>{sel ? "›" : " "}</Text>
                <Text color="gray">{item.expanded ? "-" : "+"}</Text>
                <Text color={sel ? SEL_COLOR : "green"}>{ICON_CODE}</Text>
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text
                    color={sel ? SEL_COLOR : "white"}
                    bold
                    wrap="truncate-end"
                  >
                    {item.label}
                    {item.count > 1 && (
                      <Text
                        color={sel ? SEL_COLOR : "gray"}
                      >{` (${item.count})`}</Text>
                    )}
                  </Text>
                </Box>
                {!item.expanded && (
                  <Box flexShrink={0} minWidth={9} justifyContent="flex-end">
                    <Text dimColor>{item.recentSession.ago}</Text>
                  </Box>
                )}
              </Box>
            )
          }
          if (item.kind === "tag-header") {
            return (
              <Box key={`tag-${item.label}`} paddingLeft={2} gap={1}>
                <Text color={sel ? "green" : "gray"}>{sel ? "›" : " "}</Text>
                <Text color="gray">{item.expanded ? "-" : "+"}</Text>
                <Text color={sel ? SEL_COLOR : "blue"}>#</Text>
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text
                    color={sel ? SEL_COLOR : "white"}
                    bold
                    wrap="truncate-end"
                  >
                    {item.label}
                    {item.count > 1 && (
                      <Text
                        color={sel ? SEL_COLOR : "gray"}
                      >{` (${item.count})`}</Text>
                    )}
                  </Text>
                </Box>
              </Box>
            )
          }
          const s = item.session
          const indent = tab === "code" ? 6 : !s.pinned && s.tag ? 4 : 2
          return (
            <Box
              key={`${s.dir}-${s.sessionId ?? s.label}`}
              paddingLeft={indent}
              gap={1}
            >
              {s.type === "chat" ? (
                <>
                  <Text color={sel ? "green" : "gray"}>{sel ? "›" : " "}</Text>
                  <Text color={sel ? SEL_COLOR : "magenta"}>{ICON_CHAT}</Text>
                </>
              ) : (
                <Text
                  color={sel ? "green" : s.pinned ? "yellow" : "gray"}
                  bold={s.pinned}
                >
                  {sel ? "›" : s.pinned ? "★" : "·"}
                </Text>
              )}
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                {s.type === "code" && s.title && s.prompt ? (
                  <Text wrap="truncate-end">
                    <Text color={sel ? SEL_COLOR : "cyan"} bold>
                      {s.title}
                    </Text>
                    <Text color={sel ? SEL_COLOR : "white"}> · {s.prompt}</Text>
                  </Text>
                ) : (
                  <Text
                    color={sel ? SEL_COLOR : "white"}
                    bold={s.type === "chat"}
                    wrap="truncate-end"
                  >
                    {s.label}
                  </Text>
                )}
              </Box>
              {s.pinned && (
                <Box flexShrink={0} marginRight={1}>
                  <Text color="yellow" bold>
                    ★
                  </Text>
                </Box>
              )}
              {s.hasClaudeMd && (
                <Box flexShrink={0} marginRight={1}>
                  <Text color={sel ? "cyan" : "gray"} dimColor={!sel}>
                    md
                  </Text>
                </Box>
              )}
              <Box flexShrink={0} minWidth={9} justifyContent="flex-end">
                <Text dimColor>{s.ago}</Text>
              </Box>
            </Box>
          )
        })}
        {deleteError && (
          <Box marginTop={1} paddingX={2} gap={1}>
            <Text color="red">✗</Text>
            <Text color="red">{deleteError}</Text>
          </Box>
        )}
        <Box marginTop={1} paddingX={2}>
          <Hint
            pairs={[
              ...contextHints(displayItems[cursor]),
              ...(tab === "code"
                ? ([
                    ["n", codeFilter === "named" ? "all" : "named"],
                    ["E", "export all"],
                    ["i", "import"],
                  ] as [string, string][])
                : []),
            ]}
          />
        </Box>
      </>
    )
  }

  return (
    <Box flexDirection="column" paddingY={1} width={stdout.columns}>
      <Box paddingX={2} gap={1} marginBottom={1}>
        <Text color={SEL_COLOR}>✻</Text>
        <Text bold>Claude</Text>
      </Box>
      <Box paddingX={2} gap={3} marginBottom={1}>
        {TABS.map((t) => (
          <Box key={t} gap={1}>
            <Text color={tab === t ? SEL_COLOR : "gray"}>{TAB_ICON[t]}</Text>
            <Text
              color={tab === t ? SEL_COLOR : "gray"}
              bold={tab === t}
              underline={tab === t}
            >
              {TAB_LABEL[t]}
            </Text>
          </Box>
        ))}
      </Box>
      <Box paddingX={2} marginBottom={1} gap={1}>
        <Text dimColor>/</Text>
        {isSearching ? (
          <TextInput
            value={search}
            onChange={(v) => {
              setSearch(v)
              setCursor(0)
            }}
            onSubmit={() => {}}
          />
        ) : (
          <Text dimColor>{search || "search…"}</Text>
        )}
        {tab === "code" && codeFilter === "named" && (
          <Text color={SEL_COLOR}>named</Text>
        )}
      </Box>
      {renderContent()}
    </Box>
  )
}
