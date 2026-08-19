const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// `ready` is the session preload. The intro and outro always play so the
// animation reads as deliberate rather than as a glitch, but the pulse between
// them is elastic: it loops while the preload is still running and is skipped
// entirely once it isn't. A warm start therefore spends ~520ms here instead of
// a flat ~950ms. BANNER_BUDGET_MS caps a slow load so we hand off to the list's
// own spinner — which at least shows sessions the moment they land — rather
// than stranding the user on the splash.
const BANNER_BUDGET_MS = 2000

export const runBanner = async (ready?: Promise<unknown>) => {
  const cols = process.stdout.columns ?? 80

  let loaded = ready === undefined
  ready?.then(
    () => {
      loaded = true
    },
    () => {
      loaded = true
    },
  )

  const O = "\x1b[38;5;208m"
  const G = "\x1b[90m"
  const D = "\x1b[2m"
  const R = "\x1b[0m"

  const c = (text: string, vis: number) => {
    const pad = Math.max(0, Math.floor((cols - vis) / 2))
    return " ".repeat(pad) + text
  }

  const sparkle = (bright: boolean) => [
    "",
    c(bright ? `${G}· ${O}✦${G} ·${R}` : `${G}· ✦ ·${R}`, 5),
    c(bright ? `${O}✦ · ✻ · ✦${R}` : `${G}✦ · ${O}✻${G} · ✦${R}`, 9),
    c(bright ? `${G}· ${O}✦${G} ·${R}` : `${G}· ✦ ·${R}`, 5),
    "",
    c(`${O}claude sessions${R}`, 15),
  ]

  const txt = (bright: boolean) =>
    c(bright ? `${O}claude sessions${R}` : `${D}claude sessions${R}`, 15)

  const intro: Array<[string[], number]> = [
    [["", "", "", "", "", txt(false)], 60],
    [["", "", c(`${D}·${R}`, 1), "", "", txt(false)], 50],
    [["", "", c(`${D}${O}✻${R}`, 1), "", "", txt(false)], 50],
    [
      [
        "",
        c(`${G}· · ·${R}`, 5),
        c(`${G}· ✻ ·${R}`, 5),
        c(`${G}· · ·${R}`, 5),
        "",
        txt(false),
      ],
      40,
    ],
    [
      [
        "",
        c(`${G}✦ · ✦${R}`, 5),
        c(`${G}· ${O}✻${G} ·${R}`, 5),
        c(`${G}✦ · ✦${R}`, 5),
        "",
        txt(false),
      ],
      40,
    ],
    [
      [
        "",
        c(`${G}· ${O}✦${G} ·${R}`, 5),
        c(`${O}✦ · ✻ · ✦${R}`, 9),
        c(`${G}· ${O}✦${G} ·${R}`, 5),
        "",
        txt(false),
      ],
      40,
    ],
    [
      [
        "",
        c(`${G}· ${O}✦${G} ·${R}`, 5),
        c(`${O}✦ · ✻ · ✦${R}`, 9),
        c(`${G}· ${O}✦${G} ·${R}`, 5),
        "",
        txt(true),
      ],
      60,
    ],
  ]

  const pulse: Array<[string[], number]> = [
    [sparkle(true), 90],
    [sparkle(false), 80],
    [sparkle(true), 80],
    [sparkle(false), 100],
  ]

  const outro: Array<[string[], number]> = [
    [
      [
        "",
        "",
        c(`${G}· ${O}✻${G} ·${R}`, 5),
        "",
        "",
        c(`${O}claude sessions${R}`, 15),
      ],
      80,
    ],
    // One hold on the settled mark, not two identical frames back to back —
    // redrawing the same image twice only spent 80ms looking like a pause.
    [
      ["", "", c(`${O}✻${R}`, 1), "", "", c(`${O}claude sessions${R}`, 15)],
      100,
    ],
  ]

  const started = Date.now()
  const play = async ([lines, ms]: [string[], number]) => {
    process.stdout.write("\x1b[H\x1b[J" + lines.join("\n"))
    await sleep(ms)
  }

  for (const frame of intro) await play(frame)

  // Loop the pulse only for as long as there is something to wait for, checking
  // after every frame — not just every full cycle — so a load that finishes
  // mid-cycle cuts straight to the outro instead of riding out the rest of it.
  let pulseFrame = 0
  while (!loaded && Date.now() - started < BANNER_BUDGET_MS) {
    await play(pulse[pulseFrame % pulse.length])
    pulseFrame++
  }

  for (const frame of outro) await play(frame)

  process.stdout.write("\x1b[H\x1b[J")
}
