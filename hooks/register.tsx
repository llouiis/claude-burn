import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
} from 'claude-code'

import type { ContextInfo, Reading, TokenTotals } from '../types'
import { chartRows, chartSvg, dayLabel } from './chart'
import { PREFIX, SPANS, START_KEY, addTo, costFrom, liveTotals } from './ledger'
import type { Ledger } from './ledger'
import type { Series } from './chart'
import {
  EXTINGUISH,
  FLOWS,
  HEAT_FULL,
  RESTING,
  ROLES,
  ROLE_WORDS,
  SCENE_SVG,
  SLOT,
  arrivalLength,
  sceneAlt,
  sceneSvg,
  sizeLevel,
  stageOf,
  terminalScene,
} from './clawd'
import type { Piece } from './clawd'
import { MONTHS, RANGES, dateOf, dayNumber, heatmap, modelName, summarize } from './stats'
import type { StatsCache } from './stats'

// Tag ändern, wenn sich die Felder ändern: Werte einer älteren Fassung
// überstehen ein Neuladen und würden sonst falsch gelesen.
const reading = atom({ plugin: 'nutzung', key: 'reading' } as const, null, {
  shape: 'reading-3',
})
const tokens = atom(
  { plugin: 'nutzung', key: 'tokens' } as const,
  { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  { shape: 'tokens-2' },
)
const startedAt = atom({ plugin: 'nutzung', key: 'startedAt' } as const, 0)
const now = atom({ plugin: 'nutzung', key: 'now' } as const, 0)
const view = atom({ plugin: 'nutzung', key: 'view' } as const, 0)
const isHidden = atom({ plugin: 'nutzung', key: 'isHidden' } as const, false)
const range = atom({ plugin: 'nutzung', key: 'range' } as const, 0)
// 0 Usage, 1 Stats › Overview, 2 Stats › Models
const tab = atom({ plugin: 'nutzung', key: 'tab' } as const, 0)
const live = atom(
  { plugin: 'nutzung', key: 'live' } as const,
  { session: 0, day: 0, week: 0, month: 0, all: 0 },
  { shape: 'live-1' },
)
const liveSpan = atom({ plugin: 'nutzung', key: 'liveSpan' } as const, 0)
// Geschätzte Ausgabe der Modellaufrufe, die gerade streamen (Zeichen / 4 wie der Spinner).
const streamed = atom({ plugin: 'nutzung', key: 'streamed' } as const, 0)
// Wie weit die Anzeige rechts dem echten Stand hinterherläuft; der Takt baut das ab.
const lag = atom({ plugin: 'nutzung', key: 'lag' } as const, 0)
// Helles Theme: die Svg der Apps nehmen dann die helle Palette.
const isLight = atom({ plugin: 'nutzung', key: 'isLight' } as const, false)
const context = atom({ plugin: 'nutzung', key: 'context' } as const, null as ContextInfo | null, {
  shape: 'context-1',
})
let contextAt = 0
// Holt eine in der Sperrzeit verschluckte Messung nach, damit die letzte Antwort zählt.
let contextLater: { cancel: () => void } | undefined
const streaming = new Map<string, number>()
// Der Zählerstand selbst liegt in Modulwerten. In `streamed` und `lag` kommt er nur,
// wenn die Leiste dadurch eine andere Zahl zeigt: sonst zeichnet jeder Takt umsonst neu.
let inFlight = 0
let behind = 0
let published = ''
// Solange eine fertige Antwort ins Kassenbuch geht, wartet der Takt mit dem Schreiben.
let isSettling = false
let ticker: { cancel: () => void } | undefined
const TICK = 110
// Clawd neben dem Preis, in der Rolle, die diese Sitzung ausgelost hat (siehe clawd.ts).
// Wasser kommt nur, solange gestreamt wird, und umso mehr, je mehr Tokens pro Sekunde kommen:
// tröpfeln, tropfen, Strahl, starker Strahl. Die Szene wächst mit den Tokens der Sitzung.
const TAP_WIDTH = SLOT
const DRIP = 150
// Ab so vielen Tokens pro Sekunde (geschätzt wie der Spinner, über RATE_WINDOW) eine Stufe mehr.
const FLOW_AT = [40, 100, 200]
const RATE_WINDOW = 2_000
let rateSamples: { at: number; amount: number }[] = []
let flowNow = 0
// Unter dieser Breite fällt Clawd weg, bevor Zahlen oder Zeitraum gekürzt werden.
const TAP_MIN_COLUMNS = 80
const drip = atom({ plugin: 'nutzung', key: 'drip' } as const, 0)
const flow = atom({ plugin: 'nutzung', key: 'flow' } as const, 0)
let dripper: { cancel: () => void } | undefined
// Die Rolle, einmal pro Sitzung ausgelost; /clawd wechselt sie von Hand.
const role = atom({ plugin: 'nutzung', key: 'role' } as const, 0)
let roleNow = 0
// Die Anfahrt: Takt seit Beginn, -1 ist angekommen. Sie kommt beim Start und wenn so lange
// nichts gestreamt wurde; das Wasser wartet, bis Clawd an seinem Platz steht.
const arrival = atom({ plugin: 'nutzung', key: 'arrival' } as const, -1)
const ARRIVE_TICK = 120
const PAUSE = 30 * 60_000
let arrivalNow = -1
let arriver: { cancel: () => void } | undefined
let lastActive = 0
// Das Feuer: beim Streamen geht die Hitze runter, in der Pause lodert es langsam wieder auf.
const heat = atom({ plugin: 'nutzung', key: 'heat' } as const, HEAT_FULL)
const flicker = atom({ plugin: 'nutzung', key: 'flicker' } as const, 0)
const KINDLE = 1_000
const KINDLE_STEP = 2
let heatNow = HEAT_FULL
let kindler: { cancel: () => void } | undefined
// Ab wann das Kassenbuch zählt; aus dem Store gelesen, nicht bei jedem Bild.
let trackedSince: number | undefined
// stats-cache.json, eine Minute lang gehalten statt bei jedem Neuzeichnen gelesen.
let statsCache: { at: number; value: StatsCache | null } | undefined

// Der eigene Schlüssel dieser Sitzung im Kassenbuch; ein Neuladen nimmt einen neuen.
const SESSION_ID = crypto.randomUUID()
const LEDGER_KEY = `${PREFIX}${SESSION_ID}`
let ownLedger: Ledger = { buckets: {}, archived: 0 }
// Dasselbe für die Kosten in US-Dollar, aus den Zuwächsen von `session.measure`.
const COST_PREFIX = 'cost:'
const COST_KEY = `${COST_PREFIX}${SESSION_ID}`
let ownCost: Ledger = { buckets: {}, archived: 0 }
let lastCostUsd = 0
const liveCost = atom(
  { plugin: 'nutzung', key: 'liveCost' } as const,
  { session: 0, day: 0, week: 0, month: 0, all: 0 },
  { shape: 'live-cost-1' },
)

const PANE = 'statistik'
const PANE_TITLE = 'Usage'
const STATS_BUTTON = 'Usage'

// Hex nur für die Svg der Apps, die keine Theme-Farben kennen; Text nimmt die Theme-Farben wie /usage.
// Orange wie /usage, Grau für Achsen und Beschriftung, die Balkenfarben wie barColor.
const PALETTE = {
  dark: {
    orange: '#D97757',
    gray: '#B0AEA5',
    rail: '#3A3F55',
    railOpacity: '1',
    dotOpacity: '0.25',
    suggestion: '#B1B9F9',
    success: '#4EBA65',
    warning: '#FFC107',
    error: '#FF6B80',
  },
  light: {
    orange: '#D97757',
    gray: '#6B6A65',
    rail: '#6B6A65',
    railOpacity: '0.25',
    dotOpacity: '0.45',
    suggestion: '#5769F7',
    success: '#2C7A39',
    warning: '#966C1E',
    error: '#AB2B3F',
  },
} as const
type Palette = (typeof PALETTE)['dark' | 'light']
const MODEL_COLORS: Record<string, 'suggestion' | 'success' | 'warning'> = {
  Opus: 'suggestion',
  Sonnet: 'success',
  Haiku: 'warning',
}

const USAGE_LABELS: Record<string, string> = {
  five_hour: 'Current session',
  seven_day: 'Current week (all models)',
  seven_day_opus: 'Current week (Opus)',
  seven_day_sonnet: 'Current week (Sonnet)',
  spend_limit: 'Spend limit',
}
const BAND_LABELS: Record<string, string> = {
  five_hour: 'Session',
  seven_day: 'Week',
  seven_day_opus: 'Week (Opus)',
  seven_day_sonnet: 'Week (Sonnet)',
  spend_limit: 'Spend',
}

const HEAT_CHARS = ['·', '░', '▒', '▓', '█']
// Wie /stats: Zeilen Sonntag bis Samstag, beschriftet Mon, Wed, Fri.
const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']
// Wie /stats: Ein- und Ausgabe im Vergleich mit einem Roman (rund 100.000 Wörter).
const BOOK = { title: 'To Kill a Mockingbird', tokens: 131_000 }

const MARK = '✻ '
const BAR_WIDTH = 8
const HOUR = 3_600_000
const DAY = 24 * HOUR
const pad = (n: number) => String(n).padStart(2, '0')
const nb = (text: string) => text.replace(/ /g, ' ')

// Letzter Sonntag des Monats, 01:00 UTC: dort stellt die EU die Uhren um.
function lastSunday(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0, 1))

  return lastDay.getTime() - lastDay.getUTCDay() * DAY
}

