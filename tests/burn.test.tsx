import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { axisLabel } from '../hooks/chart'
import { FLOWS, ML_PER_TOKEN, ROLES, literText, piecesText, sceneAlt, sceneSvg, tapLevel, terminalScene } from '../hooks/clawd'
import type { Scene } from '../hooks/clawd'
import { addTo, allOutput, costFrom, liveTotals } from '../hooks/ledger'
import { addToBook, dayNumber, modelName, summarize, withBooks } from '../hooks/stats'
import type { DayBook, StatsCache } from '../hooks/stats'

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

// Freitag, 23.10.2026, 15:42 UTC: 17:42 Uhr in Berlin (Sommerzeit).
const NOW = Date.UTC(2026, 9, 23, 15, 42)

const LIMITS = [
  // 6:40pm in Berlin, in 58 Minuten.
  { kind: 'five_hour', percentUsed: 34, resetsAt: '2026-10-23T16:40:00Z' },
  // Nach der Umstellung am 25.10.: 9:00am Winterzeit.
  { kind: 'seven_day', percentUsed: 12.5, resetsAt: '2026-10-27T08:00:00Z' },
]

// Nichts liegt unter dem Plugin: diese Hooks stehen für Claude Code selbst.
function engine(on: On, stored?: Record<string, unknown>) {
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sitzung-1' }))
  on('session.usage', (_, e) => {
    if ((e as { breakdown?: string }).breakdown) breakdowns += 1

    return {
      value: {
        startedAt: NOW - 183_000,
        context: { window: 200_000, ...((e as { breakdown?: string }).breakdown ? { breakdown: BREAKDOWN } : {}) },
        rateLimits: [],
      },
    }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // Claude Code beantwortet jeden Modellaufruf mit dem Verbrauch aus `usages`.
  on('turn.step', async function* (_, e) {
    // Ein offener Strom: ein Stück Text, dann wartet die Antwort, bis der Test sie freigibt.
    if (tapOpen !== null) {
      yield { kind: 'text' as const, index: 0, text: 'x'.repeat(streamChars) }
      await tapOpen
    }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: usages.shift() ?? null,
    }
  })
  mock.store(on, stored)
}

// Solange gesetzt, hält das gespielte Claude Code jede Antwort nach dem ersten Stück an.
let tapOpen: Promise<void> | null = null
// So viele Zeichen liefert der offene Strom auf einmal; viermal so viele wie Tokens.
let streamChars = 4_000

// Wie oft der Mod die Aufschlüsselung geholt hat.
let breakdowns = 0

// Wie /context es aufschlüsselt, gekürzt.
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 53_300, color: 'purple_FOR_SUBAGENTS_ONLY', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 110_700, color: 'promptBorder', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 56_300,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'model-default',
  percentage: 28,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [{ path: '/Users/l/.claude/CLAUDE.md', type: 'User', tokens: 1_800 }],
  mcpTools: [{ name: 'mcp__a__b', serverName: 'a', tokens: 400, isLoaded: true }],
  agents: [],
  autoCompactThreshold: 167_000,
  isAutoCompactEnabled: true,
  apiUsage: { input_tokens: 300, output_tokens: 10, cache_read_input_tokens: 52_000, cache_creation_input_tokens: 4_000 },
}

const usages: {
  model: string
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  output_tokens: number
}[] = []

const measure = {
  context: { window: 200_000, tokens: 56_300, percent: 28 },
  rateLimits: LIMITS,
  cost: { usd: 1.23456 },
  changed: ['context', 'rateLimits', 'cost'],
} as const

// Ein Modellaufruf mit diesem Verbrauch; die Runde muss dafür nicht fertig sein.
type Engine = { turn: { step: (e: { turnId: string; index: number; model: string; messageCount: number; agentId?: string }) => AsyncIterable<unknown> } }
async function step($: Engine, input: number, cached: number, output: number, agentId?: string) {
  usages.push({
    model: 'claude-opus-5-5',
    input_tokens: input,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
    output_tokens: output,
  })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId })) {
    // nur durchlaufen lassen
  }
}

type Found = { text: string } | undefined
type Drawing = { find: (q: { type?: string; key?: string; text?: RegExp }) => Promise<Found> }
type Many = { findAll: (q: { type?: string }) => Promise<{ props: Record<string, unknown> }[]> }
const plain = (text: string | undefined) => (text ?? '').replace(/ /g, ' ')

// Die Zeile, dahinter der Knopf zum Weiterschalten.
const text = async (ui: Drawing) => {
  const line = (await ui.find({ type: 'Text', text: /^✻/ }))?.text
  const button = (await ui.find({ key: 'burn' }))?.text

  return plain(`${line ?? ''}${button ?? ''}`)
}
const liveText = async (ui: Drawing) => plain((await ui.find({ key: 'live' }))?.text)

test('the bar cycles session, week and tokens, on every surface', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await step($, 4_000, 1_150_000, 30_000)
  await step($, 1_000, 45_000, 15_100, 'a1')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /▝▜█████▛▘/ })).toBeUndefined()
  expect(await text(ui)).toBe('✻ Session  ████████ 34% used  ·  Resets 6:40pm (in 58m)   1/3 ›')
  await ui.press({ key: 'burn' })
  expect(await text(ui)).toBe(
    '✻ Week  ████████ 13% used  ·  Resets Oct 27 at 9:00am (in 3d 16h)   2/3 ›',
  )
  await ui.press({ key: 'burn' })
  expect(await text(ui)).toBe(
    '✻ Context  ████████ 56.3k / 200.0k  ·  ↑ 1.2m in  ↓ 45.1k out   3/3 ›',
  )
  await ui.unmount()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const app = await $.ui.mount({ ...BAND, surface })
    // In den Apps ein flacher Strich als Svg statt einer ganzen Zeile Blöcke; VS Code zeichnet
    // keine Svg, dort ist der Strich aus Box.
    if (surface === 'vscode') {
      expect(await app.find({ type: 'Svg' })).toBeUndefined()
      expect(JSON.stringify(await app.drawn())).toContain('"backgroundColor":"suggestion"')
    } else {
      expect((await app.find({ type: 'Svg' }))?.props).toMatchObject({ width: 64, height: 5 })
    }
    expect(await app.find({ type: 'Text', text: /█/ })).toBeUndefined()
    expect(await app.find({ type: 'Text', text: /^✻\s(Session|Week|Context)/ })).toBeDefined()
    await app.unmount()
  }
})

