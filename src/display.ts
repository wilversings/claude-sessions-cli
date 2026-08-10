import type { CodeFilter, DisplayItem, Session, Tab } from "./types"

export const buildDisplayItems = (
  tab: Tab,
  sessions: Session[],
  search: string,
  expandedProjects: Set<string>,
  expandedTags: Set<string>,
  codeFilter: CodeFilter = "all",
): DisplayItem[] => {
  const match = (s: Session) =>
    !search ||
    s.label.toLowerCase().includes(search.toLowerCase()) ||
    s.path.toLowerCase().includes(search.toLowerCase())

  if (tab === "chat") {
    const filtered = sessions.filter((s) => s.type === "chat").filter(match)
    const pinned = filtered.filter((s) => s.pinned)
    const tagged = filtered.filter((s) => !s.pinned && s.tag)
    const untagged = filtered.filter((s) => !s.pinned && !s.tag)

    const items: DisplayItem[] = [{ kind: "new" }]

    for (const s of pinned) items.push({ kind: "session", session: s })

    const tagGroups = new Map<string, Session[]>()
    for (const s of tagged) {
      if (!tagGroups.has(s.tag!)) tagGroups.set(s.tag!, [])
      tagGroups.get(s.tag!)!.push(s)
    }
    for (const [tag, group] of tagGroups) {
      const expanded = expandedTags.has(tag)
      items.push({
        kind: "tag-header",
        label: tag,
        expanded,
        count: group.length,
      })
      if (expanded)
        for (const s of group) items.push({ kind: "session", session: s })
    }

    for (const s of untagged) items.push({ kind: "session", session: s })

    return items
  }

  if (tab === "schedule") {
    return []
  }

  const filtered = sessions
    .filter((s) => s.type === "code")
    .filter(match)
    .filter((s) => codeFilter === "all" || Boolean(s.title))
  const groups = new Map<string, Session[]>()
  for (const s of filtered) {
    if (!groups.has(s.dir)) groups.set(s.dir, [])
    groups.get(s.dir)!.push(s)
  }
  const items: DisplayItem[] = []
  for (const [dir, group] of groups) {
    // `recent` stays the most-recent session (groups arrive mtime-first) so
    // opening a collapsed header still resumes the latest work. Starred
    // sessions then float to the top of the expanded list.
    const recent = group[0]!
    group.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    const expanded = expandedProjects.has(dir)
    items.push({
      kind: "header",
      label: recent.projectLabel ?? recent.path,
      dir,
      expanded,
      count: group.length,
      recentSession: recent,
    })
    if (expanded) {
      for (const s of group) items.push({ kind: "session", session: s })
    }
  }
  return items
}

export const contextHints = (item: DisplayItem | undefined): [string, string][] => {
  const nav: [string, string][] = [
    ["↑↓", "nav"],
    ["←→", "tab"],
  ]
  if (item?.kind === "new")
    return [...nav, ["enter", "new chat"], ["/", "search"], ["q", "quit"]]
  if (item?.kind === "header")
    return [
      ...nav,
      ["enter", "open"],
      ["space", item.expanded ? "collapse" : "expand"],
      ["e", "export"],
      ["d", "delete all"],
      ["q", "quit"],
    ]
  if (item?.kind === "tag-header")
    return [
      ...nav,
      ["space", item.expanded ? "collapse" : "expand"],
      ["q", "quit"],
    ]
  if (item?.kind === "session") {
    const s = item.session
    const pairs: [string, string][] = [
      ...nav,
      ["enter", "open"],
      ["d", "delete"],
    ]
    if (s.type === "chat") {
      pairs.push(["p", s.pinned ? "unpin" : "pin"])
      pairs.push(["t", "tag"])
    } else if (s.sessionId) {
      pairs.push(["s", s.pinned ? "unstar" : "star"])
      pairs.push(["e", "export"])
      pairs.push(["r", "rename"])
      pairs.push(["M", "move"])
    }
    if (s.hasClaudeMd) pairs.push(["m", "md"])
    pairs.push(["q", "quit"])
    return pairs
  }
  return [...nav, ["/", "search"], ["q", "quit"]]
}
