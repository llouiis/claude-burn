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
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/louis' })
  on('fs.read', (_, e) => {
    if (e.path !== '/home/louis/.claude/stats-cache.json') throw new Error('ENOENT')

    return { value: JSON.stringify(CACHE) }
  })

  return clock
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null | undefined
type Drawn = {
  drawn: () => Promise<unknown>
  find: (q: { type?: string; key?: string }) => Promise<unknown>
  findAll: (q: { type?: string }) => Promise<unknown[]>
}

// So breit, wie die Apps es zeichnen, in Zeichen der Code-Schrift: Text in footnote ist
// proportional, mit den Ziffern aber kaum schmaler (0,9 Zellen je Zeichen), `mono` eine Zelle je
// Zeichen, ein Svg hat Pixel (eine Zelle 7 px). Eine Box mit Breite misst in ch der Chat-Schrift
// von VS Code (rund 8,2 px), also gut 1,17 Zellen je ch.
function cells(node: Node, perChar = 0.9): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node === 'string' || typeof node === 'number') return String(node).length * perChar
  if (Array.isArray(node)) return node.reduce((sum: number, one) => sum + cells(one as Node, perChar), 0)
  const kids = (node.children ?? []) as Node[]
  const each = node.props?.mono === true ? 1 : perChar
  if (node.type === 'Svg') return Math.ceil(Number(node.props?.width ?? 0) / 7)
  if (node.type === 'Box' && typeof node.props?.width === 'number') return (node.props.width * 8.2) / 7
  if (node.type === 'Box' && node.props?.flexDirection === 'column') return Math.max(0, ...kids.map(kid => cells(kid, each)))

  return kids.reduce((sum: number, one) => sum + cells(one, each), 0)
}
// Drei Zellen bleiben frei für das, was die Apps um die Buttons zeichnen. Schmaler als
// FITS_FROM passen nicht einmal die Limits ohne Details: dort kürzen sie ihr Ende (siehe den
// Test zur Absicherung).
const SLACK = 3
const FITS_FROM = 46
const fits = (drawn: number, bodyColumns: number) => bodyColumns < FITS_FROM || drawn + SLACK <= bodyColumns
// Clawd ist in der Desktop-App das Svg in der Größe der Szene, 2- oder 1,5-fach, gleich in
// welcher Rolle (ein Svg trägt keinen key); in VS Code Text in der Box „hahn“.
const clawdSvg = async (ui: Drawn) =>
  ((await ui.findAll({ type: 'Svg' })) as { props: Record<string, unknown> }[]).find(svg =>
    [APP_SCENE, APP_SCENE_FLAT].some(size => svg.props.width === size.width && svg.props.height === size.height),
  )
const clawd = async (ui: Drawn) => (await clawdSvg(ui)) ?? (await ui.find({ key: 'hahn' }))
// In VS Code: 2 die großen Box-Pixel, 1,5 die kleinen, 0 ohne ihn.
type Tree = { type?: string; props?: Record<string, unknown>; children?: Tree[] }
const textScale = async (ui: Drawn) => {
  const box = (await ui.find({ key: 'hahn' })) as Tree | undefined
  if (box === undefined) return 0

  return box.children?.[0]?.props?.height === 0.22 ? 2 : 1.5
}
// Alle Knoten eines Baums, die Wurzel zuerst.
const nodesOf = (tree: Tree): Tree[] => [tree, ...(tree.children ?? []).filter(k => typeof k === 'object' && k !== null).flatMap(nodesOf)]

const WIDTHS = [52, 55, 70, 100]
// In VS Code: ab hier eine Zeile, ab hier die großen Box-Pixel.
const ROW_FROM = 111
const LARGE_FROM = 115