// Zeit in Europe/Berlin, unabhängig von der Zeitzone, in der das Modul läuft.
// Gelesen wird das Ergebnis nur mit den getUTC…-Methoden.
function berlin(ms: number): Date {
  const year = new Date(ms).getUTCFullYear()
  const isSummer = ms >= lastSunday(year, 2) && ms < lastSunday(year, 9)

  return new Date(ms + (isSummer ? 2 : 1) * HOUR)
}

// 24, 13.7k, 10.1m, 1.5b: Zahlen wie in /usage.
function count(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}b`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}m`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`

  return String(Math.round(n))
}

// Rechts in der Leiste genauer, damit man das Hochzählen auch bei Millionen sieht: 1.234m.
function liveCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(3)}b`
  if (n >= 1e6) return `${(n / 1e6).toFixed(3)}m`

  return count(n)
}
// Die längste Form davon: so viel Platz hält die Leiste rechts frei.
const LIVE_WIDTH = '000.000m'.length

// Der Zähler läuft dem Stand nach wie im Spinner: große Sprünge schnell, kleine Schritte sichtbar.
function grow($: EngineInterface, delta: number) {
  behind = Math.max(0, behind + delta)
  if (ticker !== undefined || behind === 0) return
  ticker = $.clock.every(TICK, () => {
    behind = Math.max(0, behind - Math.max(15, Math.ceil(behind * 0.25)))
    if (behind === 0) {
      ticker?.cancel()
      ticker = undefined
    }
    void publish($).catch(() => undefined)
  })
}

// Schreibt den Zählerstand in die Atome, wenn die Leiste dadurch etwas anderes zeigt;
// `force` nach einer Änderung an Summen oder Zeitraum, die die Leiste schon neu zeichnet.
async function publish($: EngineInterface, force = false) {
  if (isSettling && !force) return
  const totals = await read($, live)
  const span = SPANS[(await read($, liveSpan)) % SPANS.length] ?? SPANS[0]
  const shown = `${inFlight > 0 ? '↓' : ''}${liveCount(Math.max(0, totals[span.key] + inFlight - behind))}`
  if (shown === published && !force) return
  published = shown
  await update($, streamed, () => inFlight)
  await update($, lag, () => behind)
}

// Dreht den Hahn auf, solange etwas streamt, und wieder zu; still zeichnet er nichts neu.
// Nach einer langen Pause kommt Clawd zuerst wieder angefahren.
async function tap($: EngineInterface) {
  const at = await $.clock.now()
  if (inFlight > 0) {
    if (dripper === undefined && at - lastActive >= PAUSE) await arrive($)
    lastActive = at
    stopKindling()
    if (dripper !== undefined) return
    await update($, drip, () => 0)
    await measureFlow($)
    dripper = $.clock.every(DRIP, () => void flowTick($).catch(() => undefined))
    return
  }
  rateSamples = []
  if (dripper === undefined) return
  lastActive = at
  dripper.cancel()
  dripper = undefined
  flowNow = 0
  await update($, flow, () => 0)
  await update($, drip, () => 0)
  kindle($)
}

// Startet die Anfahrt von vorn; der Takt zählt hoch und hört am Ende von selbst auf.
async function arrive($: EngineInterface) {
  arriver?.cancel()
  arrivalNow = 0
  await update($, arrival, () => 0)
  const length = arrivalLength(ROLES[roleNow] ?? 'reservoir')
  arriver = $.clock.every(ARRIVE_TICK, () => {
    arrivalNow = arrivalNow + 1 >= length ? -1 : arrivalNow + 1
    if (arrivalNow === -1) {
      arriver?.cancel()
      arriver = undefined
    }
    void update($, arrival, () => arrivalNow).catch(() => undefined)
  })
}

async function setHeat($: EngineInterface, value: number) {
  heatNow = Math.max(0, Math.min(HEAT_FULL, value))
  await update($, heat, () => heatNow)
}

// In der Pause lodert das Feuer jede Sekunde ein Stück auf, bis es wieder voll brennt.
function kindle($: EngineInterface) {
  if (ROLES[roleNow] !== 'fire' || kindler !== undefined || heatNow >= HEAT_FULL) return
  kindler = $.clock.every(KINDLE, () => {
    void (async () => {
      await setHeat($, heatNow + KINDLE_STEP)
      await update($, flicker, i => i + 1)
      if (heatNow >= HEAT_FULL) stopKindling()
    })().catch(() => undefined)
  })
}
function stopKindling() {
  kindler?.cancel()
  kindler = undefined
}

// Neue Rolle: das Feuer brennt wieder voll, und Clawd kommt neu an.
async function cast($: EngineInterface, index: number) {
  roleNow = index
  await update($, role, () => index)
  stopKindling()
  await setHeat($, HEAT_FULL)
  await arrive($)
}

// Merkt sich, wie viele Tokens wann hereinkamen, für die Stärke des Wassers.
async function sampleRate($: EngineInterface, amount: number) {
  if (amount <= 0) return
  rateSamples.push({ at: await $.clock.now(), amount })
  await measureFlow($)
}

// Tokens pro Sekunde über die letzten zwei Sekunden; schreibt nur, wenn die Stufe wechselt.
async function measureFlow($: EngineInterface) {
  const at = await $.clock.now()
  rateSamples = rateSamples.filter(sample => sample.at > at - RATE_WINDOW)
  const rate = rateSamples.reduce((sum, sample) => sum + sample.amount, 0) / (RATE_WINDOW / 1000)
  const next = FLOW_AT.filter(limit => rate >= limit).length
  if (next === flowNow) return
  flowNow = next
  await update($, flow, () => next)
}

async function flowTick($: EngineInterface) {
  await measureFlow($)
  // Gelöscht wird erst, wenn Clawd angekommen ist, und je stärker der Strahl, desto schneller.
  if (ROLES[roleNow] === 'fire' && arrivalNow < 0 && heatNow > 0) {
    await setHeat($, heatNow - (EXTINGUISH[flowNow] ?? 0))
  }
  await update($, drip, i => i + 1)
}

function setStreaming(key: string, estimate: number | undefined) {
  const before = streaming.get(key) ?? 0
  if (estimate === undefined) streaming.delete(key)
  else streaming.set(key, estimate)
  inFlight = [...streaming.values()].reduce((a, b) => a + b, 0)

  return (estimate ?? 0) - before
}

// 4d 6h 24m, 2h 5m, 3m 3s
function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`

  return `${m}m ${seconds % 60}s`
}

// 7:59pm
function clock(local: Date): string {
  const hours = local.getUTCHours()

  return `${hours % 12 || 12}:${pad(local.getUTCMinutes())}${hours < 12 ? 'am' : 'pm'}`
}

// Resets 7:59pm, Resets Oct 26 at 9:59am
function resetsText(resetsAt: string, nowMs: number): string | null {
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return null
  const local = berlin(at)
  const today = berlin(nowMs)
  const isToday = local.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)

  return isToday
    ? `Resets ${clock(local)}`
    : `Resets ${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()} at ${clock(local)}`
}

function remaining(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`

  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function toReading(
  rateLimits: readonly SessionRateLimit[],
  context: SessionContextUsage,
  cost: SessionCost | undefined,
  measuredAt: number,
): Reading {
  return {
    windows: rateLimits.map(limit => ({
      kind: limit.kind,
      percentUsed: limit.percentUsed,
      resetsAt: limit.resetsAt ?? null,
    })),
    contextPercent: context.percent ?? null,
    contextTokens: context.tokens ?? null,
    contextWindow: context.window,
    costUsd: cost?.usd ?? null,
    measuredAt,
  }
}

