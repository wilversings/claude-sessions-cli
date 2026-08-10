import { readFileSync, writeFileSync } from "fs"
import {
  SESSION_LABELS_FILE,
  SESSION_PINS_FILE,
  SESSION_TAGS_FILE,
} from "./config"

export const loadSessionLabels = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(SESSION_LABELS_FILE, "utf8"))
  } catch {
    return {}
  }
}

export const saveSessionLabel = (key: string, label: string) => {
  const labels = loadSessionLabels()
  labels[key] = label
  writeFileSync(SESSION_LABELS_FILE, JSON.stringify(labels, null, 2))
}

export const removeSessionLabel = (key: string) => {
  const labels = loadSessionLabels()
  if (!(key in labels)) return
  delete labels[key]
  writeFileSync(SESSION_LABELS_FILE, JSON.stringify(labels, null, 2))
}

export const loadSessionPins = (): Set<string> => {
  try {
    return new Set(JSON.parse(readFileSync(SESSION_PINS_FILE, "utf8")))
  } catch {
    return new Set()
  }
}

export const toggleSessionPin = (dir: string) => {
  const pins = loadSessionPins()
  if (pins.has(dir)) pins.delete(dir)
  else pins.add(dir)
  writeFileSync(SESSION_PINS_FILE, JSON.stringify([...pins], null, 2))
}

export const loadSessionTags = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(SESSION_TAGS_FILE, "utf8"))
  } catch {
    return {}
  }
}

export const saveSessionTag = (dir: string, tag: string) => {
  const tags = loadSessionTags()
  if (tag.trim()) tags[dir] = tag.trim()
  else delete tags[dir]
  writeFileSync(SESSION_TAGS_FILE, JSON.stringify(tags, null, 2))
}