test('in the desktop app the bar fits every width, one row from 110 columns; wider never shows Clawd smaller', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)

  for (const surface of ['desktop'] as const) {
    let last = { scale: 0, isRow: false }
    for (let bodyColumns = 40; bodyColumns <= 140; bodyColumns += 1) {
      const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface })
      const svg = (await clawd(ui)) as { props: Record<string, unknown> } | undefined
      const scale = svg === undefined ? 0 : Number(svg.props.width) / 60
      const isRow = !JSON.stringify(await ui.drawn()).includes('"flexDirection":"column"')
      // Unter 51 Spalten ohne Clawd, dann gestapelt 1,5-fach, ab 110 in einer Zeile 1,5-fach, ab 115 Spalten 2-fach.
      expect({ surface, bodyColumns, scale, isRow }).toEqual({
        surface,
        bodyColumns,
        scale: bodyColumns >= 115 ? 2 : bodyColumns >= 51 ? 1.5 : 0,
        isRow: bodyColumns >= 110,
      })
      // Monoton: eine Spalte mehr zeigt Clawd nie kleiner und stapelt nie wieder.
      expect({ bodyColumns, grows: scale >= last.scale && (isRow || !last.isRow) }).toEqual({ bodyColumns, grows: true })
      expect({ surface, bodyColumns, cells: fits(cells((await ui.drawn()) as Node), bodyColumns) }).toEqual({
        surface,
        bodyColumns,
        cells: true,
      })
      last = { scale, isRow }
      await ui.unmount()
    }
  }
})

test('in VS Code the bar draws no Svg: the bar is a Box, Clawd is Box pixels, and wider never shows him smaller', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)
  // Die Rolle fest, sonst lost die Sitzung eine aus und die Szene ändert sich von Lauf zu Lauf.
  await $.command.run({ command: 'clawd', args: 'dusche' })

  let last = { scale: 0, isRow: false }
  for (let bodyColumns = 40; bodyColumns <= 140; bodyColumns += 1) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'vscode' })
    const drawn = (await ui.drawn()) as Tree
    const all = nodesOf(drawn)
    expect({ bodyColumns, svgs: all.filter(n => n.type === 'Svg').length }).toEqual({ bodyColumns, svgs: 0 })
    expect({ bodyColumns, bar: all.some(n => n.props?.backgroundColor === 'suggestion' && n.props.height === 0.3) }).toEqual({
      bodyColumns,
      bar: true,
    })
    // Keine Zeilen-Box darf umbrechen; VS Code täte es sonst von sich aus.
    const wrapping = all.filter(
      n => n.type === 'Box' && (n.props?.flexDirection ?? 'row') === 'row' && (n.children?.length ?? 0) > 1 && n.props?.flexWrap !== 'nowrap',
    )
    expect({ bodyColumns, wrapping: wrapping.length }).toEqual({ bodyColumns, wrapping: 0 })
    expect({ bodyColumns, small: all.length <= 300 }).toEqual({ bodyColumns, small: true })
    const scale = await textScale(ui)
    const isRow = drawn.props?.flexDirection !== 'column'
    // Ab 52 Spalten gestapelt mit kleinen Pixeln, ab ROW_FROM in einer Zeile, ab LARGE_FROM große.
    expect({ bodyColumns, scale, isRow }).toEqual({
      bodyColumns,
      scale: bodyColumns >= LARGE_FROM ? 2 : bodyColumns >= 52 ? 1.5 : 0,
      isRow: bodyColumns >= ROW_FROM,
    })
    expect({ bodyColumns, grows: scale >= last.scale && (isRow || !last.isRow) }).toEqual({ bodyColumns, grows: true })
    expect({ bodyColumns, cells: fits(cells(drawn as Node), bodyColumns) }).toEqual({ bodyColumns, cells: true })
    last = { scale, isRow }
    await ui.unmount()
  }

  // Clawd, angekommen: 14 Pixelzeilen aus farbigen Boxen, kein Text, schon gar kein mono.
  const wide = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 130 }, surface: 'vscode' })
  await clock.advance(3_000)
  const block = (await wide.find({ key: 'hahn' })) as Tree
  expect(block.children?.length).toBe(14)
  const inside = nodesOf(block)
  expect(inside.every(n => n.type === 'Box')).toBe(true)
  expect(inside.some(n => n.props?.backgroundColor === '#D97757')).toBe(true)
  expect(nodesOf((await wide.drawn()) as Tree).some(n => n.type === 'Text' && n.props?.mono === true)).toBe(false)
  await wide.unmount()
})

