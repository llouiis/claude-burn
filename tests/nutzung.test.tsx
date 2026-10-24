import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { addTo, costFrom, liveTotals } from '../hooks/ledger'

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
    { name: 'Messages', tokens: 53_300, color: 'permission', isDeferred: false, kind: 'used' },
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
  const button = (await ui.find({ key: 'nutzung' }))?.text

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
  await ui.press({ key: 'nutzung' })
  expect(await text(ui)).toBe(
    '✻ Week  ████████ 13% used  ·  Resets Oct 27 at 9:00am (in 3d 16h)   2/3 ›',
  )
  await ui.press({ key: 'nutzung' })
  expect(await text(ui)).toBe(
    '✻ Tokens  ████████ 56.3k / 200.0k  ·  ↑ 1.2m in  ↓ 45.1k out   3/3 ›',
  )
  await ui.unmount()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const app = await $.ui.mount({ ...BAND, surface })
    // In den Apps ein flacher Strich als Svg statt einer ganzen Zeile Blöcke.
    expect((await app.find({ type: 'Svg' }))?.props).toMatchObject({ width: 64, height: 5 })
    expect(await app.find({ type: 'Text', text: /█/ })).toBeUndefined()
    expect(await app.find({ type: 'Text', text: /^✻\s(Session|Week|Tokens)/ })).toBeDefined()
    await app.unmount()
  }
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
  expect(await liveText(ui)).not.toBe('$3.50 · 1.245m tokens · session ›')
  await clock.advance(5_000)
  expect(await liveText(ui)).toBe('$3.50 · 1.245m tokens · session ›')
  // Am ersten Tag: Preis bei session und 24h, nicht bei 7d, 30d und all time.
  await ui.press({ key: 'live' })
  expect(await liveText(ui)).toBe('$3.50 · 1.245m tokens · 24h ›')
  for (const span of ['7d', '30d', 'all time']) {
    await ui.press({ key: 'live' })
    expect(await liveText(ui)).toBe(`1.245m tokens · ${span} ›`)
  }
  await ui.press({ key: 'live' })
  expect(await liveText(ui)).toBe('$3.50 · 1.245m tokens · session ›')
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
    '✻ Usage: values arrive with the next reply',
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
  expect(await hidden.find({ key: 'nutzung' })).toBeUndefined()
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

test('Usage shows cost, limits and context like /usage, on every surface', async ($, on) => {
  statsEngine(on, CACHE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await has(ui, /^Settings\s$/)).toBe(true)
    expect(await has(ui, /^Total\scost:\s+\$1\.2346$/)).toBe(true)
    expect(await has(ui, /^Total\sduration\s\(wall\):\s+3m\s3s$/)).toBe(true)
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
    if (surface === 'terminal') {
      expect(await has(ui, /^Mon\s/)).toBe(true)
      expect(await has(ui, /Oct/)).toBe(true)
      expect(await has(ui, /^\s+Less\s░\s▒\s▓\s█\sMore$/)).toBe(true)
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
  expect(await liveText(ui)).toBe('$1.23 · 12.0k tokens · session ›')
  await step($, 500, 20_000, 2_000)
  await clock.advance(5_000)
  expect(await liveText(ui)).toBe('$1.23 · 34.5k tokens · session ›')
  await ui.unmount()
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

  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 140 }, surface: 'terminal' })
  await band.press({ key: 'nutzung' })
  await band.press({ key: 'nutzung' })
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
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 105 }, surface: 'terminal' })
  const before = await text(ui)
  expect(before).toBe('✻ Session  ████████ 34% used  ·  Resets 6:40pm   1/3 ›')

  // Von 0 auf über eine Million: links bleibt alles, wie es war.
  await step($, 4_000, 1_150_000, 30_000)
  await clock.advance(300)
  expect(await text(ui)).toBe(before)
  await clock.advance(5_000)
  expect(await liveText(ui)).toBe('$1.23 · 1.184m tokens · session ›')
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
const HELMET = '▂▄▆███▆▖ '
const BODY = '▐▛███▜▌━╾'
const tapText = async (ui: Drawing) => {
  const found = await ui.find({ type: 'Box', key: 'hahn' })

  return found === undefined ? undefined : plain(found.text)
}
const rowText = async (ui: Drawing, key: string) => plain((await ui.find({ key }))?.text)
const sprayText = async (ui: Drawing) => plain((await ui.find({ key: 'strahl' }))?.text).trimEnd()
const puddleText = async (ui: Drawing) => plain((await ui.find({ key: 'pfuetze' }))?.text).trimEnd()
const DROPS = /^[˙·.]?$/
// Die Anfahrt dauert knapp drei Sekunden.
const ARRIVAL = 3_000
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

