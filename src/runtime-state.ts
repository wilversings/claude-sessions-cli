import type { Session, Tab } from "./types"

export let sessionPreload: Promise<Session[]> | null = null
export const setSessionPreload = (p: Promise<Session[]> | null) => {
  sessionPreload = p
}

export type PendingAction = {
  type: string
  dir: string
  sessionId?: string
  name?: string
} | null

export let pendingAction: PendingAction = null
export const setPendingAction = (action: PendingAction) => {
  pendingAction = action
}

export let savedState: { tab: Tab; cursor: number } = { tab: "code", cursor: 0 }
export const setSavedState = (state: { tab: Tab; cursor: number }) => {
  savedState = state
}