// Der Weg von der Wurzel zum Element mit diesem key, das Element zuletzt.
function pathTo(node: Node, key: string): { type?: string; props?: Record<string, unknown> }[] {
  if (node === null || node === undefined || typeof node !== 'object') return []
  if (node.props?.key === key) return [node]
  for (const kid of (node.children ?? []) as Node[]) {
    const below = pathTo(kid, key)
    if (below.length > 0) return [node, ...below]
  }

  return []
}

// Die äußeren Texte in footnote, ohne die in Buttons (die zeichnet die App selbst).
function outerTexts(node: Node): { props?: Record<string, unknown> }[] {
  if (node === null || node === undefined || typeof node !== 'object' || node.type === 'Button') return []
  if (node.type === 'Text') return node.props?.size === 'footnote' ? [node] : []

  return ((node.children ?? []) as Node[]).flatMap(outerTexts)
}

test('in the apps a wrong guess shortens the limits instead of spilling past the edge', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  // Vor der ersten Antwort und danach, gestapelt und in einer Zeile.
  for (const isMeasured of [false, true]) {
    if (isMeasured) await $.session.measure(measure)
    for (const surface of ['desktop', 'vscode'] as const) {
      for (const bodyColumns of [36, 45, 60, 90, 130]) {
        const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface })
        const tree = (await ui.drawn()) as Node
        const at = { isMeasured, surface, bodyColumns }
        // Was dann noch übersteht, schneidet die Leiste am Rand ab.
        expect({ ...at, overflow: (tree as { props?: Record<string, unknown> }).props?.overflow }).toEqual({
          ...at,
          overflow: 'hidden',
        })
        // Rechts schrumpft nichts: weder der Zähler mit dem Zeitraum noch Clawd.
        const live = pathTo(tree, 'live')
        expect({ ...at, counter: live.at(-2)?.props?.flexShrink }).toEqual({ ...at, counter: 0 })
        const counter = (live.at(-2) as { children?: Node[] } | undefined)?.children?.[0] as Node
        expect({ ...at, wrap: (counter as { props?: Record<string, unknown> }).props?.wrap }).toEqual({
          ...at,
          wrap: 'truncate-end',
        })
        const hahn = pathTo(tree, 'hahn')
        if (hahn.length > 0) expect({ ...at, clawd: hahn.at(-2)?.props?.flexShrink }).toEqual({ ...at, clawd: 0 })
        // Links schrumpft es bis auf null, und jeder Text darin kürzt sein Ende.
        // Gestapelt wie in einer Zeile stehen die Limits zuerst.
        const left = (tree as { children?: Node[] }).children?.[0] as { props?: Record<string, unknown> }
        expect({ ...at, left: { flexShrink: left.props?.flexShrink, minWidth: left.props?.minWidth } }).toEqual({
          ...at,
          left: { flexShrink: 1, minWidth: 0 },
        })
        const texts = outerTexts(left as Node)
        expect(texts.length).toBeGreaterThan(0)
        expect({ ...at, truncated: texts.every(text => text.props?.wrap === 'truncate-end') }).toEqual({
          ...at,
          truncated: true,
        })
        // Die Knöpfe kürzen sich nie.
        const usage = pathTo(tree, 'statistik')
        if (usage.length > 0) expect({ ...at, buttons: usage.at(-2)?.props?.flexShrink }).toEqual({ ...at, buttons: 0 })
        await ui.unmount()
      }
    }
  }
})

test('before the first reply Clawd stands in the apps too', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  for (const surface of ['desktop', 'vscode'] as const) {
    for (const bodyColumns of WIDTHS) {
      const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface })
      expect({ surface, bodyColumns, clawd: (await clawd(ui)) !== undefined }).toEqual({ surface, bodyColumns, clawd: true })
      await ui.unmount()
    }
  }
})