test('firefighter Clawd stands next to the price and sprays only while a reply streams', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'reservoir')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // Zugedreht: Clawd mit Helm, ohne Wasser, das Becken noch leer, auch wenn die Zeit vergeht.
  expect(await tapText(ui)).toBe(HELMET)
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌━╾ +$/)
  expect(await sprayText(ui)).toBe('')
  expect(await puddleText(ui)).toBe('▁▁▁▁▁▁▁▁▁▁▁▁█')
  await clock.advance(2_000)
  expect(await sprayText(ui)).toBe('')

  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($, 40)
  await clock.advance(10)
  expect(plain(await liveText(ui))).toMatch(/↓/)
  // Wenige Tokens pro Sekunde: ein Tropfen fällt in drei Bildern vom Strahlrohr, schlägt im Becken auf, dann eine Pause.
  const frames: string[] = []
  const pools: string[] = []
  for (let i = 0; i < 10; i += 1) {
    const now = await sprayText(ui)
    expect(now).toMatch(DROPS)
    frames.push(now)
    pools.push(await puddleText(ui))
    await clock.advance(300)
  }
  expect(frames.slice(0, 5)).toEqual(['˙', '·', '.', '', ''])
  expect(frames.slice(5)).toEqual(frames.slice(0, 5))
  // Beim Aufschlag schlägt der Tropfen Wellen.
  expect(pools[3]).toMatch(/^▂▁▂/)

  await close()
  await clock.advance(5_000)
  expect(plain(await liveText(ui))).not.toMatch(/↓/)
  expect(await sprayText(ui)).toBe('')
  await ui.unmount()
})

test('Clawd arrives at the start and again after half an hour without replies; the water waits', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await $.command.run({ command: 'clawd', args: 'fire' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // Das Feuerwehrauto fährt von links heran, Clawd sitzt noch drin.
  expect((await tapText(ui))?.trim()).toBe('')
  await clock.advance(5 * 120)
  expect(await rowText(ui, 'clawd')).toMatch(/▄▄▄▄▄▄▐█▙/)
  expect(await rowText(ui, 'beine')).toMatch(/▀●▀▀▀▀●▀▀/)
  // Es hält, Clawds Helm schaut über das Dach, dann fährt es weiter.
  await clock.advance(7 * 120)
  expect(await tapText(ui)).toBe(HELMET)
  await clock.advance(ARRIVAL)
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌━╾/)
  expect(await rowText(ui, 'clawd')).not.toMatch(/●|▙/)

  // Eine Antwort gleich danach: kein neuer Auftritt, das Wasser läuft sofort.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  let close = await openStream($)
  await clock.advance(10)
  expect(await sprayText(ui)).toMatch(/^[━╍]{5}┓/)
  await close()

  // Nach 31 Minuten Ruhe kommt er erst wieder angefahren, bevor er spritzt.
  await clock.advance(31 * 60_000)
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  close = await openStream($)
  await clock.advance(10)
  expect((await tapText(ui))?.trim()).toBe('')
  expect(await sprayText(ui)).not.toMatch(/[━╍]/)
  await clock.advance(ARRIVAL)
  expect(await tapText(ui)).toBe(HELMET)
  await close()
  await ui.unmount()
})

