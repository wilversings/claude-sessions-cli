import React, { useEffect, useState } from "react"
import { Box, Text, useApp, useInput } from "ink"
import type { CleanItem } from "../types"
import { findCleanItems } from "../sessions"
import { Hint } from "./Hint"

export const CleanConfirm = ({
  items,
  onConfirm,
  onCancel,
}: {
  items: CleanItem[] | null
  onConfirm: (selected: CleanItem[]) => void
  onCancel: () => void
}) => {
  const groups = items
    ? [...new Map(items.map((item) => [item.reason, item.reason])).keys()]
    : []

  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (groups.length) setSelected(new Set(groups))
  }, [items])

  useInput(
    (input, key) => {
      if (!items) return
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1))
      if (key.downArrow) setCursor((c) => Math.min(groups.length - 1, c + 1))
      if (input === " ")
        setSelected((s) => {
          const next = new Set(s)
          const reason = groups[cursor]
          if (next.has(reason)) next.delete(reason)
          else next.add(reason)
          return next
        })
      if (input === "a")
        setSelected((s) =>
          s.size === groups.length ? new Set() : new Set(groups),
        )
      if (input === "y")
        onConfirm(items.filter((item) => selected.has(item.reason)))
      if (input === "n" || key.escape) onCancel()
    },
    { isActive: !!items },
  )

  if (!items) return <Text dimColor> scanning…</Text>

  if (!items.length)
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="green"> nothing to clean</Text>
        <Box marginTop={1}>
          <Hint pairs={[["esc", "back"]]} />
        </Box>
      </Box>
    )

  const REASON_COLOR: Record<string, string> = {
    "ghost (directory deleted)": "red",
    "no history": "yellow",
    "orphaned history": "magenta",
  }

  const countByReason = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1
    return acc
  }, {})

  const itemsByReason = items.reduce<Record<string, CleanItem[]>>(
    (acc, item) => {
      ;(acc[item.reason] ??= []).push(item)
      return acc
    },
    {},
  )

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Clean up</Text>
      <Box flexDirection="column" marginTop={1}>
        {groups.map((reason, i) => {
          const sel = i === cursor
          const checked = selected.has(reason)
          const color = REASON_COLOR[reason] ?? "white"
          return (
            <Box key={reason} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
              <Box gap={2}>
                <Text color={sel ? "cyan" : "gray"}>{sel ? "›" : " "}</Text>
                <Text color={checked ? color : "gray"}>
                  {checked ? "[x]" : "[ ]"}
                </Text>
                <Text color={checked ? color : "gray"} bold={checked}>
                  {reason}
                </Text>
                <Text color={checked ? color : "gray"} dimColor>
                  {countByReason[reason]}
                </Text>
              </Box>
              {itemsByReason[reason].map((item) => (
                <Box key={item.label} paddingLeft={6} gap={1}>
                  <Text color={checked ? color : "gray"} dimColor>
                    │
                  </Text>
                  <Text color={checked ? "white" : "gray"} dimColor={!checked}>
                    {item.label}
                  </Text>
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Hint
          pairs={[
            ["↑↓", "nav"],
            ["space", "toggle"],
            ["a", "all"],
            ["y", "confirm"],
            ["n / esc", "cancel"],
          ]}
        />
      </Box>
    </Box>
  )
}

export const CleanApp = () => {
  const { exit } = useApp()
  const [items, setItems] = useState<CleanItem[] | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    findCleanItems().then(setItems)
  }, [])

  if (done) return <Text color="green"> done</Text>

  return (
    <CleanConfirm
      items={items}
      onConfirm={(selected) => {
        for (const item of selected) item.execute()
        setDone(true)
        setTimeout(exit, 300)
      }}
      onCancel={exit}
    />
  )
}