test('a /compact counts its own tokens too, not only its price', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })
  // Der Zusammenfasser ist ein eigener Modellaufruf, kein turn.step; der Preis kennt ihn schon.
  const summary = [{ role: 'user' as const, text: 'Summary of the conversation so far', toolUses: [] }]
  on('session.compact', () => ({
    messages: summary,
    usage: { input_tokens: 150_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await $.session.compact({ trigger: 'manual', messages: summary })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(5_000)
  expect(await liveText(ui)).toBe('$1.23 · 152.000 tokens · session ›')
  await ui.unmount()
})

test('far right the live counter cycles session, 24h, 7d, 30d and all time', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await step($, 4_000, 1_150_000, 30_000)
  await step($, 1_000, 45_000, 15_100, 'a1')

  // Die Kosten steigen erst auf 1.23, dann auf 3.50 Dollar.
  await $.session.measure({ ...measure, cost: { usd: 3.5 } })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // Gleich danach läuft der Zähler noch hinterher wie im Spinner, dann holt er auf.
  expect(await liveText(ui)).not.toBe('$3.50 · 1.245.100 tokens · session ›')
  await clock.advance(5_000)
  expect(await liveText(ui)).toBe('$3.50 · 1.245.100 tokens · session ›')
  // Am ersten Tag: Preis bei session und 24h, nicht bei 7d, 30d und all time.
  await ui.press({ key: 'live' })
  expect(await liveText(ui)).toBe('$3.50 · 1.245.100 tokens · 24h ›')
  for (const span of ['7d', '30d', 'all time']) {
    await ui.press({ key: 'live' })
    expect(await liveText(ui)).toBe(`1.245.100 tokens · ${span} ›`)
  }
  await ui.press({ key: 'live' })
  expect(await liveText(ui)).toBe('$3.50 · 1.245.100 tokens · session ›')
  await ui.unmount()
})

test('in a narrow terminal the time left goes first, then the reset', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)

  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 110 }, surface: 'terminal' })
  expect(await text(narrow)).toBe('✻ Session  ████████ 34% used  ·  Resets 6:40pm   1/3 ›')
  await narrow.unmount()

  const tiny = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 69 }, surface: 'terminal' })
  expect(await text(tiny)).toBe('✻ Session  ████████ 34% used   1/3 ›')
  await tiny.unmount()
})

test('before the first reply the bar says values are coming', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(plain((await ui.find({ type: 'Text', text: /^✻/ }))?.text)).toBe(
    "✻ Usage limits appear after Claude's next reply",
  )
  await ui.unmount()
})

test('/tokens hides the bar and shows it again', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)

  expect(await $.command.run({ command: 'tokens' })).toMatchObject({ text: 'Usage bar hidden.' })
  const hidden = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await hidden.find({ key: 'burn' })).toBeUndefined()
  await hidden.unmount()

  expect(await $.command.run({ command: 'tokens' })).toMatchObject({ text: 'Usage bar shown.' })
  const shown = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(shown)).toMatch(/^✻ Session/)
  await shown.unmount()
})

test('the ledger joins /stats days before it started with its own hours', () => {
  const day = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
  const start = Date.UTC(2026, 9, 23, 10)
  let ledger = addTo({ buckets: {}, archived: 0 }, start, 1_000, start)
  ledger = addTo(ledger, start + 3_600_000, 500, start + 3_600_000)
  const cache = {
    dailyModelTokens: [
      { date: '2026-09-01', tokensByModel: { a: 7 } },
      { date: '2026-10-20', tokensByModel: { a: 100 } },
      { date: '2026-10-23', tokensByModel: { a: 999 } },
    ],
  }
  const totals = liveTotals([ledger], start, cache, 42, NOW, ms => day(new Date(ms).toISOString().slice(0, 10)))

  // Der 23.10. kommt aus dem Kassenbuch, nicht doppelt aus /stats.
  expect(totals).toEqual({ session: 42, day: 1_500, week: 1_600, month: 1_600, all: 1_607 })
})

const CACHE = {
  lastComputedDate: '2026-10-22',
  firstSessionDate: '2026-10-09T18:31:19.964Z',
  dailyActivity: [
    { date: '2026-10-09', messageCount: 276, sessionCount: 12, toolCallCount: 17 },
    { date: '2026-10-10', messageCount: 100, sessionCount: 2, toolCallCount: 10 },
    { date: '2026-10-18', messageCount: 2932, sessionCount: 12, toolCallCount: 633 },
    { date: '2026-10-19', messageCount: 835, sessionCount: 1, toolCallCount: 349 },
    { date: '2026-10-20', messageCount: 262, sessionCount: 2, toolCallCount: 46 },
  ],
  dailyModelTokens: [
    { date: '2026-10-09', tokensByModel: { 'claude-sonnet-5-5': 2_600_000 } },
    { date: '2026-10-18', tokensByModel: { 'claude-opus-5-5': 1_200_000_000 } },
    { date: '2026-10-20', tokensByModel: { 'claude-opus-5-5': 14_500_000 } },
  ],
  modelUsage: {
    'claude-opus-5-5': {
      inputTokens: 11_000,
      outputTokens: 8_100_000,
      cacheReadInputTokens: 1_300_000_000,
      cacheCreationInputTokens: 27_000_000,
    },
    'claude-sonnet-5-5': {
      inputTokens: 0,
      outputTokens: 700_000,
      cacheReadInputTokens: 60_000_000,
      cacheCreationInputTokens: 4_000_000,
    },
  },
  longestSession: { duration: 368_672_039 },
  hourCounts: { '20': 13, '21': 12 },
}

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

// Wie oft der Mod stats-cache.json gelesen hat.
let statsReads = 0

function statsEngine(on: On, cache: unknown, stored?: Record<string, unknown>) {
  engine(on, stored)
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/louis' })
  on('fs.read', (_, e) => {
    if (e.path === '/home/louis/.claude/stats-cache.json') statsReads += 1
    if (e.path !== '/home/louis/.claude/stats-cache.json' || cache === null) throw new Error('ENOENT')

    return { value: JSON.stringify(cache) }
  })

  return clock
}

const has = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<unknown> }, re: RegExp) =>
  (await ui.find({ type: 'Text', text: re })) !== undefined
// In VS Code stehen Spalten als Boxen fester Breite nebeneinander: die Zeile ist eine Box.
const hasRow = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<unknown> }, re: RegExp) =>
  (await ui.find({ type: 'Box', text: re })) !== undefined

test('Usage shows cost, limits and context like /usage, on every surface', async ($, on) => {
  statsEngine(on, CACHE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await has(ui, /^Settings\s$/)).toBe(true)
    if (surface === 'vscode') {
      // Die Beschriftung in einer Box fester Breite, der Wert daneben.
      expect(await hasRow(ui, /^Total\scost:\$1\.2346$/)).toBe(true)
      expect(await hasRow(ui, /^Total\sduration\s\(wall\):3m\s3s$/)).toBe(true)
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    } else {
      expect(await has(ui, /^Total\scost:\s+\$1\.2346$/)).toBe(true)
      expect(await has(ui, /^Total\sduration\s\(wall\):\s+3m\s3s$/)).toBe(true)
    }
    expect(await has(ui, /^Current\ssession$/)).toBe(true)
    expect(await has(ui, /34%\sused$/)).toBe(true)
    expect(await has(ui, /^Resets\s6:40pm\s\(Europe\/Berlin\)$/)).toBe(true)
    expect(await has(ui, /^Current\sweek\s\(all\smodels\)$/)).toBe(true)
    expect(await has(ui, /^Resets\sOct\s27\sat\s9:00am\s\(Europe\/Berlin\)$/)).toBe(true)
    expect(await has(ui, /^56\.3k\sof\s200\.0k\stokens$/)).toBe(true)
    await ui.unmount()
  }
})