test('in the apps Clawd stands at twice his viewBox, crisp and centred beside the text', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)

  for (const surface of ['desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 130 }, surface })
    const svg = (await clawdSvg(ui)) as { props: Record<string, unknown> } | undefined
    expect(svg?.props).toEqual(expect.objectContaining({ width: 120, height: 54 }))
    // 2-fach: auf Retina vier Gerätepixel je Szenenpixel.
    const source = String(svg?.props.source)
    const [, , width, height] = (/viewBox="([^"]+)"/.exec(source)?.[1] ?? '').split(' ').map(Number)
    expect(APP_SCENE.width / (width ?? 1)).toBe(2)
    expect(APP_SCENE.height).toBe(2 * (height ?? 0))
    expect(source).toContain('preserveAspectRatio="xMidYMin meet"')
    expect(source).toContain('shape-rendering="crispEdges"')
    // Die Zeile richtet alles mittig aus, so steht der Text auf halber Höhe neben ihm.
    const tree = JSON.stringify(await ui.drawn())
    expect(tree.startsWith('{"type":"Box","props":{"flexDirection":"row","alignItems":"center"')).toBe(true)
    await ui.unmount()
  }
  // Wird es eng, steht er 1,5-fach; die halbe Zeile zu 41 bleibt unten frei.
  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 80 }, surface: 'desktop' })
  expect(((await clawdSvg(narrow)) as { props: Record<string, unknown> } | undefined)?.props).toEqual(
    expect.objectContaining({ width: 90, height: 41 }),
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
  const wide = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 140 }, surface: 'vscode' })
  expect(await drawn(wide)).toContain('(in 58m)')
  expect(await clawd(wide)).toBeDefined()
  await wide.unmount()

  // Etwas schmaler: der Reset fehlt, Clawd steht noch da.
  const less = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 112 }, surface: 'vscode' })
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

test('the desktop app keeps its Svg, VS Code gets none at any width', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure(measure)

  for (const bodyColumns of [...WIDTHS, 130]) {
    const props = { ...BAND.props, bodyColumns }
    const desktop = await $.ui.mount({ ...BAND, props, surface: 'desktop' })
    const vscode = await $.ui.mount({ ...BAND, props, surface: 'vscode' })
    // Balken und Clawd als Svg in der Desktop-App.
    expect({ bodyColumns, svgs: (await desktop.findAll({ type: 'Svg' })).length }).toEqual({ bodyColumns, svgs: 2 })
    expect({ bodyColumns, svgs: (await vscode.findAll({ type: 'Svg' })).length }).toEqual({ bodyColumns, svgs: 0 })
    expect(await vscode.find({ key: 'hahn' })).toBeDefined()
    // Die Zahlen stehen in beiden gleich.
    expect(textOf((await vscode.drawn()) as Node)).toContain('34% used')
    expect(textOf((await vscode.drawn()) as Node)).toContain('tokens · [session ›]')
    await desktop.unmount()
    await vscode.unmount()
  }
})

test('the stats charts in the apps stay inside a narrow pane', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)

  // VS Code zeichnet keine Svg und kein mono: Heatmap und Diagramm aus Box, jede Zeile so breit,
  // wie ch der Chat-Schrift (rund 8,2 px) in die Breite passen.
  for (const bodyColumns of [40, 55, 80]) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'vscode' })
    await ui.press({ key: 'tab-stats' })
    for (const tab of ['tab-1', 'tab-2']) {
      await ui.press({ key: tab })
      const all = nodesOf((await ui.drawn()) as Tree)
      expect({ bodyColumns, tab, svgs: all.filter(n => n.type === 'Svg').length }).toEqual({ bodyColumns, tab, svgs: 0 })
      expect({ bodyColumns, tab, mono: all.some(n => n.props?.mono === true) }).toEqual({ bodyColumns, tab, mono: false })
      expect(all.filter(n => n.type === 'Box' && n.props?.backgroundColor !== undefined).length).toBeGreaterThan(0)
      const widest = Math.max(
        ...all
          .filter(n => n.type === 'Box' && n.props?.flexWrap === 'nowrap')
          .map(n => (n.children ?? []).reduce((sum, kid) => sum + (typeof kid.props?.width === 'number' ? kid.props.width : 0), 0)),
      )
      expect({ bodyColumns, tab, fits: widest <= Math.floor((bodyColumns * 7) / 8.2) }).toEqual({ bodyColumns, tab, fits: true })
    }
    await ui.unmount()
  }
  for (const surface of ['desktop'] as const) {
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
  expect(textOf((await ui.drawn()) as Node)).toContain('$32.79 · 1.131.000 tokens · [session ›]')
  await ui.unmount()
})
