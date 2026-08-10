import { basename, join } from "path"
import { homedir } from "os"
import type { Tab } from "./types"

export const HOME = homedir()
const DEFAULT_CONFIG_DIR = join(HOME, ".claude")

export const KNOWN_FLAGS = new Set(["--no-banner", "--mock"])

// Follows Claude Code's own CLAUDE_CONFIG_DIR, so whichever profile the caller
// is in, we browse that profile's sessions. spawnSync inherits our env, so the
// resumed session lands in the same profile too.
export const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || DEFAULT_CONFIG_DIR
export const IS_DEFAULT_PROFILE = CONFIG_DIR === DEFAULT_CONFIG_DIR

export const CLAUDE_PROJECTS = join(CONFIG_DIR, "projects")
// The default profile keeps its config at ~/.claude.json, NOT inside the config
// dir — ~/.claude/.claude.json also exists but is an empty decoy. Every other
// profile does keep it inside. Hence the split rather than one join().
export const CLAUDE_JSON = IS_DEFAULT_PROFILE
  ? join(HOME, ".claude.json")
  : join(CONFIG_DIR, ".claude.json")

// Our own state (chats, labels, pins, tags) is scoped per profile too, so one
// profile's chats never surface in another's list.
export const PROFILE_SUFFIX = basename(CONFIG_DIR).replace(/^\.claude-?/, "")
export const CLAUDE_SESSIONS_DIR = join(
  HOME,
  PROFILE_SUFFIX ? `.claude-sessions-${PROFILE_SUFFIX}` : ".claude-sessions",
)
export const CHATS_DIR = join(CLAUDE_SESSIONS_DIR, "chats")
export const SESSION_LABELS_FILE = join(CLAUDE_SESSIONS_DIR, "session-labels.json")
export const SESSION_PINS_FILE = join(CLAUDE_SESSIONS_DIR, "session-pins.json")
export const SESSION_TAGS_FILE = join(CLAUDE_SESSIONS_DIR, "session-tags.json")

export const ICON_CHAT = "󰭹"
export const ICON_CODE = ""
export const ICON_SCHEDULE = "󰥔"

export const SEL_COLOR = "#FF8C00"

export const TABS: Tab[] = ["code", "chat", "schedule"]
export const TAB_LABEL: Record<Tab, string> = {
  code: "Code",
  chat: "Chat",
  schedule: "Scheduled",
}
export const TAB_ICON: Record<Tab, string> = {
  code: ICON_CODE,
  chat: ICON_CHAT,
  schedule: ICON_SCHEDULE,
}