test('Stats › Overview reads like /stats, on every surface', async ($, on) => {
  statsEngine(on, CACHE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-stats' })

    expect(await has(ui, /^Favorite\smodel:\sOpus\s5\.5$/)).toBe(true)
    expect(await has(ui, /^Total\stokens:\s1\.2b$/)).toBe(true)
    expect(await has(ui, /^Active\sdays:\s6\/15$/)).toBe(true)
    expect(await has(ui, /^Longest\ssession:\s4d\s6h\s24m$/)).toBe(true)
    expect(await has(ui, /^Most\sactive\sday:\sOct\s18$/)).toBe(true)
    expect(await has(ui, /^Longest\sstreak:\s3\sdays$/)).toBe(true)
    expect(await has(ui, /^Current\sstreak:\s1\sday$/)).toBe(true)
    expect(await has(ui, /^Your input and output are ~67x the tokens in To Kill a Mockingbird$/)).toBe(true)
    expect(await has(ui, /^Most\sactive\shour:\s8pm–9pm$/)).toBe(true)
    expect(await has(ui, /^All\stime$/)).toBe(true)
    // VS Code zeichnet keine Svg und kein mono (siehe register.tsx): dort die Heatmap aus Box.
    if (surface === 'vscode') {
      expect(await has(ui, /^Mon$/)).toBe(true)
      expect(await has(ui, /^Oct$/)).toBe(true)
      expect(await hasRow(ui, /^Less\s\sMore$/)).toBe(true)
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(JSON.stringify(await ui.drawn())).toContain('"backgroundColor":"#D97757FF"')
    } else if (surface === 'terminal') {
      expect(await has(ui, /^Mon\s/)).toBe(true)
      expect(await has(ui, /Oct/)).toBe(true)
      expect(await has(ui, /^\s+Less\s░\s▒\s▓\s█\sMore$/)).toBe(true)
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
    }
    await ui.press({ key: 'tab-0' })
    await ui.unmount()
  }
})

test('Last 7 days counts only the past week', async ($, on) => {
  statsEngine(on, CACHE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'tab-stats' })
  await ui.press({ key: 'range-1' })
  expect(await has(ui, /^Sessions:\s15$/)).toBe(true)
  expect(await has(ui, /^Active\sdays:\s4\/7$/)).toBe(true)
  await ui.unmount()
})

test('Stats › Models draws tokens per day and the split per model', async ($, on) => {
  statsEngine(on, CACHE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'tab-stats' })
  await ui.press({ key: 'tab-2' })
  expect(await has(ui, /^Tokens\sper\sDay$/)).toBe(true)
  expect(await has(ui, /^\s*1\.2B\s┤/)).toBe(true)
  expect(await has(ui, /^\s+0\s┼/)).toBe(true)
  expect(await has(ui, /Oct\s9/)).toBe(true)
  expect(await has(ui, /╭/)).toBe(true)
  expect(await has(ui, /^●\sOpus\s5\.5\s·\s●\sSonnet\s5\.5$/)).toBe(true)
  expect(await has(ui, /^●\sOpus\s5\.5\s\(95\.4%\)$/)).toBe(true)
  expect(await has(ui, /^\s+In:\s11\.0k\s·\sOut:\s8\.1m$/)).toBe(true)
  expect(await has(ui, /^\s+Cache:\s1\.3b\sread\s·\s27\.0m\swrite$/)).toBe(true)
  await ui.unmount()
})

test('without /stats data the stats tabs say so', async ($, on) => {
  statsEngine(on, null)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'tab-stats' })
  expect(await has(ui, /^No stats yet/)).toBe(true)
  await ui.unmount()
})

test('Usage lists tokens and cost per span with the notes', async ($, on) => {
  statsEngine(on, null)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ ...measure, cost: { usd: 3.5 } })
  await step($, 4_000, 1_150_000, 30_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await has(ui, /^Tokens\s&\scost$/)).toBe(true)
  expect(await has(ui, /^\s+Session\s+1\.2m\stokens\s+\$3\.50$/)).toBe(true)
  expect(await has(ui, /^\s+24h\s+1\.2m\stokens\s+\$3\.50$/)).toBe(true)
  expect(await has(ui, /^\s+7d\s+1\.2m\stokens\s+cost\sfrom\sOct\s30$/)).toBe(true)
  expect(await has(ui, /^\s+30d\s+1\.2m\stokens\s+cost\sfrom\sNov\s22$/)).toBe(true)
  expect(await has(ui, /^\s+All\stime\s+1\.2m\stokens\s+–$/)).toBe(true)
  expect(await has(ui, /^Total\scost:\s+\$3\.5000$/)).toBe(true)
  expect(await has(ui, /^Cost\sis\san\sAPI-price\sestimate,\snot\syour\splan's\sbill\.$/)).toBe(true)
  expect(await has(ui, /^Tracked\ssince\sOct\s23;/)).toBe(true)
  await ui.unmount()
})

test('session tokens count live after every model call, before the turn ends', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await step($, 500, 10_000, 1_500)
  await clock.advance(5_000)
  expect(await liveText(ui)).toBe('$1.23 · 12.000 tokens · session ›')
  await step($, 500, 20_000, 2_000)
  await clock.advance(5_000)
  expect(await liveText(ui)).toBe('$1.23 · 34.500 tokens · session ›')
  await ui.unmount()
})