// Eine Ansicht der Leiste; ohne `percent` steht dort kein Balken.
type View = {
  label: string
  percent: number | null
  amount: string
  // Vom ausführlichsten zum knappsten: die Leiste nimmt das erste, das passt.
  details: string[]
  isStale: boolean
}

function views(current: Reading, totals: TokenTotals, nowMs: number, ctx: ContextInfo | null): View[] {
  const list: View[] = current.windows.map(window => {
    const isStale = window.resetsAt !== null && Date.parse(window.resetsAt) <= nowMs
    const resets = window.resetsAt === null ? null : resetsText(window.resetsAt, nowMs)
    const at = window.resetsAt === null ? 0 : Date.parse(window.resetsAt)

    return {
      label: BAND_LABELS[window.kind] ?? window.kind,
      percent: window.percentUsed,
      amount: `${Math.round(window.percentUsed)}% used`,
      details: isStale
        ? ['reset, new values with the next reply', 'reset']
        : resets === null
          ? []
          : [`${resets} (in ${remaining(at - nowMs)})`, resets],
      isStale,
    }
  })

  const input = totals.input + totals.cacheRead + totals.cacheWrite
  const spent = input + totals.output > 0
  const spend = [
    `↑ ${count(input)} in  ↓ ${count(totals.output)} out`,
    `↑ ${count(input)}  ↓ ${count(totals.output)}`,
  ]
  // Bis zur automatischen Verdichtung: das Wichtigste zuerst, wenn Platz ist.
  const used = current.contextTokens ?? ctx?.total ?? null
  if (ctx?.autoCompactAt != null && used !== null) {
    const left = Math.max(0, ctx.autoCompactAt - used)
    spend.unshift(`${count(left)} to auto-compact  ·  ${spend[0]}`)
    spend.push(`${count(left)} to compact`)
  }
  if (current.contextPercent !== null) {
    const used = current.contextTokens
    list.push({
      label: 'Tokens',
      percent: current.contextPercent,
      amount:
        used === null
          ? `${Math.round(current.contextPercent)}% used`
          : `${count(used)} / ${count(current.contextWindow)}`,
      details: spent || spend.length > 2 ? spend : [],
      isStale: false,
    })
  } else if (spent || spend.length > 2) {
    list.push({ label: 'Tokens', percent: null, amount: '', details: spend, isStale: false })
  }

  return list
}