test('the more tokens per second stream in, the further the hose sprays', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'reservoir')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // 1000 Tokens auf einmal: über zwei Sekunden 500 pro Sekunde, ein starker Strahl, dessen Striche wandern.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  const first = await sprayText(ui)
  expect(first).toMatch(/^[━╍]{5}┓$/)
  await clock.advance(150)
  const second = await sprayText(ui)
  expect(second).toMatch(/^[━╍]{5}┓$/)
  expect(second).not.toBe(first)
  // Kommt nichts mehr nach, wird es nach zwei Sekunden wieder ein Tröpfeln.
  await clock.advance(2_100)
  expect(await sprayText(ui)).toMatch(DROPS)
  await close()
  await ui.unmount()

  // In den Apps derselbe Strahl als gestrichelter Bogen.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 300 })
  const app = await $.ui.mount({ ...BAND, surface: 'vscode' })
  const middle = await openStream($, 1_200)
  await clock.advance(10)
  const hose = await svgOf(app)
  expect(hose?.props.alt).toBe('firefighter Clawd filling the reservoir')
  // 300 Tokens: 150 pro Sekunde, ein dünner Strahl.
  expect(String(hose?.props.source)).toContain('stroke-width="1.2"')
  expect(String(hose?.props.source)).toContain('stroke-dasharray')
  await middle()
  await app.unmount()
})

test('the reservoir fills with the session tokens and overflows the dam when full', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'stausee')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await step($, 300_000, 0, 1_000)
  await clock.advance(5_000)

  // Ab 250k Tokens Stufe 3: der Pegel steht bei ▂, dahinter die Mauer.
  expect(await puddleText(ui)).toBe('▂▂▂▂▂▂▂▂▂▂▂▂█')
  // Die Zeile endet trotzdem genau unter dem Zähler.
  const legs = await rowText(ui, 'beine')
  const live = plain(await liveText(ui))
  expect(legs.startsWith(' ▘▘ ▘▘   ▂▂▂')).toBe(true)
  expect(legs.length).toBe(BODY.length + 1 + live.length)

  // Ab 100m ganz voll: es läuft über die Mauer.
  await step($, 100_000_000, 0, 1_000)
  await clock.advance(5_000)
  expect(await puddleText(ui)).toMatch(/^▇{12}█▁[,▁]$/)
  await ui.unmount()

  // Ohne Platz für drei Zeilen steht Clawd selbst in der Leiste, ohne Becken.
  const flat = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 2 }, surface: 'terminal' })
  expect(await tapText(flat)).toBe(BODY)
  expect(await flat.find({ key: 'pfuetze' })).toBeUndefined()
  await flat.unmount()
})

test('the fire burns down while a reply streams and flares up again in the pause', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'feuer')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const flames = async () => (await puddleText(ui)).trim()

  // Voll: fünf Flammen.
  expect(await flames()).toMatch(/^(▂▅█▆▃|▃▆█▅▂)$/)
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(1_500)
  // Der starke Strahl drückt es schnell runter, aus ist es Glut.
  expect((await flames()).length).toBeLessThan(5)
  await clock.advance(15_000)
  expect(await flames()).toBe('▁▁')
  await close()
  await clock.advance(10)
  // In der Pause raucht es erst, dann lodert es Sekunde um Sekunde wieder auf.
  expect(await sprayText(ui)).toMatch(/~/)
  await clock.advance(12_000)
  expect((await flames()).length).toBe(2)
  await clock.advance(50_000)
  expect(await flames()).toMatch(/^(▂▅█▆▃|▃▆█▅▂)$/)
  await ui.unmount()

  // In den Apps brennt es, bis er löscht.
  const app = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await svgOf(app))?.props.alt).toBe('firefighter Clawd, fire burning')
  await app.unmount()
})