test('/tokenstats counts on after the last day /stats computed: own day books, tokens from the hour book', () => {
  const opus = { inputTokens: 10, outputTokens: 1_000, cacheReadInputTokens: 50_000, cacheCreationInputTokens: 2_000 }
  let book: DayBook = {}
  book = addToBook(book, '2026-10-24', 21, { messages: 1 })
  book = addToBook(book, '2026-10-24', 22, { messages: 4, toolCalls: 2, model: 'claude-opus-5-5', tokens: opus })
  // Ein Tag, den /stats schon kennt, zählt nicht doppelt.
  book = addToBook(book, '2026-10-20', 9, { messages: 99, toolCalls: 9 })
  // Das Stundenbuch hat am 24. mehr Tokens als das Tagebuch: der Rest ist ohne Modell.
  const hours = new Map([[dayNumber('2026-10-24'), 60_000], [dayNumber('2026-10-23'), 7_000]])
  const merged = withBooks(CACHE as StatsCache, [book, { '2026-10-24': { messages: 2, toolCalls: 0, hour: 8, models: {} } }], hours, '2026-10-26')
  const all = summarize(merged!, '2026-10-26', null)
  const before = summarize(CACHE as StatsCache, '2026-10-26', null)
  expect(all.messages - before.messages).toBe(7)
  expect(all.toolCalls - before.toolCalls).toBe(2)
  expect(all.sessions - before.sessions).toBe(2)
  expect(all.tokens - before.tokens).toBe(67_000)
  expect(all.favoriteModel).toBe(before.favoriteModel)
  expect(merged?.dailyModelTokens?.find(d => d.date === '2026-10-24')?.tokensByModel).toEqual({ 'claude-opus-5-5': 53_010, untracked: 6_990 })
  expect(merged?.hourCounts?.['21']).toBe(13)
  expect(modelName('untracked')).toBe('Untracked')
  // Ohne Zwischenspeicher reichen die Tagebücher allein.
  expect(summarize(withBooks(null, [book], new Map(), '2026-10-26')!, '2026-10-26', null).messages).toBe(104)
  expect(withBooks(null, [], new Map(), '2026-10-26')).toBeNull()
})

test('7d and 30d show cost once the ledger covers the whole span', () => {
  const day = (ms: number) => Math.floor(ms / 86_400_000)
  const start = Date.UTC(2026, 9, 23, 16)
  const at = (date: number) => Date.UTC(2026, 9, date, 12)

  expect(costFrom('day', start, at(23), day)).toBe(true)
  expect(costFrom('week', start, at(29), day)).toBe(day(at(30)))
  expect(costFrom('week', start, at(30), day)).toBe(true)
  expect(costFrom('month', start, at(30), day)).toBe(day(Date.UTC(2026, 10, 22, 12)))
  expect(costFrom('all', start, at(30), day)).toBe(null)
})

test('Context breaks the window down like /context and the bar counts to auto-compact', async ($, on) => {
  engine(on)
  on('env.get', () => ({ value: '/Users/l' }))
  mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)

  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 143 }, surface: 'terminal' })
  await band.press({ key: 'burn' })
  await band.press({ key: 'burn' })
  expect(await text(band)).toContain('110.7k to auto-compact')
  await band.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-3' })
    expect(await has(ui, /^56\.3k\s\/\s200\.0k\stokens\s\(28%\)$/)).toBe(true)
    expect(await has(ui, /^Auto-compact\sat\s167\.0k\s·\s110\.7k\sto\sgo$/)).toBe(true)
    expect(await has(ui, /Messages\s+53\.3k\s+26\.7%/)).toBe(true)
    expect(await has(ui, /^92%\sread/)).toBe(true)
    expect(await has(ui, /~\/\.claude\/CLAUDE\.md\s+1\.8k/)).toBe(true)
    await ui.unmount()
  }
})

test('the apps draw the subagent colours of /context as hex, the terminal keeps the theme name', async ($, on) => {
  engine(on)
  on('env.get', () => ({ value: '/Users/l' }))
  mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-3' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('purple_FOR_SUBAGENTS_ONLY')).toBe(surface === 'terminal')
    expect(drawn.includes('#827DBD')).toBe(surface !== 'terminal')
    await ui.unmount()
  }
})

test('a reply inside the 15 s pause still refreshes the context afterwards', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  const before = breakdowns
  await $.session.measure(measure)
  await $.session.measure(measure)
  expect(breakdowns).toBe(before)
  await clock.advance(15_000)
  expect(breakdowns).toBe(before + 1)
})

test('the counter keeps its room while it counts, so the bar does not wrap or switch details', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 108 }, surface: 'terminal' })
  const before = await text(ui)
  expect(before).toBe('✻ Session  ████████ 34% used  ·  Resets 6:40pm   1/3 ›')

  // Von 0 auf über eine Million: links bleibt alles, wie es war.
  await step($, 4_000, 1_150_000, 30_000)
  await clock.advance(300)
  expect(await text(ui)).toBe(before)
  await clock.advance(5_000)
  expect(await liveText(ui)).toBe('$1.23 · 1.184.000 tokens · session ›')
  expect(await text(ui)).toBe(before)
  await ui.unmount()
})

test('the counter ticks about nine times a second, not twenty', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await step($, 4_000, 1_150_000, 30_000)
  const start = await liveText(ui)
  await clock.advance(50)
  expect(await liveText(ui)).toBe(start)
  await clock.advance(70)
  expect(await liveText(ui)).not.toBe(start)
  await ui.unmount()
})

test('before the first reply the live counter already shows on the right', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await liveText(ui)).toBe('$0.00 · 0 tokens · session ›')
  await ui.press({ key: 'live' })
  expect(await liveText(ui)).toBe('$0.00 · 0 tokens · 24h ›')
  await ui.unmount()
})

test('the band button is called Usage like the pane it opens', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ key: 'statistik' }))?.text).toBe('Usage')
  await ui.unmount()
})

test('every tab has a footer with hotkeys, and r cycles the dates', async ($, on) => {
  statsEngine(on, CACHE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await has(ui, /^ctrl\+x\stab\sto\sfocus$/)).toBe(true)
  expect(await has(ui, /^Esc\sto\sclose$/)).toBe(true)
  expect((await ui.find({ key: 'key-1' }))?.props).toMatchObject({ hotkey: '1' })
  expect(await ui.find({ key: 'key-r' })).toBeUndefined()

  await ui.press({ key: 'key-2' })
  expect(await has(ui, /^Favorite\smodel:/)).toBe(true)
  expect((await ui.find({ key: 'key-r' }))?.props).toMatchObject({ hotkey: 'r' })
  await ui.press({ key: 'key-r' })
  expect(await has(ui, /^Sessions:\s15$/)).toBe(true)
  await ui.press({ key: 'key-m' })
  expect(await has(ui, /^Tokens\sper\sDay$/)).toBe(true)

  // Auf Context ist nur Context hinterlegt, nicht auch Usage.
  await ui.press({ key: 'key-3' })
  expect(JSON.stringify((await ui.find({ key: 'tab-0' }))?.children)).not.toContain('inverseText')
  expect(JSON.stringify((await ui.find({ key: 'tab-3' }))?.children)).toContain('inverseText')
  await ui.unmount()

  const focused = await $.ui.mount({ ...PANE, props: { ...PANE.props, isFocused: true }, surface: 'terminal' })
  expect(await has(focused, /^ctrl\+x\stab\sto\sfocus$/)).toBe(false)
  await focused.unmount()
})

test('in a narrow pane the usage values move under their label', async ($, on) => {
  statsEngine(on, CACHE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 44 }, surface: 'terminal' })
  expect(await has(ui, /^Total\scost:\s+\$1\.2346$/)).toBe(true)
  expect(await has(ui, /^Usage:$/)).toBe(true)
  expect(await has(ui, /^\s\s0\sinput\s·\s0\soutput$/)).toBe(true)
  expect(await has(ui, /^\s\s0\scache\sread\s·\s0\scache\swrite$/)).toBe(true)
  // Ohne „cost“, damit die Zeile in 44 Spalten passt.
  expect(await has(ui, /^\s+7d\s+\S+\stokens\s+from\sOct\s30$/)).toBe(true)
  await ui.unmount()
})

