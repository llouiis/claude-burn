import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionMeasureInput } from 'claude-code'

import { APP_SCENE, APP_SCENE_FLAT } from '../hooks/clawd'

// Die Apps (desktop, vscode, mobile) zählen bodyColumns in Zeichen ihrer Code-Schrift.
// Hier geht es um die Leiste und das Fenster dort: Clawd bleibt, nichts bricht um,
// desktop und vscode zeichnen bei gleicher Breite dasselbe.

const BAND = {
  plugin: 'burn',
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
  plugin: 'burn',
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
function engine(on: On, resumed?: { usd: number; stored?: Record<string, unknown> }) {
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sitzung-1' }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW - 183_000,
      context: { window: 200_000 },
      rateLimits: [],
      ...(resumed === undefined ? {} : { cost: { usd: resumed.usd } }),
    },
  }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on, resumed?.stored)
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
// Clawd ist das Svg in der Größe der Szene, 1,5- oder 1-fach, gleich in welcher Rolle (ein Svg
// trägt keinen key).
const clawd = async (ui: Drawn) =>
  ((await ui.findAll({ type: 'Svg' })) as { props: Record<string, unknown> }[]).find(svg =>
    [APP_SCENE, APP_SCENE_FLAT].some(size => svg.props.width === size.width && svg.props.height === size.height),
  )

const WIDTHS = [45, 55, 70, 100]

test('in the apps the bar fits every width, one row from 78 columns; wider never shows Clawd smaller', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)

  for (const surface of ['vscode', 'desktop'] as const) {
    let last = { scale: 0, isRow: false }
    for (let bodyColumns = 40; bodyColumns <= 140; bodyColumns += 1) {
      const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface })
      const svg = (await clawd(ui)) as { props: Record<string, unknown> } | undefined
      const scale = svg === undefined ? 0 : Number(svg.props.width) / 60
      const isRow = !JSON.stringify(await ui.drawn()).includes('"flexDirection":"column"')
      // Gestapelt 1-fach, in einer Zeile 1-fach, ab 90 Spalten 1,5-fach.
      expect({ surface, bodyColumns, scale, isRow }).toEqual({
        surface,
        bodyColumns,
        scale: bodyColumns >= 90 ? 1.5 : 1,
        isRow: bodyColumns >= 78,
      })
      // Monoton: eine Spalte mehr zeigt Clawd nie kleiner und stapelt nie wieder.
      expect({ bodyColumns, grows: scale >= last.scale && (isRow || !last.isRow) }).toEqual({ bodyColumns, grows: true })
      expect({ surface, bodyColumns, cells: cells((await ui.drawn()) as Node) <= bodyColumns }).toEqual({
        surface,
        bodyColumns,
        cells: true,
      })
      last = { scale, isRow }
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

test('in the apps Clawd stands at one and a half times his viewBox, crisp and centred beside the text', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)

  for (const surface of ['vscode', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 130 }, surface })
    const svg = (await clawd(ui)) as { props: Record<string, unknown> } | undefined
    expect(svg?.props).toEqual(expect.objectContaining({ width: 90, height: 41 }))
    // 1,5-fach: auf Retina drei Gerätepixel je Szenenpixel. Die halbe Zeile zu 41 bleibt unten
    // frei, statt die Szene um einen Viertelpixel zu verschieben.
    const source = String(svg?.props.source)
    const [, , width, height] = (/viewBox="([^"]+)"/.exec(source)?.[1] ?? '').split(' ').map(Number)
    expect(APP_SCENE.width / (width ?? 1)).toBe(1.5)
    expect(APP_SCENE.height - 1.5 * (height ?? 0)).toBe(0.5)
    expect(source).toContain('preserveAspectRatio="xMidYMin meet"')
    expect(source).toContain('shape-rendering="crispEdges"')
    // Die Zeile richtet alles mittig aus, so steht der Text auf halber Höhe neben ihm.
    const tree = JSON.stringify(await ui.drawn())
    expect(tree.startsWith('{"type":"Box","props":{"flexDirection":"row","alignItems":"center"')).toBe(true)
    await ui.unmount()
  }
  // Wird es eng, steht er 1-fach in der Zeile.
  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 80 }, surface: 'vscode' })
  expect(((await clawd(narrow)) as { props: Record<string, unknown> } | undefined)?.props).toEqual(
    expect.objectContaining({ width: 60, height: 27 }),
  )
  await narrow.unmount()
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

// Alle Texte der Zeichnung hintereinander, ohne die festen Leerzeichen.
function textOf(node: Node): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node).replace(/ /g, ' ')
  if (Array.isArray(node)) return node.map(one => textOf(one as Node)).join('')
  if (node.type === 'Button') return `[${String(node.props?.label ?? '').replace(/ /g, ' ')}]`

  return ((node.children ?? []) as Node[]).map(textOf).join('')
}

test('in the apps only the span is a button; the numbers are plain text beside it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)

  for (const surface of ['vscode', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const live = (await ui.find({ key: 'live' })) as { props: { label: string } } | undefined
    expect(live?.props.label.replace(/\u00a0/g, ' ')).toBe('session ›')
    expect(textOf((await ui.drawn()) as Node)).toContain('$1.23 · 0 tokens · [session ›]')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.press({ key: 'live' })
  expect(textOf((await ui.drawn()) as Node)).toContain('tokens · [24h ›]')
  await ui.unmount()
})

test('a resumed session without its tokens counts cost and tokens from now, not $32.79 against 0', async ($, on) => {
  engine(on, { usd: 32.79 })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(textOf((await ui.drawn()) as Node)).toContain('$0.00 · 0 tokens · [session ›]')

  // Was danach dazukommt, zählt: 0,50 $ mehr.
  await $.session.measure({ ...measure, cost: { usd: 33.29 } })
  expect(textOf((await ui.drawn()) as Node)).toContain('$0.50 · ')
  await ui.unmount()
})

test('a resumed session finds its tokens again and keeps its full cost', async ($, on) => {
  const tally = {
    tokens: { input: 1_000, output: 30_000, cacheRead: 1_100_000, cacheWrite: 0 },
    costBase: 0,
  }
  engine(on, { usd: 32.79, stored: { 'tally:sitzung-1': tally } })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(textOf((await ui.drawn()) as Node)).toContain('$32.79 · 1.131m tokens · [session ›]')
  await ui.unmount()
})