test('gardener Clawd waters a flower bed that grows with the session tokens', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'garten')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await tapText(ui)).toBe('▁▂▅███▅▂▁')
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌▆╸/)
  await step($, 300_000, 0, 1_000)
  await clock.advance(5_000)
  expect(await puddleText(ui)).toBe('✿,✿,✿')

  // Viele Tokens pro Sekunde: die Brause sprüht in Punkten.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  expect(await sprayText(ui)).toMatch(/^[·˙]{5}:$/)
  await close()
  await ui.unmount()

  const app = await $.ui.mount({ ...BAND, surface: 'vscode' })
  const svg = await svgOf(app)
  expect(svg?.props.alt).toBe('gardener Clawd, watering can resting')
  // Strohhut, Gießkanne, Blumen.
  expect(String(svg?.props.source)).toContain('#E8C872')
  expect(String(svg?.props.source)).toContain('#5BA36B')
  await app.unmount()
})

test('under the umbrella it rains with the tokens per second, and the cloud grows with the session', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await $.command.run({ command: 'clawd', args: 'regen' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // Zu Fuß: erst ohne Wolke, die zieht nach.
  await clock.advance(5 * 120)
  expect((await tapText(ui))?.trim()).toBe('')
  expect(await rowText(ui, 'clawd')).toMatch(/▄▆███▆▄/)
  await clock.advance(ARRIVAL)

  expect(await tapText(ui)).toBe('      ▂▄▂')
  expect(await rowText(ui, 'clawd')).toMatch(/^▄▆███▆▄ {2}/)
  expect(await rowText(ui, 'beine')).toMatch(/^▐▛███▜▌/)
  await step($, 10_000_000, 0, 1_000)
  await clock.advance(5_000)
  expect(await tapText(ui)).toBe('  ▂▄▆█▆▄▂')

  // Starker Regen neben dem Schirm.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  expect(await rowText(ui, 'beine')).toMatch(/^▐▛███▜▌╏╏/)
  await close()
  await ui.unmount()

  const app = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await svgOf(app))?.props.alt).toBe('Clawd under an umbrella, cloudy')
  await app.unmount()
})

test('angler Clawd: the float bobs with the tokens per second, the bucket fills with fish', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'angeln')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await tapText(ui)).toBe('▃▅███▅▃ ╱')
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌╱ │/)
  expect(await puddleText(ui)).toBe('●≈≈≈≈≈≈')
  await step($, 300_000, 0, 1_000)
  await clock.advance(5_000)
  expect(await puddleText(ui)).toBe('●≈≈≈≈≈≈ ><>×3')

  // Viel Tempo: die Pose ist unter Wasser, und es beißt einer an.
  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  expect(await puddleText(ui)).toMatch(/^◦˜/)
  expect(await sprayText(ui)).toBe('│ !')
  await close()
  await ui.unmount()

  const app = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await svgOf(app))?.props.alt).toBe('angler Clawd waiting for a bite')
  await app.unmount()
})

test('baker Clawd: the oven glows with the tokens per second, the bread piles up with the session', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'bäcker')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await tapText(ui)).toBe(' ▗▆███▆▖ ')
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌━▬▗▄▄▄▖/)
  expect(await puddleText(ui)).toBe('▐░░░▌')
  // Ab 50m Stufe 9: sechs Brote unten, drei darüber.
  await step($, 50_000_000, 0, 1_000)
  await clock.advance(5_000)
  expect(await puddleText(ui)).toBe('▐░░░▌  ▆▆▆▆▆▆')
  expect(await sprayText(ui)).toBe('▗▄▄▄▖  ▆▆▆')

  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  expect(await puddleText(ui)).toMatch(/^▐███▌/)
  await close()
  await ui.unmount()

  const app = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await svgOf(app))?.props.alt).toBe('baker Clawd next to the oven')
  await app.unmount()
})