test('the app graphics follow a light theme', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  let theme = 'dark'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme }] }))
  on('config.set', (_, e) => ({ value: e.value }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure(measure)
  const source = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
    await ui.unmount()

    return svg
  }

  expect(await source()).toContain('#3A3F55')
  theme = 'light'
  await $.config.set({ key: 'theme', value: 'light' })
  expect(await source()).toContain('#5769F7')
  expect(await source()).not.toContain('#3A3F55')
})

test('the stats tabs read stats-cache.json once a minute, not on every redraw', async ($, on) => {
  statsEngine(on, CACHE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const before = statsReads

  await ui.press({ key: 'tab-stats' })
  await ui.press({ key: 'tab-2' })
  await ui.press({ key: 'range-1' })
  await ui.press({ key: 'tab-1' })
  expect(statsReads - before).toBeLessThanOrEqual(1)
  await ui.unmount()
})

test('the cost note shortens to one line once every span is tracked', async ($, on) => {
  statsEngine(on, null, { ledgerStart: NOW - 31 * 86_400_000 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ ...measure, cost: { usd: 3.5 } })

  const later = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await has(later, /^Cost\sis\san\sAPI-price\sestimate/)).toBe(true)
  expect(await has(later, /^Tracked\ssince/)).toBe(false)
  await later.unmount()
})

// Clawd neben dem Preis: Kopf in der Leiste, darunter zwei Zeilen, rechts davon die Szene.
// Am Hahn ohne Sonnenschirm: oben nur der aufgedrehte Hahn.
const TAP_HEAD = '       ┻┓'
const tapText = async (ui: Drawing) => {
  const found = await ui.find({ type: 'Box', key: 'hahn' })

  return found === undefined ? undefined : plain(found.text)
}
const rowText = async (ui: Drawing, key: string) => plain((await ui.find({ key }))?.text)
const sprayText = async (ui: Drawing) => plain((await ui.find({ key: 'strahl' }))?.text).trimEnd()
// Die zweite Zeile ohne die Liter, die rechtsbündig darunter stehen.
const puddleText = async (ui: Drawing) =>
  plain((await ui.find({ key: 'pfuetze' }))?.text).replace(/ *≈ [\d.,]+ (ml|L)$/, '').trimEnd()
const DROPS = /^[˙·.]?$/
// Die Anfahrt dauert knapp drei Sekunden.
const ARRIVAL = 3_000
// So lange läuft das Wasser nach dem Ende einer Antwort höchstens noch aus.
const DRAIN = 2_500
type Clock = { advance: (ms: number) => Promise<void> }
type Commands = { command: { run: (e: { command: string; args: string }) => Promise<{ text?: string }> } }
async function cast($: Commands, clock: Clock, role: string) {
  await $.command.run({ command: 'clawd', args: role })
  await clock.advance(ARRIVAL)
}
const svgOf = async (ui: unknown) =>
  (await (ui as Many).findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).includes('Clawd') || String(svg.props.alt).includes('arriving'))

// Startet eine Antwort, die streamt, bis `close` sie beendet.
async function openStream($: Engine, chars = 4_000) {
  streamChars = chars
  let release = () => {}
  tapOpen = new Promise<void>(resolve => (release = resolve))
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1 })[Symbol.asyncIterator]()
  await stream.next()
  const rest = (async () => {
    while (!(await stream.next()).done) {
      // weiterlesen
    }
  })()

  return async () => {
    release()
    tapOpen = null
    await rest
  }
}

// Das Wasser am Hahn: Spalte 8 neben Clawd, Tropfen oder Strahl, leer ist zu.
const tapWater = async (ui: Drawing) => ((await rowText(ui, 'clawd'))[8] ?? ' ').trim()
const JET = /^[┃╏]$/
const THIN = /^[│╎]$/

test('every job draws in the terminal and in the apps, and tempo and size change the picture', () => {
  const colors = { suggestion: '#B1B9F9', gray: '#B0AEA5' }
  const text = (scene: Scene) => {
    const drawn = terminalScene(scene, 0, 24)
    return [drawn.head, ...drawn.rows.flatMap(row => [row.slot, row.right])].map(piecesText).join('|')
  }
  for (const role of ROLES) {
    const rest: Scene = { role, water: null, strength: 0, tick: 0, level: 0, arrival: -1 }
    const pictures = (draw: (scene: Scene) => string) => [
      draw(rest),
      // Jede Stärke im zweiten Bild ihrer Folge, mitten im Fall oder Strahl.
      ...[0, 1, 2, 3].map(strength => draw({ ...rest, water: FLOWS[strength]?.[1] ?? null, strength, tick: 1 })),
    ]
    // Am Hahn wächst die Pfütze: trocken, dann breiter ab 1, 5 und 20 L; im Terminal ist sie nur da.
    const levels = role === 'tap' ? [0, 2, 3, 4] : [0, 3, 6, 10]
    const sizes = (draw: (scene: Scene) => string) => levels.map(level => draw({ ...rest, level }))
    for (const draw of [text, (scene: Scene) => sceneSvg(scene, colors)]) {
      expect({ role, tempo: new Set(pictures(draw)).size }).toEqual({ role, tempo: 5 })
      expect({ role, size: new Set(sizes(draw)).size }).toEqual({ role, size: role === 'tap' && draw === text ? 2 : 4 })
    }
    // Jede Zeile bleibt so breit wie Clawds Platz, die Szene so breit wie der Zähler.
    for (const scene of [rest, { ...rest, level: 10, water: FLOWS[3]?.[0] ?? null, strength: 3 }, { ...rest, arrival: 4 }, { ...rest, arrival: 12 }]) {
      const drawn = terminalScene(scene, 6, 24)
      expect([...piecesText(drawn.head)].length).toBe(9)
      for (const row of drawn.rows) {
        expect([...piecesText(row.left)].length).toBe(6)
        expect([...piecesText(row.slot)].length).toBe(9)
        expect([...piecesText(row.right)].length).toBe(24)
      }
      expect(sceneAlt(scene)).not.toBe('')
      expect(sceneSvg(scene, colors)).toMatch(/^<svg [^>]*viewBox="0 3 60 27">.*<\/svg>$/)
    }
  }
})

