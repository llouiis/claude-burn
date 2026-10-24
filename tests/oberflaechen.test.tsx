import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionMeasureInput } from 'claude-code'

import { SCENE_SVG } from '../hooks/clawd'

// Die Apps (desktop, vscode, mobile) zählen bodyColumns in Zeichen ihrer Code-Schrift.
// Hier geht es um die Leiste und das Fenster dort: Clawd bleibt, nichts bricht um,
// desktop und vscode zeichnen bei gleicher Breite dasselbe.

const BAND = {
  plugin: 'nutzung',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 130,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'nutzung',
  component: 'Pane',
  requestId: 'statistik',
  props: {
    title: 'Usage',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

// Freitag, 23.10.2026, 15:42 UTC.
const NOW = Date.UTC(2026, 9, 23, 15, 42)

const measure: SessionMeasureInput = {
  context: { window: 200_000, tokens: 56_300, percent: 28 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 34, resetsAt: '2026-10-23T16:40:00Z' },
    { kind: 'seven_day', percentUsed: 12.5, resetsAt: '2026-10-27T08:00:00Z' },
  ],
  cost: { usd: 1.23456 },
  changed: ['context', 'rateLimits', 'cost'],
}

const CACHE = {
  lastComputedDate: '2026-10-22',
  firstSessionDate: '2026-10-09T18:31:19.964Z',
  dailyActivity: [
    { date: '2026-10-09', messageCount: 276, sessionCount: 12, toolCallCount: 17 },
    { date: '2026-10-18', messageCount: 2932, sessionCount: 12, toolCallCount: 633 },
  ],
  dailyModelTokens: [
    { date: '2026-10-09', tokensByModel: { 'claude-sonnet-5-5': 2_600_000 } },
    { date: '2026-10-18', tokensByModel: { 'claude-opus-5-5': 1_200_000_000 } },
  ],
  modelUsage: {
    'claude-opus-5-5': {
      inputTokens: 11_000,
      outputTokens: 8_100_000,
      cacheReadInputTokens: 1_300_000_000,
      cacheCreationInputTokens: 27_000_000,
    },
  },
  longestSession: { duration: 368_672_039 },
  hourCounts: { '20': 13 },
}

// Nichts liegt unter dem Plugin: diese Hooks stehen für Claude Code selbst.
function engine(on: On) {
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: NOW - 183_000, context: { window: 200_000 }, rateLimits: [] },
  }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/louis' })
  on('fs.read', (_, e) => {
    if (e.path !== '/home/louis/.claude/stats-cache.json') throw new Error('ENOENT')

    return { value: JSON.stringify(CACHE) }
  })
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null | undefined
type Drawn = {
  drawn: () => Promise<unknown>
  find: (q: { type?: string; key?: string }) => Promise<unknown>
  findAll: (q: { type?: string }) => Promise<unknown[]>
}

// So breit, wie die Apps es zeichnen, in Zeichen der Code-Schrift: Text in footnote ist
// proportional und schmaler (0,85 Zellen je Zeichen), ein Svg hat Pixel, eine Zelle 7 px.
function cells(node: Node): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node === 'string' || typeof node === 'number') return String(node).length * 0.85
  if (Array.isArray(node)) return node.reduce((sum: number, one) => sum + cells(one as Node), 0)
  const kids = (node.children ?? []) as Node[]
  if (node.type === 'Svg') return Math.ceil(Number(node.props?.width ?? 0) / 7)
  if (node.type === 'Box' && node.props?.flexDirection === 'column') return Math.max(0, ...kids.map(cells))

  return kids.reduce((sum: number, one) => sum + cells(one), 0)
}
// Clawd ist das Svg in der Größe der Szene, gleich in welcher Rolle (ein Svg trägt keinen key).
const clawd = async (ui: Drawn) =>
  ((await ui.findAll({ type: 'Svg' })) as { props: Record<string, unknown> }[]).find(
    svg => svg.props.width === SCENE_SVG.width && svg.props.height === SCENE_SVG.height,
  )