test('astronaut Clawd fuels the rocket: the stream follows the tempo, the gauge the session', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await $.command.run({ command: 'clawd', args: 'rakete' })
  const app = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await svgOf(app))?.props.alt).toBe('landing capsule arriving')
  await app.unmount()
  await clock.advance(ARRIVAL)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await tapText(ui)).toBe(' ▗▆▀▀▀▆▖ ')
  expect(await rowText(ui, 'clawd')).toMatch(/^▐▛███▜▌═╸ {4}▗█▖/)
  expect(await puddleText(ui)).toBe('    ▟█▙ ░░░░░')
  await step($, 2_600_000, 0, 1_000)
  await clock.advance(5_000)
  // Stufe 5: zweieinhalb von fünf Feldern.
  expect(await puddleText(ui)).toBe('    ▟█▙ ██▌░░')

  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  await clock.advance(10)
  expect(await sprayText(ui)).toBe('━━━━▗█▖')
  await close()
  await ui.unmount()
})

test('/clawd switches the job, or names the ones it knows', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'clawd', args: 'garten' })).text).toBe('Clawd: garden.')
  expect((await $.command.run({ command: 'clawd', args: '' })).text).toBe('Clawd: rain.')
  expect((await $.command.run({ command: 'clawd', args: 'pirat' })).text).toBe('Clawd knows: reservoir, fire, garden, rain, angler, baker, astronaut.')
})

test('Clawd keeps his width, so the bar does not wrap or switch details while he sprays', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await cast($, clock, 'reservoir')
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 113 }, surface: 'terminal' })
  const before = await text(ui)
  expect(before).toBe('✻ Session  ████████ 34% used  ·  Resets 6:40pm   1/3 ›')

  usages.push({ model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1_000 })
  const close = await openStream($)
  for (let i = 0; i < 5; i += 1) {
    await clock.advance(300)
    expect(await text(ui)).toBe(before)
    expect(await tapText(ui)).toBe(HELMET)
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
  await cast($, clock, 'reservoir')
  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 69 }, surface: 'terminal' })
  expect(await tapText(narrow)).toBeUndefined()
  expect(plain(await liveText(narrow))).toBe('$1.23 · 0 tokens · session ›')
  // Ohne Clawd bleibt links genauso viel wie vorher.
  expect(await text(narrow)).toBe('✻ Session  ████████ 34% used   1/3 ›')
  await narrow.unmount()

  // Knapp: lieber Clawd weg als die Uhrzeit links.
  const tight = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 106 }, surface: 'terminal' })
  expect(await tapText(tight)).toBeUndefined()
  expect(await text(tight)).toBe('✻ Session  ████████ 34% used  ·  Resets 6:40pm   1/3 ›')
  await tight.unmount()
  const roomy = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 113 }, surface: 'terminal' })
  expect(await tapText(roomy)).toBe(HELMET)
  await roomy.unmount()
})

test('in the apps Clawd is a pixel Svg: the fire truck drives in, then he stands at his reservoir', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: NOW })

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.session.measure(measure)
  await $.command.run({ command: 'clawd', args: 'reservoir' })
  const app = await $.ui.mount({ ...BAND, surface: 'vscode' })
  const truck = await svgOf(app)
  expect(truck?.props.alt).toBe('fire truck arriving')
  expect(String(truck?.props.source)).toContain('translate(')
  await clock.advance(ARRIVAL)

  const clawd = await svgOf(app)
  expect(clawd?.props.alt).toBe('firefighter Clawd at the reservoir, hose closed')
  expect(clawd?.props).toEqual(expect.objectContaining({ width: 80, height: 36 }))
  // Roter Helm, Messing-Strahlrohr, Staumauer, kein Wasser.
  expect(String(clawd?.props.source)).toContain('#C8372D')
  expect(String(clawd?.props.source)).toContain('#D4A93F')
  expect(String(clawd?.props.source)).toContain('#8D8B85')
  expect(String(clawd?.props.source)).not.toContain('stroke-dasharray')
  expect(await tapText(app)).toBeUndefined()
  await app.unmount()
})