test('in the light theme the white things get a contour; the dark theme stays as it was', () => {
  const dark = { suggestion: '#B1B9F9', gray: '#B0AEA5' }
  const light = { suggestion: '#5769F7', gray: '#6B6A65', isLight: true }
  for (const role of ROLES) {
    const scene: Scene = { role, water: null, strength: 0, tick: 0, level: 10, arrival: -1 }
    // Dunkel mit und ohne Schalter gleich.
    expect(sceneSvg(scene, { ...dark, isLight: false })).toBe(sceneSvg(scene, dark))
  }
  const shower = sceneSvg({ role: 'shower', water: null, strength: 0, tick: 0, level: 10, arrival: -1 }, light)
  expect(shower).not.toContain('fill="#FFFFFF" fill-opacity')
  // Am Hahn gibt es kein Becken mehr, nur die Pfütze in der Farbe des Wassers.
  const tap = sceneSvg({ role: 'tap', water: null, strength: 0, tick: 0, level: 1, arrival: -1 }, light)
  expect(tap).toMatch(/<ellipse cx="44" cy="[\d.]+" rx="4.5" ry="1" fill="#5769F7"/)
})

test('while Claude works Clawd types: the arms take turns and the screen glows', () => {
  const colors = { suggestion: '#B1B9F9', gray: '#B0AEA5' }
  for (const role of ROLES) {
    const working = (tick: number) => sceneSvg({ role, water: FLOWS[2]?.[tick] ?? null, strength: 2, tick, level: 1, arrival: -1 }, colors)
    expect(working(0)).toContain('<rect x="2" y="11" width="4" height="4"')
    expect(working(1)).toContain('<rect x="30" y="11" width="4" height="4"')
    expect(working(0)).toContain('<rect x="10" y="15.6" width="16" height="0.8" fill="#9FD8FF"')
    // Ruht er, hängen beide Ärmchen und das Display ist dunkel.
    const resting = sceneSvg({ role, water: null, strength: 0, tick: 0, level: 1, arrival: -1, idle: 0 }, colors)
    expect(resting).not.toContain('y="11" width="4"')
    expect(resting).not.toContain('#9FD8FF')
  }
})

test('the jet at the tap is as thick as the liters per second', () => {
  const colors = { suggestion: '#B1B9F9', gray: '#B0AEA5' }
  const width = (mlPerSecond: number) => {
    const svg = sceneSvg({ role: 'tap', water: FLOWS[2]?.[0] ?? null, strength: 2, tick: 0, level: 1, arrival: -1, mlPerSecond }, colors)
    return Number(/<path d="M44 13 L44 [\d.]+" [^>]*stroke-width="([\d.]+)"/.exec(svg)?.[1])
  }
  expect(width(5)).toBeLessThan(width(15))
  expect(width(15)).toBeLessThan(width(30))
  expect(width(1_000)).toBe(3.5)
})

test('the steam leaves Clawds face free, arrivals fade in at the edge', () => {
  const colors = { suggestion: '#B1B9F9', gray: '#B0AEA5' }
  // Gesicht: x 8 bis 28, y 8 bis 16; kein Dampfkreis reicht hinein.
  for (const tick of [0, 1]) {
    const shower = sceneSvg({ role: 'shower', water: FLOWS[3]?.[0] ?? null, strength: 3, tick, level: 10, arrival: -1 }, colors)
    const puffs = [...shower.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#FFFFFF"/g)].map(m => m.slice(1).map(Number))
    expect(puffs.length).toBe(10)
    for (const [x = 0, y = 0, r = 0] of puffs) {
      const dx = Math.max(8 - x, 0, x - 28)
      const dy = Math.max(8 - y, 0, y - 16)
      expect({ x, y, free: dx * dx + dy * dy >= r * r }).toEqual({ x, y, free: true })
    }
  }
  // Er macht es sich nicht mehr bequem: auch bei vielen Litern steht er am Laptop.
  const busy = sceneSvg({ role: 'tap', water: null, strength: 0, tick: 0, level: 4, arrival: -1 }, colors)
  expect(busy).not.toContain('rotate(')
  expect(busy).toContain('fill="#C9C7C0"')
  // Wer hereinkommt, blendet am linken Rand ein; angekommen gibt es keine Maske mehr.
  for (const role of ROLES) {
    expect(sceneSvg({ role, water: null, strength: 0, tick: 0, level: 0, arrival: 3 }, colors)).toContain('mask="url(#burn-einfahrt)"')
    expect(sceneSvg({ role, water: null, strength: 0, tick: 0, level: 0, arrival: -1 }, colors)).not.toContain('mask=')
  }
})

test('Clawd arrives at the start and again after half an hour without replies; the water waits', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await $.command.run({ command: 'clawd', args: 'wasserhahn' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // Clawd läuft mit dem Handy von links heran, der Hahn wartet schon; noch keine Pfütze.
  await clock.advance(5 * 120)
  expect(await rowText(ui, 'clawd')).toMatch(/▐▛███▜▌▮/)
  expect(await rowText(ui, 'beine')).not.toMatch(/▁/)
  await clock.advance(ARRIVAL)
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌▮/)

  // Eine Antwort gleich danach: kein neuer Auftritt, das Wasser läuft sofort.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  let close = await openStream($)
  await clock.advance(10)
  expect(await tapWater(ui)).toMatch(JET)
  await close()

  // Nach 31 Minuten Ruhe kommt er erst wieder an, bevor das Wasser läuft.
  await clock.advance(31 * 60_000)
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  close = await openStream($)
  await clock.advance(5 * 120)
  expect(await rowText(ui, 'clawd')).not.toMatch(/^▐▛███▜▌/)
  expect(await rowText(ui, 'clawd')).not.toMatch(/[┃╏│╎]/)
  await clock.advance(ARRIVAL)
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌▮/)
  await close()
  await ui.unmount()
})

test('both jobs arrive on foot with the laptop, to the shower with a towel too', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)

  // Clawd kommt mit dem Handy vor der Nase, Becken und Hahn warten schon; er dreht erst dort auf.
  await $.command.run({ command: 'clawd', args: 'wasserhahn' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(5 * 120)
  expect(await tapText(ui)).toBe('       ━┓')
  expect(await rowText(ui, 'clawd')).toMatch(/▐▛███▜▌▮/)
  expect(await rowText(ui, 'beine')).not.toMatch(/▁/)
  await clock.advance(ARRIVAL)
  expect(await tapText(ui)).toBe(TAP_HEAD)
  expect(await rowText(ui, 'beine')).toMatch(/^ ▘▘ ▝▝ /)
  await ui.unmount()

  // Zur Dusche mit dem Handtuch.
  await $.command.run({ command: 'clawd', args: 'dusche' })
  const towel = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(5 * 120)
  expect(await rowText(towel, 'clawd')).toMatch(/▐▛███▜▌▬/)
  await towel.unmount()
  const app = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await svgOf(app))?.props.alt).toBe('Clawd walking in with his laptop and a towel')
  await app.unmount()
})