// Der Balken in den Apps: 64 × 5 Pixel, abgerundet, Farben wie barColor.
const APP_BAR = { width: 64, height: 5 }
function appBar(percent: number, isStale: boolean, colors: Palette): string {
  const { width, height } = APP_BAR
  const fill = isStale ? colors.gray : colors[barColor(percent)]
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  const r = height / 2

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="${r}" fill="${colors.rail}" fill-opacity="${colors.railOpacity}"/>${filled > 0 ? `<rect width="${Math.max(filled, height)}" height="${height}" rx="${r}" fill="${fill}"/>` : ''}</svg>`
}

// Lavendel wie die Balken in /usage, ab 75 % gelb, ab 90 % rot.
function barColor(percent: number) {
  if (percent >= 90) return 'error'
  if (percent >= 75) return 'warning'

  return 'suggestion'
}

const berlinDay = (ms: number) => dayNumber(berlin(ms).toISOString())

async function readCache($: EngineInterface): Promise<StatsCache | null> {
  const at = await $.clock.now()
  if (statsCache !== undefined && at - statsCache.at < 60_000) return statsCache.value
  let value: StatsCache | null
  try {
    const home = (await $.env.get('HOME')) ?? ''
    value = JSON.parse(await $.fs.read(`${home}/.claude/stats-cache.json`)) as StatsCache
  } catch {
    value = null
  }
  statsCache = { at, value }

  return value
}

// Merkt sich den ersten Eintrag ins Kassenbuch, über alle Sitzungen nur einmal.
async function track($: EngineInterface, at: number) {
  if (trackedSince !== undefined) return
  const stored = (await $.store.get(START_KEY)) as number | undefined
  if (stored === undefined) await $.store.set(START_KEY, at)
  trackedSince = stored ?? at
}

// Claude Codes Themes sagen es im Namen: `light`, `light-daltonized`, ... Sonst dunkel.
async function refreshTheme($: EngineInterface, theme?: unknown) {
  let value = theme
  if (value === undefined) {
    try {
      value = (await $.config.list()).find(row => row.key === 'theme')?.value
    } catch {
      value = undefined
    }
  }
  const light = typeof value === 'string' && value.includes('light')
  if ((await read($, isLight)) !== light) await update($, isLight, () => light)
}

// Rechnet Session, 24h, 7d, 30d und Gesamt neu und legt sie für die Leiste ab.
async function ledgersOf($: EngineInterface, prefix: string, ownKey: string, own: Ledger) {
  const ledgers: Ledger[] = []
  for (const key of (await $.store.keys()).filter(k => k.startsWith(prefix))) {
    const value = key === ownKey ? own : ((await $.store.get(key)) as Ledger | undefined)
    if (value !== undefined && typeof value === 'object') ledgers.push(value)
  }

  return ledgers
}

// Wie /context, aber geschätzt ohne Anfragen ans Modell (`summary`); höchstens alle 15 s.
async function refreshContext($: EngineInterface, force = false) {
  const at = await $.clock.now()
  const wait = 15_000 - (at - contextAt)
  if (!force && wait > 0) {
    contextLater ??= $.clock.after(wait, () => {
      contextLater = undefined
      void refreshContext($, true).catch(() => undefined)
    })

    return
  }
  contextLater?.cancel()
  contextLater = undefined
  contextAt = at
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (b === undefined) return
  const api = b.apiUsage
  const read = api?.cache_read_input_tokens ?? 0
  const written = api?.cache_creation_input_tokens ?? 0
  const fresh = api?.input_tokens ?? 0
  const info: ContextInfo = {
    model: b.model,
    total: b.totalTokens,
    max: b.rawMaxTokens,
    percent: b.percentage,
    categories: b.categories.map(c => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
    autoCompactAt: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null,
    memoryFiles: [...b.memoryFiles]
      .sort((x, y) => y.tokens - x.tokens)
      .slice(0, 4)
      .map(f => ({ path: f.path, tokens: f.tokens })),
    mcp: {
      loaded: b.mcpTools.filter(t => t.isLoaded).length,
      all: b.mcpTools.length,
      tokens: b.mcpTools.filter(t => t.isLoaded).reduce((sum, t) => sum + t.tokens, 0),
    },
    skills:
      b.skills === undefined
        ? null
        : { included: b.skills.includedSkills, all: b.skills.totalSkills, tokens: b.skills.tokens },
    agents: { count: b.agents.length, tokens: b.agents.reduce((sum, a) => sum + a.tokens, 0) },
    cache: read + written + fresh > 0 ? { read, written, fresh } : null,
    measuredAt: at,
  }
  await update($, context, () => info)
}

async function refreshLive($: EngineInterface) {
  const ledgers = await ledgersOf($, PREFIX, LEDGER_KEY, ownLedger)
  const costs = await ledgersOf($, COST_PREFIX, COST_KEY, ownCost)
  const nowMs = await $.clock.now()
  const stored = await $.store.get(START_KEY)
  trackedSince = stored === undefined ? undefined : Number(stored)
  const start = trackedSince ?? nowMs
  const totals = await read($, tokens)
  const session = totals.input + totals.output + totals.cacheRead + totals.cacheWrite
  const result = liveTotals(ledgers, start, await readCache($), session, nowMs, berlinDay)
  await update($, live, () => result)
  await publish($, true)
  // Kosten kennt /stats nicht: sie zählen ab dem ersten Eintrag des Mods.
  const cost = liveTotals(costs, start, null, lastCostUsd, nowMs, berlinDay)
  await update($, liveCost, () => cost)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Show or hide the usage bar above the prompt',
    })
    await $.command.register({
      name: 'tokenstats',
      description: 'Open usage and stats: limits, heatmap, tokens per model',
    })
    await $.command.register({
      name: 'clawd',
      description: "Change Clawd's job in the usage bar: reservoir, fire, garden or rain",
    })

    const usage = await $.session.usage()
    const at = await $.clock.now()
    await update($, now, () => at)
    await update($, startedAt, () => usage.startedAt)
    lastCostUsd = usage.cost?.usd ?? 0
    // Ein Neuladen verliert Takt und laufende Ströme: nicht mit altem Rückstand weiterzeichnen.
    streaming.clear()
    inFlight = 0
    dripper?.cancel()
    dripper = undefined
    rateSamples = []
    flowNow = 0
    await update($, flow, () => 0)
    await update($, drip, () => 0)
    // Einmal pro Sitzung ausgelost; Clawd kommt gleich angefahren.
    lastActive = at
    await cast($, Math.floor(Math.random() * ROLES.length) % ROLES.length)
    behind = 0
    published = ''
    await update($, lag, () => 0)
    await update($, streamed, () => 0)
    await refreshTheme($)
    if (usage.rateLimits.length > 0) {
      await update($, reading, () => toReading(usage.rateLimits, usage.context, usage.cost, at))
    }

    await refreshLive($).catch(() => undefined)
    void refreshContext($, true).catch(() => undefined)

    // Jede Minute neu zeichnen, damit Restzeit, Dauer, Resets und 24h stimmen.
    $.clock.every(60_000, () => {
      void $.clock.now().then(t => update($, now, () => t))
      void refreshLive($).catch(() => undefined)
    })

    return next(e)
  })

  // Wie /usage: das Fenster bekommt die Tasten, Esc schließt es.
  on('command.run', { command: 'tokenstats' }, async $ => {
    await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true })

    return { text: 'Usage and stats opened.' }
  })

  // Ohne Wort die nächste Rolle, sonst die genannte; Clawd kommt jedes Mal neu an.
  on('command.run', { command: 'clawd' }, async ($, e) => {
    const word = (e.args ?? '').trim().toLowerCase()
    const named = ROLES.findIndex(one => ROLE_WORDS[one].includes(word))
    if (word !== '' && named === -1) {
      return { text: `Clawd knows: ${ROLES.join(', ')}.` }
    }
    const next = named === -1 ? (roleNow + 1) % ROLES.length : named
    await cast($, next)

    return { text: `Clawd: ${ROLES[next]}.` }
  })

  on('command.run', { command: 'tokens' }, async $ => {
    const wasHidden = await read($, isHidden)
    await update($, isHidden, () => !wasHidden)

    return { text: wasHidden ? 'Usage bar shown.' : 'Usage bar hidden.' }
  })

  on('session.measure', async ($, e, next) => {
    void refreshContext($).catch(() => undefined)
    const at = await $.clock.now()
    await update($, now, () => at)
    if (e.rateLimits.length > 0) {
      await update($, reading, () => toReading(e.rateLimits, e.context, e.cost, at))
    }
    const usd = e.cost?.usd
    if (usd !== undefined && usd > lastCostUsd) {
      ownCost = addTo(ownCost, at, usd - lastCostUsd, at)
      lastCostUsd = usd
      await $.store.set(COST_KEY, ownCost)
      await track($, at)
      await refreshLive($).catch(() => undefined)
    }

    return next(e)
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) await refreshTheme($, result.value).catch(() => undefined)

    return result
  })

  // Live: jeder einzelne Modellaufruf zählt, sobald seine Antwort da ist, auch
  // mitten in einer langen Runde und bei Subagenten. Nicht `turn.complete`:
  // das kommt erst am Ende der Runde und hätte dieselben Tokens noch einmal.
  // Während der Antwort streamt, zählt die Schätzung schon mit; danach ersetzt sie der echte Verbrauch.
  on('turn.step', async function* ($, e, next) {
    const key = `${e.agentId ?? 'main'}:${e.turnId}:${e.index}`
    const stream = next(e)
    let chars = 0
    let shown = 0
    for await (const chunk of stream) {
      yield chunk
      if (chunk.kind === 'text' || chunk.kind === 'thinking') chars += chunk.text.length
      else if (chunk.kind === 'input') chars += chunk.json.length
      const estimate = Math.round(chars / 4)
      if (estimate > shown) {
        grow($, setStreaming(key, estimate))
        await sampleRate($, estimate - shown)
        shown = estimate
        await publish($)
        await tap($)
      }
    }
    const response = await stream.result
    const withdrawn = setStreaming(key, undefined)
    await tap($).catch(() => undefined)
    const used = response.usage
    if (used === null) {
      grow($, withdrawn)
      await publish($)
    }
    if (used !== null) {
      await update($, tokens, totals => ({
        input: totals.input + used.input_tokens,
        output: totals.output + used.output_tokens,
        cacheRead: totals.cacheRead + used.cache_read_input_tokens,
        cacheWrite: totals.cacheWrite + used.cache_creation_input_tokens,
      }))
      const amount =
        used.input_tokens +
        used.output_tokens +
        used.cache_read_input_tokens +
        used.cache_creation_input_tokens
      const at = await $.clock.now()
      // Der Rückstand wächst um die Antwort, die Summe gleich danach auch: bis beides
      // geschrieben ist, zeigt die Leiste den alten Stand statt kurz zu wenig.
      isSettling = true
      grow($, amount + withdrawn)
      ownLedger = addTo(ownLedger, at, amount, at)
      try {
        await $.store.set(LEDGER_KEY, ownLedger)
        await track($, at)
        await refreshLive($).catch(() => undefined)
      } finally {
        isSettling = false
      }
    }

    return response
  })

  // Das Fenster: Usage und Stats wie /usage, Zeile für Zeile.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const isApp = e.surface !== 'terminal' && Svg !== undefined
    const columns = e.props.bodyColumns
    const blank = <Text>{' '}</Text>
    const currentTab = (await read($, tab)) % 4
    const isStats = currentTab === 1 || currentTab === 2
    const colors = isApp && (await read($, isLight)) ? PALETTE.light : PALETTE.dark
    const toUsage = () => void update($, tab, () => 0)
    const toStats = () => void update($, tab, t => (t === 1 || t === 2 ? t : 1))
    const toContext = () => {
      void update($, tab, () => 3)
      void refreshContext($, true).catch(() => undefined)
    }

    // Kopf wie /usage: „Settings“ orange, der gewählte Reiter grau hinterlegt.
    const tabButton = (key: string, name: string, isOn: boolean, background: string, onPress: () => void) => (
      <Button key={key} plain onPress={onPress}>
        <Text backgroundColor={isOn ? background : undefined} color={isOn ? 'inverseText' : undefined}>
          {nb(` ${name} `)}
        </Text>
      </Button>
    )
    const header = (
      <Box flexDirection="row">
        <Text color="claude">{nb('Settings ')}</Text>
        {tabButton('tab-0', 'Usage', currentTab === 0, 'text', toUsage)}
        {tabButton('tab-stats', 'Stats', isStats, 'text', toStats)}
        {tabButton('tab-3', 'Context', currentTab === 3, 'text', toContext)}
      </Box>
    )
    const subTabs = (
      <Box flexDirection="row" gap={1}>
        {tabButton('tab-1', 'Overview', currentTab === 1, 'claude', () => void update($, tab, () => 1))}
        {tabButton('tab-2', 'Models', currentTab === 2, 'claude', () => void update($, tab, () => 2))}
      </Box>
    )
    // Die Tasten stehen unten statt an den Reitern: ein Button mit hotkey zeichnet „1: Usage“,
    // der Kopf bleibt so wie in /usage. Ohne Fokus wirken sie nicht, darum zuerst der Hinweis.
    const keyButton = (hotkey: string, name: string, onPress: () => void) => (
      <Button key={`key-${hotkey}`} plain dimColor hotkey={hotkey} label={name} onPress={onPress}>
        <Text size="footnote">{nb(name)}</Text>
      </Button>
    )
    const keys = [
      keyButton('1', 'Usage', toUsage),
      keyButton('2', 'Stats', toStats),
      keyButton('3', 'Context', toContext),
      ...(isStats
        ? [
            keyButton('o', 'Overview', () => void update($, tab, () => 1)),
            keyButton('m', 'Models', () => void update($, tab, () => 2)),
            keyButton('r', 'cycle dates', () => void update($, range, r => (r + 1) % RANGES.length)),
          ]
        : []),
      <Text size="footnote" dimColor>{nb('Esc to close')}</Text>,
    ]
    const dot = () => <Text size="footnote" dimColor>{nb(' · ')}</Text>
    const footer = (
      <Box flexDirection="row" flexWrap="wrap">
        {!e.props.isFocused && <Text size="footnote" dimColor>{nb('ctrl+x tab to focus')}</Text>}
        {!e.props.isFocused && dot()}
        {keys.flatMap((one, i) => (i === 0 ? [one] : [dot(), one]))}
      </Box>
    )

    // Breiter Balken wie /usage › Usage: Lavendel auf gedimmter Schiene.
    const usageBar = (percent: number) => {
      const width = Math.max(10, Math.min(50, columns - 11))
      const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
      const fill = barColor(percent)

      return isApp ? (
        <Box flexDirection="row" alignItems="center">
          <Box flexDirection="row" width={width} height={1}>
            {filled > 0 && <Box width={filled} height={1} backgroundColor={fill} />}
            {filled < width && <Box width={width - filled} height={1} backgroundColor="subtle" />}
          </Box>
          <Text>{nb(` ${Math.round(percent)}% used`)}</Text>
        </Box>
      ) : (
        <Text mono>
          <Text color={fill}>{'█'.repeat(filled)}</Text>
          <Text color={fill} dimColor>
            {'█'.repeat(width - filled)}
          </Text>
          <Text>{nb(` ${Math.round(percent)}% used`)}</Text>
        </Text>
      )
    }

    if (currentTab === 0) {
      const current = await read($, reading)
      const totals = await read($, tokens)
      const nowMs = (await read($, now)) || (await $.clock.now())
      const since = await read($, startedAt)
      const liveTokens = await read($, live)
      const liveMoney = await read($, liveCost)
      // Die Spaltenflucht bei 23 wie /usage; was im schmalen Fenster nicht passt, rückt
      // unter die Beschriftung, statt in Spalte 0 umzubrechen.
      const line = (label: string, value: string, narrow?: string[]) =>
        columns >= 64 || (narrow === undefined && 23 + value.length <= columns) ? (
          <Text tabular>{nb(`${label.padEnd(23)}${value}`)}</Text>
        ) : (
          <Box flexDirection="column">
            <Text>{nb(label)}</Text>
            {(narrow ?? [value]).map(part => (
              <Text tabular>{nb(`  ${part}`)}</Text>
            ))}
          </Box>
        )
      const block = (title: string, percent: number, note: string | null) => (
        <Box flexDirection="column">
          <Text>{nb(title)}</Text>
          {usageBar(percent)}
          {note !== null && <Text dimColor>{nb(note)}</Text>}
        </Box>
      )

      return (
        <Box flexDirection="column">
          {header}
          {blank}
          {line('Total cost:', `$${Math.max(liveMoney.session, current?.costUsd ?? 0).toFixed(4)}`)}
          {line('Total duration (wall):', since > 0 ? duration(nowMs - since) : '0s')}
          {line(
            'Usage:',
            `${count(totals.input)} input, ${count(totals.output)} output, ${count(totals.cacheRead)} cache read, ${count(totals.cacheWrite)} cache write`,
            [
              `${count(totals.input)} input · ${count(totals.output)} output`,
              `${count(totals.cacheRead)} cache read · ${count(totals.cacheWrite)} cache write`,
            ],
          )}
          {current === null ? (
            <Box flexDirection="column">
              {blank}
              <Text dimColor>Usage limits appear after Claude's next reply.</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              {current.windows.map(window => {
                const isStale = window.resetsAt !== null && Date.parse(window.resetsAt) <= nowMs
                const resets = window.resetsAt === null ? null : resetsText(window.resetsAt, nowMs)

                return (
                  <Box flexDirection="column">
                    {blank}
                    {block(
                      USAGE_LABELS[window.kind] ?? window.kind,
                      window.percentUsed,
                      isStale
                        ? 'Reset, new values arrive with the next reply'
                        : resets === null
                          ? null
                          : `${resets} (Europe/Berlin)`,
                    )}
                  </Box>
                )
              })}
              {current.contextPercent !== null && (
                <Box flexDirection="column">
                  {blank}
                  {block(
                    'Current context',
                    current.contextPercent,
                    current.contextTokens === null
                      ? null
                      : `${count(current.contextTokens)} of ${count(current.contextWindow)} tokens`,
                  )}
                </Box>
              )}
            </Box>
          )}
          {blank}
          {/* Extra: Tokens und Kosten je Zeitraum, dieselben Zahlen wie rechts in der Leiste. */}
          <Text>{nb('Tokens & cost')}</Text>
          {SPANS.map(span => (
            <Text>
              <Text>{nb(`  ${(span.label === 'all time' ? 'All time' : span.label === 'session' ? 'Session' : span.label).padEnd(11)}`)}</Text>
              <Text color="claude" tabular>{nb(count(liveTokens[span.key]).padStart(7))}</Text>
              <Text dimColor>{nb(' tokens   ')}</Text>
              {(() => {
                const from = costFrom(span.key, trackedSince, nowMs, berlinDay)
                if (from === true) {
                  return (
                    <Text color="claude" tabular>
                      {nb(`$${liveMoney[span.key].toFixed(2)}`.padStart(9))}
                    </Text>
                  )
                }

                return (
                  <Text dimColor>
                    {nb(from === null ? '        –' : `   cost from ${dayLabel(dateOf(from))}`)}
                  </Text>
                )
              })()}
            </Text>
          ))}
          <Text dimColor>{nb("Cost is an API-price estimate, not your plan's bill.")}</Text>
          {/* Nur in der Anlaufzeit: sobald auch 30d einen Preis hat, ist alles erklärt. */}
          {costFrom('month', trackedSince, nowMs, berlinDay) !== true && (
            <Text dimColor>
              {nb(
                trackedSince === undefined
                  ? 'Tracking starts with the next reply; earlier tokens come from /stats.'
                  : `Tracked since ${dayLabel(berlin(trackedSince).toISOString())}; earlier tokens come from /stats.`,
              )}
            </Text>
          )}
          {blank}
          {footer}
        </Box>
      )
    }

    if (currentTab === 3) {
      const info = await read($, context)
      if (info === null) {
        return (
          <Box flexDirection="column">
            {header}
            {blank}
            <Text dimColor>Context details appear after Claude's next reply.</Text>
            {blank}
            {footer}
          </Box>
        )
      }

      // Ein Streifen wie das Raster von /context: je Kategorie ihre Farbe, Frei grau.
      const width = Math.max(10, Math.min(50, columns - 2))
      const shown = info.categories.filter(c => c.kind !== 'deferred' && c.tokens > 0)
      const cells = shown.map(c => ({ ...c, cells: Math.max(1, Math.round((c.tokens / info.max) * width)) }))
      let over = cells.reduce((sum, c) => sum + c.cells, 0) - width
      // Rundung lässt den Streifen sonst kürzer als die Breite: den Rest bekommt die größte Kategorie.
      if (over < 0 && cells.length > 0) {
        cells.reduce((a, c) => (c.cells > a.cells ? c : a)).cells -= over
        over = 0
      }
      for (const c of [...cells].sort((a, b) => b.cells - a.cells)) {
        if (over <= 0) break
        const cut = Math.min(over, c.cells - 1)
        c.cells -= cut
        over -= cut
      }
      const strip = isApp ? (
        <Box flexDirection="row" width={width} height={1}>
          {cells.map(c => (
            <Box width={c.cells} height={1} backgroundColor={c.kind === 'used' ? c.color : 'subtle'} />
          ))}
        </Box>
      ) : (
        <Text mono>
          {cells.map(c =>
            c.kind === 'used' ? (
              <Text color={c.color}>{'█'.repeat(c.cells)}</Text>
            ) : (
              <Text dimColor>{(c.kind === 'buffer' ? '▒' : '░').repeat(c.cells)}</Text>
            ),
          )}
        </Text>
      )
      const pct = (n: number) => `${((n / info.max) * 100).toFixed(1)}%`
      const row = (mark: ReturnType<typeof h>, name: string, value: number) => (
        <Text>
          {mark}
          <Text>{nb(` ${name.padEnd(22)}`)}</Text>
          <Text color="claude" tabular>{nb(count(value).padStart(7))}</Text>
          <Text dimColor tabular>{nb(`  ${pct(value).padStart(6)}`)}</Text>
        </Text>
      )
      const left = info.autoCompactAt === null ? null : Math.max(0, info.autoCompactAt - info.total)
      const cacheAll = info.cache === null ? 0 : info.cache.read + info.cache.written + info.cache.fresh
      const share = (n: number) => `${Math.round((n / (cacheAll || 1)) * 100)}%`
      const home = ((await $.env.get('HOME')) ?? '').replace(/\/$/, '')
      const shortPath = (path: string) => (home !== '' && path.startsWith(home) ? `~${path.slice(home.length)}` : path)

      return (
        <Box flexDirection="column">
          {header}
          {blank}
          <Text>
            <Text>{nb('Context window  ')}</Text>
            <Text dimColor>{nb(info.model)}</Text>
          </Text>
          {strip}
          <Text>
            <Text color="claude">{nb(count(info.total))}</Text>
            <Text>{nb(` / ${count(info.max)} tokens (${Math.round(info.percent)}%)`)}</Text>
          </Text>
          {left !== null && info.autoCompactAt !== null && (
            <Text dimColor>
              {nb(`Auto-compact at ${count(info.autoCompactAt)} · ${count(left)} to go`)}
            </Text>
          )}
          {info.autoCompactAt === null && <Text dimColor>Auto-compact is off.</Text>}
          {blank}
          {shown.map(c =>
            row(
              c.kind === 'used' ? (
                <Text color={c.color}>●</Text>
              ) : (
                <Text dimColor>{c.kind === 'buffer' ? '◐' : '○'}</Text>
              ),
              c.name,
              c.tokens,
            ),
          )}
          {info.cache !== null && (
            <Box flexDirection="column">
              {blank}
              <Text>{nb('Cache on the last reply')}</Text>
              <Text>
                <Text color="claude">{nb(share(info.cache.read))}</Text>
                <Text dimColor>{nb(` read (${count(info.cache.read)})  ·  `)}</Text>
                <Text>{nb(share(info.cache.written))}</Text>
                <Text dimColor>{nb(` written (${count(info.cache.written)})  ·  `)}</Text>
                <Text>{nb(share(info.cache.fresh))}</Text>
                <Text dimColor>{nb(` new (${count(info.cache.fresh)})`)}</Text>
              </Text>
            </Box>
          )}
          {blank}
          <Text>{nb('Loaded into every request')}</Text>
          <Text dimColor>
            {nb(
              [
                `MCP tools ${info.mcp.loaded}/${info.mcp.all} (${count(info.mcp.tokens)})`,
                info.skills === null ? null : `skills ${info.skills.included}/${info.skills.all} (${count(info.skills.tokens)})`,
                `agents ${info.agents.count} (${count(info.agents.tokens)})`,
              ]
                .filter(x => x !== null)
                .join('  ·  '),
            )}
          </Text>
          {info.memoryFiles.length > 0 && (
            <Box flexDirection="column">
              {blank}
              <Text>{nb('Largest memory files')}</Text>
              {info.memoryFiles.map(f => (
                <Text>
                  <Text dimColor>{nb(`  ${shortPath(f.path).slice(-(Math.max(20, columns - 12)))}`)}</Text>
                  <Text color="claude">{nb(`  ${count(f.tokens)}`)}</Text>
                </Text>
              ))}
            </Box>
          )}
          {blank}
          <Text dimColor>{nb('Estimated like /context; refreshed with every reply.')}</Text>
          {blank}
          {footer}
        </Box>
      )
    }

    const cache = await readCache($)
    if (cache === null) {
      return (
        <Box flexDirection="column">
          {header}
          {subTabs}
          {blank}
          <Text dimColor>No stats yet. Open /stats once and they appear here.</Text>
          {blank}
          {footer}
        </Box>
      )
    }

    const today = berlin(await $.clock.now()).toISOString().slice(0, 10)
    const chosen = (await read($, range)) % RANGES.length
    const days = RANGES[chosen]?.days ?? null
    const summary = summarize(cache, today, days)

    // All time · Last 7 days · Last 30 days, der gewählte orange.
    const ranges = (
      <Box flexDirection="row">
        {RANGES.map((option, index) => (
          <Box flexDirection="row">
            {index > 0 && <Text dimColor>{nb(' · ')}</Text>}
            <Button key={`range-${index}`} plain onPress={() => void update($, range, () => index)}>
              <Text color={index === chosen ? 'claude' : undefined} dimColor={index !== chosen}>
                {nb(option.label)}
              </Text>
            </Button>
          </Box>
        ))}
      </Box>
    )

    // Zwei Spalten wie /stats; die rechte beginnt in Spalte 33.
    const half = 32
    const pair = (left: ReturnType<typeof h>, right?: ReturnType<typeof h>) =>
      columns >= half * 2 ? (
        <Box flexDirection="row">
          <Box width={half}>{left}</Box>
          {right}
        </Box>
      ) : (
        <Box flexDirection="column">
          {left}
          {right}
        </Box>
      )
    // Beschriftung weiß, Wert orange, ein Rest wie „/15“ oder „ days“ dahinter.
    const stat = (label: string, value: string, rest = '', isRestDim = false) => (
      <Text>
        <Text>{nb(`${label}: `)}</Text>
        <Text color="claude">{nb(value)}</Text>
        {rest !== '' && <Text dimColor={isRestDim}>{nb(rest)}</Text>}
      </Text>
    )
    const plural = (n: number) => (n === 1 ? ' day' : ' days')
    const shortDay = (date: string) => dayLabel(date)

    if (currentTab === 1) {
      const weeks = Math.max(8, Math.min(52, columns - 4))
      const map = heatmap(cache, today, weeks)

      let chart: ReturnType<typeof h>
      if (!isApp || Svg === undefined) {
        const monthRow = Array.from({ length: weeks }, () => ' ')
        for (const month of map.months) {
          if (month.week + 3 <= weeks && monthRow.slice(month.week, month.week + 4).every(c => c === ' ')) {
            monthRow.splice(month.week, 3, ...month.label)
          }
        }
        chart = (
          <Box flexDirection="column">
            <Text mono>{nb(`    ${monthRow.join('')}`)}</Text>
            {WEEKDAY_LABELS.map((day, row) => (
              <Text mono>
                <Text>{nb(day.padEnd(4))}</Text>
                {map.levels.map(column => {
                  const level = column[row] ?? -1
                  if (level < 0) return <Text>{' '}</Text>

                  return level === 0 ? (
                    <Text dimColor>{HEAT_CHARS[0]}</Text>
                  ) : (
                    <Text color="claude">{HEAT_CHARS[level]}</Text>
                  )
                })}
              </Text>
            ))}
          </Box>
        )
      } else {
        const cell = 9
        const left = 26
        const top = 14
        const opacity = ['0.25', '0.4', '0.6', '0.8', '1']
        const cells = map.levels.flatMap((column, week) =>
          column.flatMap((level, row) =>
            level < 0
              ? []
              : level === 0
                ? [`<circle cx="${left + week * cell + 4}" cy="${top + row * cell + 4}" r="0.8" fill="${colors.gray}" fill-opacity="${colors.dotOpacity}"/>`]
                : [`<rect x="${left + week * cell}" y="${top + row * cell}" width="8" height="8" fill="${colors.orange}" fill-opacity="${opacity[level]}"/>`],
          ),
        )
        const labels = [
          ...map.months.map(month => `<text x="${left + month.week * cell}" y="10">${month.label}</text>`),
          ...WEEKDAY_LABELS.flatMap((day, row) =>
            day === '' ? [] : [`<text x="0" y="${top + row * cell + 7}">${day}</text>`],
          ),
        ]
        const width = left + weeks * cell
        const height = top + 7 * cell
        chart = (
          <Svg
            alt="Activity heatmap"
            width={width}
            height={height}
            source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, Menlo, monospace" font-size="9" fill="${colors.gray}">${labels.join('')}${cells.join('')}</svg>`}
          />
        )
      }

      const split = summary.split
      const times =
        split === null ? 0 : Math.max(1, Math.round((split.input + split.output) / BOOK.tokens))

      return (
        <Box flexDirection="column">
          {header}
          {subTabs}
          {blank}
          {chart}
          {blank}
          <Text mono>
            <Text>{nb('    Less ')}</Text>
            <Text color="claude">{nb('░ ▒ ▓ █')}</Text>
            <Text>{nb(' More')}</Text>
          </Text>
          {blank}
          {ranges}
          {blank}
          {pair(
            stat('Favorite model', summary.favoriteModel ?? '–'),
            stat('Total tokens', count(summary.tokens)),
          )}
          {blank}
          {pair(
            stat('Sessions', String(summary.sessions)),
            summary.longestSessionMs === null
              ? undefined
              : stat('Longest session', duration(summary.longestSessionMs)),
          )}
          {pair(
            stat('Active days', String(summary.activeDays), `/${summary.spanDays}`, true),
            stat('Longest streak', String(summary.longestStreak), plural(summary.longestStreak)),
          )}
          {pair(
            stat('Most active day', summary.mostActiveDay === null ? '–' : shortDay(summary.mostActiveDay)),
            stat('Current streak', String(summary.currentStreak), plural(summary.currentStreak)),
          )}
          {split !== null && (
            <Text dimColor>
              {nb(
                `Input ${count(split.input)} · Output ${count(split.output)} · Cache read ${count(split.cacheRead)} · Cache write ${count(split.cacheWrite)}`,
              )}
            </Text>
          )}
          {split !== null && blank}
          {split !== null && (
            <Text color="suggestion">
              {`Your input and output are ~${times}x the tokens in ${BOOK.title}`}
            </Text>
          )}
          {blank}
          {pair(stat('Messages', String(summary.messages)), stat('Tool calls', String(summary.toolCalls)))}
          {summary.mostActiveHour !== null &&
            pair(
              stat(
                'Most active hour',
                `${clock(new Date(summary.mostActiveHour * HOUR)).replace(':00', '')}–${clock(new Date(((summary.mostActiveHour + 1) % 24) * HOUR)).replace(':00', '')}`,
              ),
            )}
          {blank}
          {footer}
        </Box>
      )
    }

    // Stats › Models: Tokens per Day als Stufenlinie je Modell, dann die Aufschlüsselung.
    const lastDay = dayNumber(today)
    const firstDay =
      days === null
        ? Math.min(lastDay, ...(cache.dailyModelTokens ?? []).map(entry => dayNumber(entry.date)))
        : lastDay - days + 1
    const dayList = Array.from({ length: lastDay - firstDay + 1 }, (_, i) => dateOf(firstDay + i))
    const totalOf = (id: string) => {
      const m = cache.modelUsage?.[id]

      return m === undefined
        ? 0
        : m.inputTokens + m.outputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens
    }
    const ids = Object.keys(cache.modelUsage ?? {})
    for (const entry of cache.dailyModelTokens ?? []) {
      for (const id of Object.keys(entry.tokensByModel)) if (!ids.includes(id)) ids.push(id)
    }
    ids.sort((a, b) => totalOf(b) - totalOf(a))
    const colorOf = (id: string): [string, string] => {
      const role = MODEL_COLORS[modelName(id).split(' ')[0] ?? '']

      return role === undefined ? ['claude', colors.orange] : [role, colors[role]]
    }
    const perDay = new Map((cache.dailyModelTokens ?? []).map(entry => [entry.date, entry.tokensByModel]))
    const series: Series[] = ids.map(id => ({
      name: modelName(id),
      color: colorOf(id)[0],
      svgColor: colorOf(id)[1],
      values: dayList.map(day => perDay.get(day)?.[id] ?? 0),
    }))
    const all = ids.reduce((sum, id) => sum + totalOf(id), 0) || 1

    const lineChart =
      isApp && Svg !== undefined ? (
        (() => {
          const svg = chartSvg(series, dayList, colors.gray)

          return <Svg alt="Tokens per day by model" width={svg.width} height={svg.height} source={svg.source} />
        })()
      ) : (
        <Box flexDirection="column">
          {chartRows(series, dayList, Math.min(columns, 60)).map(runs => (
            <Text mono>
              {runs.map(run => (
                <Text color={run.color} dimColor={run.isDim === true}>
                  {nb(run.text)}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      )
    const legend = (
      <Text>
        {series.map((one, index) => (
          <Text>
            {index > 0 && <Text dimColor>{nb(' · ')}</Text>}
            <Text color={one.color}>●</Text>
            <Text>{nb(` ${one.name}`)}</Text>
          </Text>
        ))}
      </Text>
    )
    const model = (id: string) => {
      const m = cache.modelUsage?.[id]
      const share = ((totalOf(id) / all) * 100).toFixed(1)

      return (
        <Box flexDirection="column" width={columns >= 76 ? 38 : undefined}>
          <Text>
            <Text dimColor>{nb('● ')}</Text>
            <Text color="claude">{nb(modelName(id))}</Text>
            <Text dimColor>{nb(` (${share}%)`)}</Text>
          </Text>
          {m !== undefined && (
            <Text dimColor>{nb(`  In: ${count(m.inputTokens)} · Out: ${count(m.outputTokens)}`)}</Text>
          )}
          {m !== undefined && (
            <Text dimColor>
              {nb(`  Cache: ${count(m.cacheReadInputTokens)} read · ${count(m.cacheCreationInputTokens)} write`)}
            </Text>
          )}
        </Box>
      )
    }
    // Spaltenweise wie /stats: erst links von oben nach unten, dann rechts.
    const leftCount = Math.ceil(ids.length / 2)
    const breakdown =
      columns >= 76 ? (
        <Box flexDirection="row">
          <Box flexDirection="column" width={38}>
            {ids.slice(0, leftCount).map(model)}
          </Box>
          <Box flexDirection="column">{ids.slice(leftCount).map(model)}</Box>
        </Box>
      ) : (
        <Box flexDirection="column">{ids.map(model)}</Box>
      )

    return (
      <Box flexDirection="column">
        {header}
        {subTabs}
        {blank}
        <Text>{nb('Tokens per Day')}</Text>
        {lineChart}
        {legend}
        {blank}
        {ranges}
        {blank}
        {breakdown}
        {blank}
        {footer}
      </Box>
    )
  })

  // Die Leiste über dem Eingabefeld: eine Ansicht, weiterschalten, Usage, live rechts.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const isTerminal = e.surface === 'terminal'
    const nowMs = (await read($, now)) || (await $.clock.now())

    // Ganz rechts: Tokens live, ein Klick wechselt Session, 24h, 7d, 30d, Gesamt.
    const totals = await read($, live)
    const span = SPANS[(await read($, liveSpan)) % SPANS.length] ?? SPANS[0]
    const costs = await read($, liveCost)
    // Der Preis steht nur, wenn er den ganzen Zeitraum abdeckt.
    const liveMoney =
      costFrom(span.key, trackedSince, nowMs, berlinDay) === true ? `$${costs[span.key].toFixed(2)}` : ''
    const inFlight = await read($, streamed)
    const behindBy = await read($, lag)
    const liveValue = liveCount(Math.max(0, totals[span.key] + inFlight - behindBy))
    // ↓ wie im Spinner, solange eine Antwort hereinkommt.
    const liveArrow = inFlight > 0 ? '↓ ' : ''
    const liveRest = ` tokens · ${span.label} ›`
    // Fest reserviert, mit Pfeil und der längsten Zahl: so bricht die Leiste beim
    // Hochzählen nicht um, und die Details links wechseln nicht mit dem Zählerstand.
    const liveRoom = (liveMoney === '' ? 0 : '$000.00 · '.length) + '↓ '.length + LIVE_WIDTH + liveRest.length
    // Clawd steht in beiden Zuständen gleich breit da (dafür zwei Leerzeichen weniger davor).
    // Er kommt nur, wenn links dafür nichts wegfallen muss.
    const tapRoom = TAP_WIDTH - 1
    const canTap = e.props.bodyColumns >= TAP_MIN_COLUMNS
    const arrivalAt = await read($, arrival)
    const isDripping = inFlight > 0 && arrivalAt < 0
    const strength = await read($, flow)
    const frames = FLOWS[strength] ?? FLOWS[0]
    const water = isDripping ? (frames[(await read($, drip)) % frames.length] ?? RESTING) : null
    const scene = {
      role: ROLES[(await read($, role)) % ROLES.length] ?? 'reservoir',
      water,
      strength,
      tick: await read($, drip),
      level: sizeLevel(Math.max(0, totals.session + inFlight - behindBy)),
      stage: stageOf(await read($, heat)),
      flicker: (await read($, flicker)) + (isDripping ? await read($, drip) : 0),
      arrival: arrivalAt,
    }
    const tapColors = !isTerminal && (await read($, isLight)) ? PALETTE.light : PALETTE.dark
    const isTall = isTerminal && e.props.maxRows >= 3
    const pieces = (list: Piece[]) =>
      list.map((p, i) => (
        <Text key={i} color={p.color} dimColor={p.dim}>
          {nb(p.text)}
        </Text>
      ))
    // Im Terminal stehen unter dem Kopf zwei Zeilen. Rechts davon läuft die Szene in den
    // Leerraum unter dem Zähler, höchstens so breit wie er; links fährt das Auto heran.
    const liveWidth =
      (liveMoney === '' ? 0 : liveMoney.length + ' · '.length) + liveArrow.length + liveValue.length + liveRest.length
    const reach = 1 + liveWidth
    const lane = arrivalAt < 0 ? 0 : Math.max(0, Math.min(24, e.props.bodyColumns - 6 - TAP_WIDTH - reach))
    const drawn = isTerminal ? terminalScene(scene, lane, reach) : null
    const tapPart = !isTerminal && Svg !== undefined ? (
      <Svg
        key="hahn"
        alt={sceneAlt(scene)}
        width={SCENE_SVG.width}
        height={SCENE_SVG.height}
        source={sceneSvg(scene, tapColors)}
      />
    ) : (
      // Mit drei Zeilen steht hier der Kopf, sonst Clawd selbst.
      <Box key="hahn">
        <Text size="footnote" mono>
          {pieces(drawn === null ? [] : isTall ? drawn.head : drawn.flat)}
        </Text>
      </Box>
    )
    const underRow = (key: string, sceneKey: string, row: { left: Piece[]; slot: Piece[]; right: Piece[] }) => (
      <Box key={key} flexDirection="row">
        <Box flexGrow={1} />
        {lane > 0 && <Text mono>{pieces(row.left)}</Text>}
        <Text mono>{pieces(row.slot)}</Text>
        <Box key={sceneKey}>
          <Text mono>{pieces(row.right)}</Text>
        </Box>
      </Box>
    )
    const under = (hasTap: boolean) =>
      isTall && hasTap && drawn !== null
        ? [
            underRow('clawd', 'strahl', drawn.rows[0] ?? { left: [], slot: [], right: [] }),
            underRow('beine', 'pfuetze', drawn.rows[1] ?? { left: [], slot: [], right: [] }),
          ]
        : null
    const withUnder = <T,>(hasTap: boolean, row: T) => {
      const rows = under(hasTap)
      if (rows === null) return row

      return (
        <Box flexDirection="column">
          {row}
          {rows}
        </Box>
      )
    }
    const livePart = (hasTap: boolean) => [
      <Box flexGrow={1} />,
      <Text>{nb(hasTap ? ' ' : '   ')}</Text>,
      hasTap ? tapPart : null,
      hasTap ? <Text>{nb(' ')}</Text> : null,
      <Button
        key="live"
        plain
        onPress={async () => {
          await update($, liveSpan, i => (i + 1) % SPANS.length)
          await publish($, true)
        }}
      >
        {liveMoney !== '' && (
          <Text size="footnote" color="claude" tabular>
            {liveMoney}
          </Text>
        )}
        {liveMoney !== '' && <Text size="footnote" dimColor>{nb(' · ')}</Text>}
        {liveArrow !== '' && <Text size="footnote" dimColor>{nb(liveArrow)}</Text>}
        <Text size="footnote" color="claude" tabular>
          {liveValue}
        </Text>
        <Text size="footnote" dimColor>{nb(liveRest)}</Text>
      </Button>,
    ]

    const current = await read($, reading)
    if (current === null) {
      return withUnder(
        canTap,
        <Box flexDirection="row" alignItems="center">
          <Text mono size={isTerminal ? undefined : 'footnote'} wrap="truncate-end">
            <Text color="claude">{nb(MARK)}</Text>
            <Text dimColor>{nb('Usage: values arrive with the next reply')}</Text>
          </Text>
          {livePart(canTap)}
        </Box>,
      )
    }

    const list = views(current, await read($, tokens), nowMs, await read($, context))
    const index = (await read($, view)) % list.length
    const shown = list[index]
    if (shown === undefined) return next(e)

    const label = `${shown.label}  `
    const amount = shown.amount === '' ? '' : ` ${shown.amount}`
    const separator = shown.amount === '' ? '' : '  ·  '
    const position = list.length > 1 ? `${index + 1}/${list.length} ›` : ''
    const gap = position === '' ? '' : '   '
    const barCells = shown.percent === null ? 0 : BAR_WIDTH
    const fixed =
      MARK.length + label.length + barCells + amount.length + separator.length + gap.length +
      position.length + 2 + STATS_BUTTON.length
    const room = e.props.bodyColumns - 5 - liveRoom
    const detail = shown.details.find(text => fixed + text.length <= room)
    const hasTap = canTap && shown.details.find(text => fixed + text.length <= room - tapRoom) === detail
    const filled =
      shown.percent === null
        ? 0
        : Math.round((Math.min(100, Math.max(0, shown.percent)) / 100) * BAR_WIDTH)
    const color = shown.percent === null || shown.isStale ? undefined : barColor(shown.percent)
    const tail = nb(detail === undefined ? '' : `${separator}${detail}`)
    const colors = !isTerminal && (await read($, isLight)) ? PALETTE.light : PALETTE.dark

    // Farben stehen außerhalb der Buttons: die Desktop-App übermalt deren Inhalt.
    return withUnder(
      hasTap,
      <Box flexDirection="row" alignItems="center">
        {isTerminal ? (
          <Text mono>
            <Text color="claude">{nb(MARK)}</Text>
            <Text>{nb(label)}</Text>
            <Text color={color} dimColor={color === undefined}>
              {'█'.repeat(filled)}
            </Text>
            <Text color={color ?? 'suggestion'} dimColor>
              {shown.percent === null ? '' : '█'.repeat(BAR_WIDTH - filled)}
            </Text>
            <Text>{nb(amount)}</Text>
            <Text dimColor>{tail}</Text>
            <Text>{nb(gap)}</Text>
          </Text>
        ) : (
          <Box flexDirection="row" alignItems="center">
            <Text size="footnote">
              <Text color="claude">{nb(MARK)}</Text>
              <Text>{nb(label)}</Text>
            </Text>
            {shown.percent !== null &&
              (Svg !== undefined ? (
                // Ein schmaler Strich statt einer ganzen Zeile: hält die Leiste flach.
                <Svg
                  alt={`${Math.round(shown.percent)}% used`}
                  width={APP_BAR.width}
                  height={APP_BAR.height}
                  source={appBar(shown.percent, shown.isStale, colors)}
                />
              ) : (
                <Box flexDirection="row" width={BAR_WIDTH} height={1}>
                  {filled > 0 && <Box width={filled} height={1} backgroundColor={color ?? 'inactive'} />}
                  {filled < BAR_WIDTH && <Box width={BAR_WIDTH - filled} height={1} backgroundColor="subtle" />}
                </Box>
              ))}
            <Text size="footnote" tabular>
              <Text>{nb(amount)}</Text>
              <Text dimColor>{tail}</Text>
              <Text>{nb(gap)}</Text>
            </Text>
          </Box>
        )}
        {position !== '' && (
          <Button
            key="nutzung"
            plain
            dimColor
            autoFocus
            label={nb(position)}
            onPress={() => void update($, view, i => (i + 1) % list.length)}
          >
            <Text size="footnote">{nb(position)}</Text>
          </Button>
        )}
        <Text>{nb('  ')}</Text>
        <Button
          key="statistik"
          plain
          dimColor
          label={STATS_BUTTON}
          onPress={() => void $.ui.open({ id: PANE, title: PANE_TITLE, closeOnEscape: true })}
        >
          <Text size="footnote">{STATS_BUTTON}</Text>
        </Button>
        {livePart(hasTap)}
      </Box>,
    )
  })
}