const WIDTHS = [45, 55, 70, 100]

test('in the apps Clawd stays in the bar at usual panel widths, and the bar fits', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)

  for (const surface of ['vscode', 'desktop'] as const) {
    for (const bodyColumns of WIDTHS) {
      const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface })
      expect({ surface, bodyColumns, clawd: (await clawd(ui)) !== undefined }).toEqual({
        surface,
        bodyColumns,
        clawd: true,
      })
      expect({ surface, bodyColumns, cells: cells((await ui.drawn()) as Node) <= bodyColumns }).toEqual({
        surface,
        bodyColumns,
        cells: true,
      })
      await ui.unmount()
    }
  }
})

test('before the first reply Clawd stands in the apps too', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  for (const bodyColumns of WIDTHS) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'vscode' })
    expect({ bodyColumns, clawd: (await clawd(ui)) !== undefined }).toEqual({ bodyColumns, clawd: true })
    await ui.unmount()
  }
})

test('details go before Clawd; only a tiny panel sends him aside', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)
  const drawn = async (ui: Drawn) => JSON.stringify(await ui.drawn()).replace(/\u00a0/g, ' ')
  const resets = async (ui: Drawn) => (await drawn(ui)).includes('Resets')

  // Breit: alles in einer Zeile, mit Reset und Restzeit.
  const wide = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 130 }, surface: 'vscode' })
  expect(await drawn(wide)).toContain('(in 58m)')
  expect(await clawd(wide)).toBeDefined()
  await wide.unmount()

  // Etwas schmaler: der Reset fehlt, Clawd steht noch da.
  const less = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 100 }, surface: 'vscode' })
  expect(await resets(less)).toBe(false)
  expect(await clawd(less)).toBeDefined()
  await less.unmount()

  // Winzig: Clawd tritt beiseite, die Leiste bleibt.
  const tiny = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 30 }, surface: 'vscode' })
  expect(await clawd(tiny)).toBeUndefined()
  expect(await tiny.find({ key: 'statistik' })).toBeDefined()
  expect(await tiny.find({ key: 'live' })).toBeDefined()
  await tiny.unmount()
})

test('desktop and vscode draw the same bar at the same width', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure(measure)

  // Ohne die Griffe der Knöpfe: die zählt jede Zeichnung neu.
  const tree = async (ui: Drawn) => JSON.stringify(await ui.drawn()).replace(/"handle":\d+/g, '')
  for (const bodyColumns of [...WIDTHS, 130]) {
    const props = { ...BAND.props, bodyColumns }
    const desktop = await $.ui.mount({ ...BAND, props, surface: 'desktop' })
    const vscode = await $.ui.mount({ ...BAND, props, surface: 'vscode' })
    expect(await tree(vscode)).toBe(await tree(desktop))
    await desktop.unmount()
    await vscode.unmount()
  }
})

test('the stats charts in the apps stay inside a narrow pane', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)

  for (const surface of ['vscode', 'desktop'] as const) {
    for (const bodyColumns of [40, 55, 80]) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface })
      await ui.press({ key: 'tab-stats' })
      await ui.press({ key: 'tab-1' })
      const heat = (await ui.find({ type: 'Svg' })) as { props: { width: number } } | undefined
      expect({ bodyColumns, fits: (heat?.props.width ?? Infinity) <= bodyColumns * 7 }).toEqual({ bodyColumns, fits: true })
      await ui.press({ key: 'tab-2' })
      const chart = (await ui.find({ type: 'Svg' })) as { props: { width: number; height: number } } | undefined
      expect({ bodyColumns, fits: (chart?.props.width ?? Infinity) <= bodyColumns * 7 }).toEqual({ bodyColumns, fits: true })
      expect(chart?.props.height).toBeGreaterThan(0)
      await ui.unmount()
    }
  }
})