test('after a reply the water runs out instead of stopping: the jet thins, the last drop falls, then the tap closes', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'hahn')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  await close()
  // Gleich nach dem Ende läuft er noch voll, dann eine Stufe nach der anderen schwächer.
  expect(await tapWater(ui)).toMatch(JET)
  await clock.advance(400)
  expect(await tapWater(ui)).toMatch(THIN)
  await clock.advance(600)
  expect(await tapWater(ui)).toMatch(DROPS)
  // Der letzte Tropfen fällt zu Ende, erst dann ist der Hahn zu.
  await clock.advance(DRAIN)
  expect(await tapWater(ui)).toBe('')

  // Kommt die nächste Antwort, solange es noch ausläuft, läuft es ohne neue Anfahrt gleich weiter.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  let again = await openStream($)
  await clock.advance(10)
  await again()
  await clock.advance(300)
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  again = await openStream($)
  await clock.advance(10)
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌▮/)
  expect(await tapWater(ui)).toMatch(JET)
  await again()
  await ui.unmount()
})

test('the water runs as fast as the tokens come: more tokens per second, more frames', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })
  const writes: Record<string, number> = {}
  on('state.set', (_, e, next) => {
    const key = (e as { key?: string }).key ?? ''
    writes[key] = (writes[key] ?? 0) + 1

    return next(e)
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await $.command.run({ command: 'clawd', args: 'hahn' })
  await clock.advance(ARRIVAL)
  // Bilder in 900 ms, solange eine Antwort mit so vielen Zeichen hereinkommt.
  const framesFor = async (chars: number) => {
    usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
    const close = await openStream($, chars)
    await clock.advance(10)
    const before = writes.drip ?? 0
    await clock.advance(900)
    const frames = (writes.drip ?? 0) - before
    await close()
    await clock.advance(DRAIN)

    return frames
  }
  const slow = await framesFor(400)
  const fast = await framesFor(4_000)
  expect(slow).toBeGreaterThan(0)
  expect(fast).toBeGreaterThan(slow * 2)
})

test('while Clawd arrives the hidden water does not redraw the bar', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })
  const writes: Record<string, number> = {}
  on('state.set', (_, e, next) => {
    const key = (e as { key?: string }).key ?? ''
    writes[key] = (writes[key] ?? 0) + 1

    return next(e)
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await $.command.run({ command: 'clawd', args: 'hahn' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  const drips = writes.drip ?? 0
  await clock.advance(2 * 120)
  expect(writes.drip ?? 0).toBe(drips)
  // Angekommen läuft es.
  await clock.advance(ARRIVAL)
  expect(await tapWater(ui)).not.toBe('')
  expect(writes.drip ?? 0).toBeGreaterThan(drips)
  await close()
  await ui.unmount()
})

test('at the tap Clawd works while the water runs onto the floor, and the puddle grows with every liter', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'hahn')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // Hahn offen, Clawd mit Handy; noch kein Wasser, also weder Pfütze noch Liter.
  expect(await tapText(ui)).toBe('       ┻┓')
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌▮ +$/)
  expect(await rowText(ui, 'beine')).toMatch(/^ ▘▘ ▝▝ +$/)

  // 1.000 ausgegebene Tokens sind 112,5 ml; die Eingabe zählt nicht.
  await step($, 300_000, 0, 1_000)
  await clock.advance(5_000)
  expect(await rowText(ui, 'beine')).toMatch(/^ ▘▘ ▝▝ ▁▁▁ +≈ 113 ml$/)

  // Auch ab 1 L steht er weiter da.
  await step($, 0, 0, 10_000)
  await clock.advance(5_000)
  expect(await rowText(ui, 'beine')).toMatch(/^ ▘▘ ▝▝ ▁▁▁ +≈ 1,2 L$/)

  // Viel Tempo: der Strahl schießt in den Abfluss, dort strudelt es.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌▮[┃╏]/)
  expect(await rowText(ui, 'beine')).toMatch(/▁[◌○]▁/)
  await close()
  await clock.advance(DRAIN)
  // Danach tropft nichts nach: der Hahn ist still.
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌▮ +$/)

  // Ab 20 L: kein Liegestuhl, kein Sonnenschirm, er steht weiter da.
  await step($, 0, 0, 200_000)
  await clock.advance(5_000)
  expect(await tapText(ui)).toBe('       ┻┓')
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌▮ +$/)
  expect(await rowText(ui, 'beine')).toMatch(/^ ▘▘ ▝▝ ▁▁▁ +≈ 2\d,\d L$/)
  await ui.unmount()

  const app = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = await svgOf(app)
  expect(svg?.props.alt).toBe('Clawd at his laptop next to the tap')
  // Der Laptop steht vor ihm, der Hebel am Hahn ist rot, die Pfütze ist so breit wie bei 20 L.
  expect(String(svg?.props.source)).toContain('fill="#C9C7C0"')
  expect(String(svg?.props.source)).toContain('#C8372D')
  expect(String(svg?.props.source)).toContain('rx="12" ry="1"')
  expect(plain((await (app as unknown as Drawing).find({ type: 'Text', text: /≈/ }))?.text)).toMatch(/^ ≈ 2\d,\d L$/)
  await app.unmount()
})

// Das Seitenpanel von VS Code ist selten breiter als 100 Zeichen: dort fielen die Liter früher
// als Erstes weg und standen erst ab 106 Zeichen da (bis 0.17.2).
test('in the apps the liters stay as long as Clawd stands there, in VS Code from 47 columns on', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)
  await step($, 0, 0, 10_000)

  // Gestapelt stehen die Liter über dem Zähler neben Clawd und kosten keine Breite.
  for (const [surface, from] of [['vscode', 47], ['desktop', 51]] as const) {
    for (let bodyColumns = from; bodyColumns <= 140; bodyColumns += 1) {
      const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface })
      const liters = plain((await (ui as unknown as Drawing).find({ type: 'Text', text: /≈/ }))?.text)
      expect({ surface, bodyColumns, liters }).toEqual({ surface, bodyColumns, liters: ' ≈ 1,1 L' })
      await ui.unmount()
    }
  }
})

test('liters follow Mistral: 45 ml per 400 output tokens, all time from /stats plus the own book after it', () => {
  expect(literText(0)).toBe('')
  expect(literText(340 * 1)).toBe('≈ 340 ml')
  expect(literText(1_400)).toBe('≈ 1,4 L')
  expect(literText(123_456)).toBe('≈ 123 L')
  expect(1_000 * ML_PER_TOKEN).toBe(112.5)
  expect([0, 1, 999, 1_000, 5_000, 20_000].map(tapLevel)).toEqual([0, 1, 1, 2, 3, 4])
  const day = (ms: number) => Math.floor(ms / 86_400_000)
  const before = Date.parse('2026-10-24T12:00:00Z')
  const after = Date.parse('2026-10-25T12:00:00Z')
  const book = addTo(addTo({ buckets: {}, archived: 0 }, before, 300, before), after, 50, after)
  const cache = { lastComputedDate: '2026-10-24', modelUsage: { a: { outputTokens: 1_000 }, b: { outputTokens: 200 } } } as unknown as StatsCache
  expect(allOutput(cache, [book], day)).toBe(1_250)
  expect(allOutput(null, [book], day)).toBe(350)
})

test('in the endless shower Clawd types while the water runs, and the steam thickens with the session', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'dusche')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // Brause am Rohr, keine Haube; noch kein Dampf, höchstens eine Seifenblase.
  expect(await tapText(ui)).toBe('       ┳┓')
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌ ┃[ o°˙]+$/)
  expect(await puddleText(ui)).toBe('')

  // Viel Tempo: der Strahl prasselt neben ihm herab, und er tippt.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌[┃╏]┃/)
  const app = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await svgOf(app))?.props.alt).toBe('Clawd typing fast on his laptop under the running shower')
  await app.unmount()
  await close()
  await clock.advance(DRAIN)
  expect(await rowText(ui, 'clawd')).not.toMatch(/[♪♫]/)

  // Ab 10m Stufe 7: dichter Dampf in beiden Zeilen.
  await step($, 10_000_000, 0, 1_000)
  await clock.advance(5_000)
  expect(await puddleText(ui)).toMatch(/^[░▒]{7}$/)
  expect(await sprayText(ui)).toMatch(/^[░▒o°˙]{4}$/)
  await ui.unmount()

  const steamy = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await svgOf(steamy))?.props.alt).toBe('Clawd with his laptop under the shower in thick steam')
  // Keine Duschhaube mehr: er sieht aus wie im Logo.
  expect(String((await svgOf(steamy))?.props.source)).not.toContain('#F2A7C3')
  await steamy.unmount()
})

test('idle, Clawd blinks; the tap leaks one drop per loop, in the shower soap bubbles rise and pop', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'hahn')
  const app = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // Eine ganze Schleife von 15 s im Halbsekundentakt: die Bilder wechseln, mal blinzelt er, einmal
  // fällt ein Tropfen aus dem Hahn.
  const sources = new Set<string>()
  let blinks = 0
  let drops = 0
  for (let i = 0; i < 30; i += 1) {
    await clock.advance(500)
    const source = String((await svgOf(app))?.props.source)
    sources.add(source)
    if (source.includes('y="12" width="2" height="2" fill="#1F1E1D"')) blinks += 1
    if (/<ellipse cx="44" cy="[\d.]+" rx="0.9" ry="1.2"/.test(source)) drops += 1
  }
  expect(sources.size).toBeGreaterThanOrEqual(5)
  expect(blinks).toBe(2)
  expect(drops).toBe(3)
  await app.unmount()

  await cast($, clock, 'dusche')
  const shower = await $.ui.mount({ ...BAND, surface: 'desktop' })
  let bubbles = 0
  for (let i = 0; i < 30; i += 1) {
    await clock.advance(500)
    if (String((await svgOf(shower))?.props.source).includes('r="1.5" fill="#B1B9F9" fill-opacity="0.15"')) bubbles += 1
  }
  expect(bubbles).toBeGreaterThan(20)
  // Kommt eine Antwort, ist der Leerlauf vorbei: er tippt, keine Seifenblasen.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  const singing = String((await svgOf(shower))?.props.source)
  expect((await svgOf(shower))?.props.alt).toBe('Clawd typing fast on his laptop under the running shower')
  expect(singing).not.toContain('fill-opacity="0.15"')
  await close()
  await shower.unmount()
})

test('/clawd switches the job, or names the ones it knows', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'clawd', args: 'hahn' })).text).toBe('Clawd: tap.')
  expect((await $.command.run({ command: 'clawd', args: '' })).text).toBe('Clawd: shower.')
  expect((await $.command.run({ command: 'clawd', args: 'Brause' })).text).toBe('Clawd: shower.')
  expect((await $.command.run({ command: 'clawd', args: '' })).text).toBe('Clawd: tap.')
  // Pool, Wanne und See gibt es nicht mehr.
  expect((await $.command.run({ command: 'clawd', args: 'pool' })).text).toBe('Clawd knows: tap, shower.')
})

test('Clawd keeps his width, so the bar does not wrap or switch details while the water runs', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'hahn')
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 116 }, surface: 'terminal' })
  const before = await text(ui)
  expect(before).toBe('✻ Session  ████████ 34% used  ·  Resets 6:40pm   1/3 ›')

  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  for (let i = 0; i < 5; i += 1) {
    await clock.advance(300)
    expect(await text(ui)).toBe(before)
    expect(await tapText(ui)).toBe(TAP_HEAD)
  }
  await close()
  await clock.advance(5_000)
  expect(await text(ui)).toBe(before)
  await ui.unmount()
})

test('in a very narrow bar Clawd goes before any number does', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'hahn')
  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 72 }, surface: 'terminal' })
  expect(await tapText(narrow)).toBeUndefined()
  expect(plain(await liveText(narrow))).toBe('$1.23 · 0 tokens · session ›')
  // Ohne Clawd bleibt links genauso viel wie vorher.
  expect(await text(narrow)).toBe('✻ Session  ████████ 34% used   1/3 ›')
  await narrow.unmount()

  // Knapp: lieber Clawd weg als die Uhrzeit links.
  const tight = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 109 }, surface: 'terminal' })
  expect(await tapText(tight)).toBeUndefined()
  expect(await text(tight)).toBe('✻ Session  ████████ 34% used  ·  Resets 6:40pm   1/3 ›')
  await tight.unmount()
  const roomy = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 116 }, surface: 'terminal' })
  expect(await tapText(roomy)).toBe(TAP_HEAD)
  await roomy.unmount()
})

test('model ids read as names, also with a date or the older order', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  expect(modelName('claude-opus-4-6[1m]')).toBe('Opus 4.6')
})

test('numbers just below a unit round up into it, not to 1000 of the smaller one', async ($, on) => {
  expect(axisLabel(999_960)).toBe('1.0M')
  expect(axisLabel(999.7)).toBe('1.0K')

  statsEngine(on, null)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await step($, 999_000, 0, 960)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await has(ui, /^\s+Session\s+1\.0m\stokens/)).toBe(true)
  expect(await has(ui, /1000\.0k/)).toBe(false)
  await ui.unmount()
})

test('in a narrow pane the context rows shorten their names instead of wrapping', async ($, on) => {
  engine(on)
  on('env.get', () => ({ value: '/Users/l' }))
  mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 34 }, surface: 'terminal' })
  await ui.press({ key: 'tab-3' })
  expect(await has(ui, /^Context\swindow\s+Opus\s5\.5$/)).toBe(true)
  expect(await has(ui, /^◐\sAutocompact\sbuff…\s+33\.0k\s+16\.5%$/)).toBe(true)
  expect(await has(ui, /^●\sMessages\s+53\.3k\s+26\.7%$/)).toBe(true)
  await ui.unmount()
})
