import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  ModelUsage,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
} from 'claude-code'

import type { ContextInfo, Reading, TokenTotals } from '../types'
import { axisLabel, chartRows, chartSvg, dayLabel } from './chart'
import { PREFIX, SPANS, START_KEY, addTo, allOutput, costFrom, liveTotals } from './ledger'
import type { Ledger } from './ledger'
import type { Series } from './chart'
import {
  appScene,
  APP_LARGE,
  APP_SMALL,
  APP_TINY,
  PIXEL_GRID,
  scenePixels,
  FLOWS,
  RESTING,
  IDLE_LOOP,
  ROLES,
  ROLE_WORDS,
  idleDrip,
  SLOT,
  arrivalLength,
  isRestingAt,
  ML_PER_TOKEN,
  literText,
  sceneAlt,
  sceneSvg,
  tapLevel,
  sizeLevel,
  terminalScene,
} from './clawd'
import type { Piece } from './clawd'
import { MONTHS, RANGES, addToBook, dateOf, dayNumber, heatmap, modelName, summarize, withBooks } from './stats'
import type { DayBook, StatsCache } from './stats'

// Tag ändern, wenn sich die Felder ändern: Werte einer älteren Fassung
// überstehen ein Neuladen und würden sonst falsch gelesen.
const reading = atom({ plugin: 'burn', key: 'reading' } as const, null, {
  shape: 'reading-3',
})
const tokens = atom(
  { plugin: 'burn', key: 'tokens' } as const,
  { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  { shape: 'tokens-2' },
)
const startedAt = atom({ plugin: 'burn', key: 'startedAt' } as const, 0)
const now = atom({ plugin: 'burn', key: 'now' } as const, 0)
const view = atom({ plugin: 'burn', key: 'view' } as const, 0)
const isHidden = atom({ plugin: 'burn', key: 'isHidden' } as const, false)
const range = atom({ plugin: 'burn', key: 'range' } as const, 0)
// 0 Usage, 1 Stats › Overview, 2 Stats › Models
const tab = atom({ plugin: 'burn', key: 'tab' } as const, 0)
const live = atom(
  { plugin: 'burn', key: 'live' } as const,
  { session: 0, day: 0, week: 0, month: 0, all: 0 },
  { shape: 'live-1' },
)
const liveSpan = atom({ plugin: 'burn', key: 'liveSpan' } as const, 0)
// Geschätzte Ausgabe der Modellaufrufe, die gerade streamen (Zeichen / 4 wie der Spinner).
const streamed = atom({ plugin: 'burn', key: 'streamed' } as const, 0)
// Wie weit die Anzeige rechts dem echten Stand hinterherläuft; der Takt baut das ab.
const lag = atom({ plugin: 'burn', key: 'lag' } as const, 0)
// Helles Theme: die Svg der Apps nehmen dann die helle Palette.
const isLight = atom({ plugin: 'burn', key: 'isLight' } as const, false)
const context = atom({ plugin: 'burn', key: 'context' } as const, null as ContextInfo | null, {
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
let streamedNow = 0
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
// Hinauf geht es sofort, hinunter erst unter 70 % der Schwelle (Hysterese), eine Stufe auf einmal
// und frühestens nach FLOW_HOLD: so flackert der Strahl nicht zwischen zwei Stufen hin und her,
// und am Ende klingt er über die schwächeren Stufen ab, statt abzubrechen.
const FLOW_DOWN = 0.7
const FLOW_HOLD = 300
let rateSamples: { at: number; amount: number }[] = []
// -1 zugedreht, sonst die Stufe 0 bis 3 wie FLOWS.
let flowNow = -1
let flowSince = 0
// Der Strom ist zu Ende, das Wasser läuft noch aus: der Strahl wird schwächer, der letzte
// Tropfen fällt, dann erst ist der Hahn zu.
let isDraining = false
// Unter dieser Breite fällt Clawd weg, bevor Zahlen oder Zeitraum gekürzt werden.
// Nur im Terminal: die Apps rechnen mit appCells und appText (siehe die Leiste).
const TAP_MIN_COLUMNS = 80
// In den Apps zählt bodyColumns Zeichen ihrer Code-Schrift (rund 7 bis 8 px breit), ein Svg
// misst in px. Mit 7 px gerechnet: lieber eine Zelle zu viel als eine umbrochene Leiste.
const APP_CELL_PX = 7
const appCells = (px: number) => Math.ceil(px / APP_CELL_PX)
// Text in footnote ist dort proportional und meist schmaler als eine Zelle der Code-Schrift,
// die Ziffern (tabular) aber fast so breit wie eine. Die Leiste ist voll davon: mit 0,95 gerechnet.
const APP_TEXT_CELL = 0.9
const appText = (chars: number) => Math.ceil(chars * APP_TEXT_CELL)
// Was die Apps selbst dazugeben und keine Schätzung sieht: der Innenabstand der Buttons und
// `xs` zwischen zweien in einer Zeile. So viele Zellen bleiben in der Leiste frei.
const APP_SLACK = 3
// Ohne Svg (VS Code) steht die Szene aus Box-Pixeln (scenePixels): Breite in ch, Höhe in lh
// der Chat-Schrift dort (13 px: rund 8,2 px je ch, 18,2 je lh). Groß je 4 × 4 px wie das
// 2-fache Svg (120 × 54 px), klein je 3 × 3 px wie das 1,5-fache, winzig je 2 × 2 px wie das 1-fache.
const APP_PIXEL = {
  large: { width: 0.488, height: 0.22 },
  small: { width: 0.37, height: 0.165 },
  tiny: { width: 0.245, height: 0.11 },
}
const pixelSize = (scale: number) => (scale > APP_SMALL ? APP_PIXEL.large : scale > APP_TINY ? APP_PIXEL.small : APP_PIXEL.tiny)
const APP_CH_PX = 8.2
const drip = atom({ plugin: 'burn', key: 'drip' } as const, 0)
// -1 zugedreht, sonst die Stufe wie flowNow; Wasser zeigt die Szene nur, solange es läuft.
const flow = atom({ plugin: 'burn', key: 'flow' } as const, -1)
let dripper: { cancel: () => void } | undefined
// Die Rolle, einmal pro Sitzung ausgelost; /clawd wechselt sie von Hand.
const role = atom({ plugin: 'burn', key: 'role' } as const, 0)
let roleNow = 0
// Die Anfahrt: Takt seit Beginn, -1 ist angekommen. Sie kommt beim Start und wenn so lange
// nichts gestreamt wurde; das Wasser wartet, bis Clawd an seinem Platz steht.
const arrival = atom({ plugin: 'burn', key: 'arrival' } as const, -1)
const ARRIVE_TICK = 120
const PAUSE = 30 * 60_000
let arrivalNow = -1
let arriver: { cancel: () => void } | undefined
// Der Leerlauf (siehe clawd.ts): Bild 0 bis IDLE_LOOP - 1, solange Clawd dasteht und nichts
// streamt, sonst -1. Der Takt läuft immer mit, schreibt aber nur, wenn er etwas zu zeigen hat.
const idle = atom({ plugin: 'burn', key: 'idle' } as const, -1)
const IDLE_TICK = 500
let idleNow = -1
let idler: { cancel: () => void } | undefined
let lastActive = 0
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
// Die Tokens dieser Unterhaltung, unter ihrer Id gespeichert, damit ein Fortsetzen sie
// wiederfindet. Dazu der Preis beim ersten Zählen: Fehlen die Tokens von früher (eine
// Sitzung von vor 0.16.0), zählen Preis und Tokens beide erst ab da, statt sich zu widersprechen.
const TALLY_PREFIX = 'tally:'
let tallyKey: string | undefined
let costBase = 0
const liveCost = atom(
  { plugin: 'burn', key: 'liveCost' } as const,
  { session: 0, day: 0, week: 0, month: 0, all: 0 },
  { shape: 'live-cost-1' },
)
// Dasselbe nur für die ausgegebenen Tokens, daraus rechnet der Hahn die Liter (ab 25.10.2026).
const OUT_PREFIX = 'out:'
const OUT_KEY = `${OUT_PREFIX}${SESSION_ID}`
let ownOut: Ledger = { buckets: {}, archived: 0 }
const liveOut = atom(
  { plugin: 'burn', key: 'liveOut' } as const,
  { session: 0, day: 0, week: 0, month: 0, all: 0 },
  { shape: 'live-out-1' },
)
// Das Tagebuch dieser Unterhaltung für /tokenstats (siehe stats.ts), unter ihrer Id, damit ein
// Fortsetzen es weiterführt.
const DAYS_PREFIX = 'days:'
let daysKey: string | undefined
let ownDays: DayBook = {}

// So breit stehen die Liter höchstens da, damit die Leiste beim Hochzählen nicht umbricht.
const LITER_WIDTH = ' ≈ 00,0 L'.length

const PANE = 'statistik'
const PANE_TITLE = 'Usage'
const STATS_BUTTON = 'Usage'

// /context färbt manche Kategorien (Messages, MCP) mit den Subagent-Farben des Themes. Die Apps
// kennen diese Namen nicht und lassen sie ungefärbt; dort stehen sie als Hex wie im Standard-Theme.
const SUBAGENT_HEX: Record<string, string> = {
  red_FOR_SUBAGENTS_ONLY: '#DC2626',
  blue_FOR_SUBAGENTS_ONLY: '#6A9BCC',
  green_FOR_SUBAGENTS_ONLY: '#16A34A',
  yellow_FOR_SUBAGENTS_ONLY: '#CA8A04',
  purple_FOR_SUBAGENTS_ONLY: '#827DBD',
  orange_FOR_SUBAGENTS_ONLY: '#D97757',
  pink_FOR_SUBAGENTS_ONLY: '#C46686',
  cyan_FOR_SUBAGENTS_ONLY: '#0891B2',
}
const appColor = (color: string) => SUBAGENT_HEX[color] ?? color

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
    isLight: false,
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
    isLight: true,
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

// 24, 13.7k, 10.1m, 1.5b: Zahlen wie in /usage. Die Schwellen liegen dort, wo die
// kleinere Einheit schon auf 1000 runden würde: 999_960 heißt 1.0m, nicht 1000.0k.
function count(n: number): string {
  if (n >= 999_950_000) return `${(n / 1e9).toFixed(1)}b`
  if (n >= 999_950) return `${(n / 1e6).toFixed(1)}m`
  if (n >= 999.5) return `${(n / 1e3).toFixed(1)}k`

  return String(Math.round(n))
}

// Rechts in der Leiste immer die ganze Zahl, mit Punkten gegliedert: 1.725.034.112 (seit 0.19.0).
const liveCount = (n: number) => Math.round(n).toLocaleString('de-DE')
// So viel Platz hält die Leiste rechts frei: die größte Zahl (all time) mit ihren Stellen voll
// Neunen, mindestens neunstellig. So bleibt er beim Hochzählen und beim Wechsel des Zeitraums gleich.
const liveRoomFor = (n: number) => liveCount(10 ** Math.max(9, String(Math.round(Math.max(0, n))).length) - 1).length

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
  // Jeder Schreibvorgang zeichnet die Leiste neu: den Strom nur, wenn er sich geändert hat.
  if (inFlight !== streamedNow) {
    streamedNow = inFlight
    await update($, streamed, () => inFlight)
  }
  await update($, lag, () => behind)
}

async function idleTick($: EngineInterface) {
  const isIdle = arrivalNow < 0 && dripper === undefined && !(await read($, isHidden))
  if (!isIdle) {
    if (idleNow === -1) return
    idleNow = -1
    await update($, idle, () => -1)
    return
  }
  idleNow = (idleNow + 1) % IDLE_LOOP
  await update($, idle, () => idleNow)
}

// Dreht den Hahn auf, solange etwas streamt; danach läuft das Wasser aus (siehe flowTick),
// still zeichnet er nichts neu. Nach einer langen Pause kommt Clawd zuerst wieder angefahren.
async function tap($: EngineInterface) {
  const at = await $.clock.now()
  if (inFlight > 0) {
    if (dripper === undefined && at - lastActive >= PAUSE) await arrive($)
    lastActive = at
    // Kommt gleich der nächste Strom, läuft das Wasser einfach weiter, ohne neu anzusetzen.
    isDraining = false
    if (dripper !== undefined) return
    await setFlow($, flowFor(rateAt(at), -1, 0), at)
    dripper = $.clock.every(DRIP, () => void flowTick($).catch(() => undefined))
    return
  }
  rateSamples = []
  if (dripper === undefined) return
  lastActive = at
  isDraining = true
}

// Dreht den Hahn ganz zu.
async function closeTap($: EngineInterface) {
  dripper?.cancel()
  dripper = undefined
  isDraining = false
  flowNow = -1
  await update($, flow, () => -1)
  await update($, drip, () => 0)
}

// Startet die Anfahrt von vorn; der Takt zählt hoch und hört am Ende von selbst auf.
async function arrive($: EngineInterface) {
  arriver?.cancel()
  arrivalNow = 0
  await update($, arrival, () => 0)
  const length = arrivalLength(ROLES[roleNow] ?? 'tap')
  arriver = $.clock.every(ARRIVE_TICK, () => {
    arrivalNow = arrivalNow + 1 >= length ? -1 : arrivalNow + 1
    if (arrivalNow === -1) {
      arriver?.cancel()
      arriver = undefined
    }
    void update($, arrival, () => arrivalNow).catch(() => undefined)
  })
}

// Neue Rolle: Clawd kommt neu an.
async function cast($: EngineInterface, index: number) {
  roleNow = index
  await update($, role, () => index)
  await arrive($)
}

// Merkt sich, wie viele Tokens wann hereinkamen, für die Stärke des Wassers.
async function sampleRate($: EngineInterface, amount: number) {
  if (amount <= 0) return
  rateSamples.push({ at: await $.clock.now(), amount })
  await measureFlow($)
}

// Tokens pro Sekunde über die letzten zwei Sekunden.
function rateAt(at: number) {
  rateSamples = rateSamples.filter(sample => sample.at > at - RATE_WINDOW)

  return rateSamples.reduce((sum, sample) => sum + sample.amount, 0) / (RATE_WINDOW / 1000)
}

// Die Stufe zu dieser Rate: hinauf sofort bis zur passenden, hinunter mit Hysterese, eine Stufe
// auf einmal und erst, wenn die jetzige FLOW_HOLD lang stand.
function flowFor(rate: number, current: number, heldFor: number) {
  const target = FLOW_AT.filter(limit => rate >= limit).length
  if (current < 0 || target >= current) return target
  const isBelow = rate < (FLOW_AT[current - 1] ?? 0) * FLOW_DOWN

  return isBelow && heldFor >= FLOW_HOLD ? current - 1 : current
}

// Neue Stufe: die Bildfolge beginnt von vorn, damit kein Tropfen mitten in der Luft auftaucht.
async function setFlow($: EngineInterface, next: number, at: number) {
  flowNow = next
  flowSince = at
  await update($, flow, () => next)
  await update($, drip, () => 0)
}

// Schreibt nur, wenn die Stufe wechselt; zugedreht ändert sie sich nicht.
async function measureFlow($: EngineInterface) {
  if (dripper === undefined) return
  const at = await $.clock.now()
  const next = flowFor(rateAt(at), flowNow, at - flowSince)
  if (next !== flowNow) await setFlow($, next, at)
}

async function flowTick($: EngineInterface) {
  const before = flowNow
  await measureFlow($)
  // Während der Anfahrt bleibt das Wasser verborgen: dann auch kein Bild weiter, das niemand sieht.
  if (arrivalNow >= 0) {
    if (isDraining) await closeTap($)
    return
  }
  if (flowNow !== before) return
  // Ausgelaufen: der letzte Tropfen ist aufgeschlagen.
  const tick = await read($, drip)
  if (isDraining && flowNow === 0 && (isRestingAt(tick) || isRestingAt(tick + 1))) {
    await closeTap($)
    return
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
    // Balken und Zahl zeigen das Kontextfenster: so heißt die Ansicht auch, wie der Reiter im Fenster.
    list.push({
      label: 'Context',
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

// Trägt etwas ins Tagebuch ein, am heutigen Tag in deutscher Zeit.
async function note($: EngineInterface, add: Parameters<typeof addToBook>[3]) {
  if (daysKey === undefined) return
  const local = berlin(await $.clock.now())
  ownDays = addToBook(ownDays, local.toISOString().slice(0, 10), local.getUTCHours(), add)
  await $.store.set(daysKey, ownDays)
}

// Was /tokenstats zeigt: der Zwischenspeicher, danach Tagebücher und Stundenbuch.
async function statsOf($: EngineInterface): Promise<StatsCache | null> {
  const books: DayBook[] = []
  for (const key of (await $.store.keys()).filter(k => k.startsWith(DAYS_PREFIX))) {
    const value = key === daysKey ? ownDays : ((await $.store.get(key)) as DayBook | undefined)
    if (value !== undefined && typeof value === 'object') books.push(value)
  }
  const hourTokens = new Map<number, number>()
  for (const ledger of await ledgersOf($, PREFIX, LEDGER_KEY, ownLedger)) {
    for (const [hour, value] of Object.entries(ledger.buckets)) {
      const day = berlinDay(Number(hour))
      hourTokens.set(day, (hourTokens.get(day) ?? 0) + value)
    }
  }
  const today = berlin(await $.clock.now()).toISOString().slice(0, 10)

  return withBooks(await readCache($), books, hourTokens, today)
}

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

const sumOf = (t: TokenTotals) => t.input + t.output + t.cacheRead + t.cacheWrite

// Beim Start: die gespeicherten Tokens zurück, sonst den Preis als Nullpunkt, wenn er schon läuft.
async function restoreTally($: EngineInterface) {
  const id = await $.session.id()
  tallyKey = `${TALLY_PREFIX}${id}`
  daysKey = `${DAYS_PREFIX}${id}`
  ownDays = ((await $.store.get(daysKey)) as DayBook | undefined) ?? {}
  const kept = (await $.store.get(tallyKey)) as { tokens: TokenTotals; costBase: number } | undefined
  const held = await read($, tokens)
  if (kept !== undefined && sumOf(kept.tokens) > sumOf(held)) await update($, tokens, () => kept.tokens)
  costBase = kept?.costBase ?? (sumOf(held) > 0 ? 0 : lastCostUsd)
  await saveTally($)
}

async function saveTally($: EngineInterface) {
  if (tallyKey === undefined) return
  await $.store.set(tallyKey, { tokens: await read($, tokens), costBase })
}

// Zählt einen fertigen Modellaufruf: Summe der Sitzung, Kassenbuch, Ausgabe für die Liter.
// `withdrawn` ist die Schätzung, die er beim Streamen schon gezeigt hat.
async function countUsage($: EngineInterface, used: ModelUsage, withdrawn: number) {
  await update($, tokens, totals => ({
    input: totals.input + used.input_tokens,
    output: totals.output + used.output_tokens,
    cacheRead: totals.cacheRead + used.cache_read_input_tokens,
    cacheWrite: totals.cacheWrite + used.cache_creation_input_tokens,
  }))
  await saveTally($)
  await note($, {
    model: 'model' in used && typeof used.model === 'string' ? used.model : 'unknown',
    tokens: {
      inputTokens: used.input_tokens,
      outputTokens: used.output_tokens,
      cacheReadInputTokens: used.cache_read_input_tokens,
      cacheCreationInputTokens: used.cache_creation_input_tokens,
    },
  })
  const amount =
    used.input_tokens + used.output_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens
  const at = await $.clock.now()
  // Der Rückstand wächst um die Antwort, die Summe gleich danach auch: bis beides
  // geschrieben ist, zeigt die Leiste den alten Stand statt kurz zu wenig.
  isSettling = true
  grow($, amount + withdrawn)
  ownLedger = addTo(ownLedger, at, amount, at)
  ownOut = addTo(ownOut, at, used.output_tokens, at)
  try {
    await $.store.set(LEDGER_KEY, ownLedger)
    await $.store.set(OUT_KEY, ownOut)
    await track($, at)
    await refreshLive($).catch(() => undefined)
  } finally {
    isSettling = false
  }
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
  const cost = liveTotals(costs, start, null, Math.max(0, lastCostUsd - costBase), nowMs, berlinDay)
  await update($, liveCost, () => cost)
  const outs = await ledgersOf($, OUT_PREFIX, OUT_KEY, ownOut)
  const out = liveTotals(outs, start, null, totals.output, nowMs, berlinDay)
  const all = allOutput(await readCache($), outs, berlinDay)
  await update($, liveOut, () => ({ ...out, all }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Show or hide the usage bar above the prompt',
    })
    await $.command.register({
      name: 'tokenstats',
      description: 'Open Usage, Stats and Context: limits, heatmap, tokens per model, context window',
    })
    await $.command.register({
      name: 'clawd',
      description: "Change Clawd's job in the usage bar; /clawd <job> picks one: tap or shower",
    })

    const usage = await $.session.usage()
    const at = await $.clock.now()
    await update($, now, () => at)
    await update($, startedAt, () => usage.startedAt)
    lastCostUsd = usage.cost?.usd ?? 0
    await restoreTally($)
    // Ein Neuladen verliert Takt und laufende Ströme: nicht mit altem Rückstand weiterzeichnen.
    streaming.clear()
    inFlight = 0
    dripper?.cancel()
    dripper = undefined
    isDraining = false
    rateSamples = []
    flowNow = -1
    await update($, flow, () => -1)
    await update($, drip, () => 0)
    // Einmal pro Sitzung ausgelost; Clawd kommt gleich angefahren.
    lastActive = at
    await cast($, Math.floor(Math.random() * ROLES.length) % ROLES.length)
    behind = 0
    published = ''
    streamedNow = 0
    await update($, lag, () => 0)
    await update($, streamed, () => 0)
    await refreshTheme($)
    if (usage.rateLimits.length > 0) {
      await update($, reading, () => toReading(usage.rateLimits, usage.context, usage.cost, at))
    }

    await refreshLive($).catch(() => undefined)
    void refreshContext($, true).catch(() => undefined)

    idler?.cancel()
    idleNow = -1
    await update($, idle, () => -1)
    idler = $.clock.every(IDLE_TICK, () => void idleTick($).catch(() => undefined))

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
    let hasThought = false
    for await (const chunk of stream) {
      yield chunk
      if (chunk.kind === 'thinking') hasThought = true
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
    if (used !== null) await countUsage($, used, withdrawn)
    // Fürs Tagebuch wie im Transkript: je Block der Antwort eine Message, je Tool-Call sein Ergebnis.
    if (response.stopReason !== null) {
      const calls = response.toolUses.length
      const blocks = (hasThought ? 1 : 0) + (response.answer === '' ? 0 : 1) + calls
      await note($, { messages: Math.max(1, blocks) + calls, toolCalls: calls }).catch(() => undefined)
    }

    return response
  })

  // Jeder Prompt ist eine Message.
  on('prompt.submit', async ($, e, next) => {
    await note($, { messages: 1 }).catch(() => undefined)

    return next(e)
  })

  // Auch das Kompaktieren ist ein Modellaufruf, aber kein turn.step: der Preis
  // (session.measure) enthält ihn schon, die Tokens sonst nicht. Ohne das stand nach
  // einem /compact etwa „$0.32 · 0 tokens“.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (result.skip === undefined && result.usage !== undefined) await countUsage($, result.usage, 0)

    return result
  })

  // Das Fenster: Usage und Stats wie /usage, Zeile für Zeile.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // VS Code rastert jedes Svg in einem eigenen iframe, das hier nicht zeichnet: dann bliebe
    // nur der alt-Text. Dort also Balken aus Box und Heatmap und Diagramm als Text.
    const isApp = e.surface !== 'terminal' && 'Svg' in elements
    const Svg = e.surface !== 'vscode' && 'Svg' in elements ? elements.Svg : undefined
    const columns = e.props.bodyColumns
    // VS Code zeichnet Text nur in seiner Chat-Schrift (mono gilt dort nicht), Box aber treu:
    // Spalten und Diagramme stehen dort aus Boxen mit fester Breite in ch.
    const isBoxApp = e.surface === 'vscode'
    // So viele ch der Chat-Schrift passen in die Breite (gezählt in Zellen der Code-Schrift).
    const columnsCh = Math.floor((columns * APP_CELL_PX) / APP_CH_PX)
    const cellText = (width: number, content: ReturnType<typeof h>, isRight = false) => (
      <Box width={width} flexShrink={0} justifyContent={isRight ? 'flex-end' : 'flex-start'}>
        {content}
      </Box>
    )
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

      // In VS Code ist eine Zeile 1,4 Schrifthöhen hoch: dort ein halb so hoher Balken.
      const barLh = isBoxApp ? 0.5 : 1

      return isApp ? (
        <Box flexDirection="row" alignItems="center" flexWrap={isBoxApp ? 'nowrap' : undefined}>
          <Box flexDirection="row" width={width} height={barLh} flexWrap={isBoxApp ? 'nowrap' : undefined}>
            {filled > 0 && <Box width={filled} height={barLh} backgroundColor={fill} />}
            {filled < width && <Box width={width - filled} height={barLh} backgroundColor="subtle" />}
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
      // unter die Beschriftung, statt in Spalte 0 umzubrechen. `mono`, damit die Flucht
      // auch in den Apps hält; das Terminal ist ohnehin monospaced.
      const line = (label: string, value: string, narrow?: string[]) =>
        (columns >= 64 || (narrow === undefined && 23 + value.length <= columns)) && isBoxApp ? (
          <Box flexDirection="row" flexWrap="nowrap">
            {cellText(21, <Text>{nb(label)}</Text>)}
            <Text tabular>{nb(value)}</Text>
          </Box>
        ) : columns >= 64 || (narrow === undefined && 23 + value.length <= columns) ? (
          <Text mono tabular>{nb(`${label.padEnd(23)}${value}`)}</Text>
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
          {line('Total duration (wall):', duration(since > 0 ? nowMs - since : 0))}
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
          {/* Spalten aus Leerzeichen: `mono` hält sie auch in den Apps untereinander. */}
          {isBoxApp &&
            SPANS.map(span => {
              const from = costFrom(span.key, trackedSince, nowMs, berlinDay)
              const name = span.label === 'all time' ? 'All time' : span.label === 'session' ? 'Session' : span.label

              return (
                <Box flexDirection="row" flexWrap="nowrap">
                  {cellText(10, <Text>{nb(`  ${name}`)}</Text>)}
                  {cellText(7, <Text color="claude" tabular>{count(liveTokens[span.key])}</Text>, true)}
                  {cellText(7, <Text dimColor>{nb(' tokens')}</Text>)}
                  {from === true
                    ? cellText(7, <Text color="claude" tabular>{`$${liveMoney[span.key].toFixed(2)}`}</Text>, true)
                    : cellText(
                        14,
                        <Text dimColor>{nb(from === null ? '      –' : `  ${columns >= 50 ? 'cost ' : ''}from ${dayLabel(dateOf(from))}`)}</Text>,
                      )}
                </Box>
              )
            })}
          {!isBoxApp && SPANS.map(span => (
            <Text mono>
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

                // Im schmalen Fenster ohne „cost“: so bleibt die Zeile eine Zeile.
                return (
                  <Text dimColor>
                    {nb(from === null ? '        –' : `   ${columns >= 50 ? 'cost ' : ''}from ${dayLabel(dateOf(from))}`)}
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
        <Box flexDirection="row" width={width} height={isBoxApp ? 0.5 : 1} flexWrap={isBoxApp ? 'nowrap' : undefined}>
          {cells.map(c => (
            // Puffer und Frei getrennt wie ▒ und ░ im Terminal.
            <Box
              width={c.cells}
              height={isBoxApp ? 0.5 : 1}
              backgroundColor={c.kind === 'used' ? appColor(c.color) : c.kind === 'buffer' ? 'inactive' : 'subtle'}
            />
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
      // Zeichen, Name, Tokens, Anteil: 2 + Name + 7 + 8. Im schmalen Fenster wird der Name
      // gekürzt statt die Zeile umzubrechen; `mono` hält die Spalten auch in den Apps.
      const nameWidth = Math.max(10, Math.min(22, columns - 17))
      const fit = (name: string) =>
        name.length > nameWidth ? `${name.slice(0, nameWidth - 1)}…` : name.padEnd(nameWidth)
      const row = (mark: ReturnType<typeof h>, name: string, value: number) =>
        isBoxApp ? (
          <Box flexDirection="row" flexWrap="nowrap">
            {cellText(2, mark)}
            {cellText(Math.min(20, columnsCh - 16), <Text wrap="truncate-end">{nb(name)}</Text>)}
            {cellText(7, <Text color="claude" tabular>{count(value)}</Text>, true)}
            {cellText(7, <Text dimColor tabular>{pct(value)}</Text>, true)}
          </Box>
        ) : (
        <Text mono>
          {mark}
          <Text>{nb(` ${fit(name)}`)}</Text>
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
            <Text dimColor>{nb(modelName(info.model))}</Text>
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
                <Text color={isApp ? appColor(c.color) : c.color}>●</Text>
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
              {info.memoryFiles.map((f, _, all) => {
                // Lange Pfade verlieren den Anfang, sichtbar mit „…“; die Zahlen stehen untereinander.
                const room = Math.max(20, columns - 12)
                const widest = Math.min(room, Math.max(...all.map(one => shortPath(one.path).length)))
                const path = shortPath(f.path)
                const shown = path.length > room ? `…${path.slice(-(room - 1))}` : path.padEnd(widest)

                return (
                  <Text mono>
                    <Text dimColor>{nb(`  ${shown}`)}</Text>
                    <Text color="claude" tabular>{nb(`  ${count(f.tokens).padStart(6)}`)}</Text>
                  </Text>
                )
              })}
            </Box>
          )}
          {blank}
          <Text dimColor>{nb('Estimated like /context; refreshed with every reply.')}</Text>
          {blank}
          {footer}
        </Box>
      )
    }

    const cache = await statsOf($)
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
      // In den Apps ist eine Woche 9 px breit, eine Zelle nur rund 7: dort nach px gerechnet,
      // sonst ragt das Svg im schmalen Fenster (vscode) über den Rand.
      const weeks = Math.max(
        8,
        Math.min(52, Svg !== undefined ? Math.floor((columns * APP_CELL_PX - 26) / 9) : isBoxApp ? columnsCh - 5 : columns - 4),
      )
      const map = heatmap(cache, today, weeks)
      // In VS Code je Tag ein Kästchen aus Box, je Woche 1 ch breit; leer gedimmt, sonst orange
      // in vier Stufen der Deckkraft wie das Svg.
      const shade = (level: number) =>
        level === 0 ? `${colors.gray}${colors.isLight ? '40' : '30'}` : `${colors.orange}${['', '55', '88', 'BB', 'FF'][level] ?? 'FF'}`
      const square = (level: number) => (
        <Box width={1} height={0.8} flexShrink={0} alignItems="center" justifyContent="center">
          {level >= 0 && <Box width={0.75} height={0.62} backgroundColor={shade(level)} />}
        </Box>
      )

      let chart: ReturnType<typeof h>
      if (isBoxApp) {
        const months = map.months.filter(month => month.week < weeks)
        chart = (
          <Box flexDirection="column">
            <Box flexDirection="row" flexWrap="nowrap">
              <Box width={4 + (months[0]?.week ?? weeks)} flexShrink={0} />
              {months.map((month, i) => cellText((months[i + 1]?.week ?? weeks) - month.week, <Text dimColor wrap="truncate-end">{month.label}</Text>))}
            </Box>
            {WEEKDAY_LABELS.map((day, row) => (
              <Box flexDirection="row" flexWrap="nowrap" alignItems="center" height={0.8}>
                <Box width={4} height={0.8} flexShrink={0} alignItems="center">
                  <Text dimColor>{nb(day)}</Text>
                </Box>
                {map.levels.map(column => square(column[row] ?? -1))}
              </Box>
            ))}
          </Box>
        )
      } else if (!isApp || Svg === undefined) {
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
          {isBoxApp ? (
            <Box flexDirection="row" flexWrap="nowrap" alignItems="center">
              <Box width={4} flexShrink={0} />
              <Text dimColor>{nb('Less ')}</Text>
              {[0, 1, 2, 3, 4].map(square)}
              <Text dimColor>{nb(' More')}</Text>
            </Box>
          ) : (
            <Text mono>
              <Text>{nb('    Less ')}</Text>
              <Text color="claude">{nb('░ ▒ ▓ █')}</Text>
              <Text>{nb(' More')}</Text>
            </Text>
          )}
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

    // In VS Code: je Tag ein Balken aus Box, die Modelle übereinander in ihren Farben, das
    // erste unten; links die Achse, darunter erster und letzter Tag.
    const CHART_LH = 5
    const dayTotals = dayList.map((_, day) => series.reduce((sum, one) => sum + (one.values[day] ?? 0), 0))
    const chartMax = Math.max(1, ...dayTotals)
    const barCh = Math.max(0.4, Math.min(1.5, Math.floor(((columnsCh - 8) / Math.max(1, dayList.length)) * 10) / 10))
    const boxChart = (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="nowrap" alignItems="flex-end" height={CHART_LH}>
          <Box flexDirection="column" justifyContent="space-between" height={CHART_LH} width={6} flexShrink={0}>
            <Text dimColor>{axisLabel(chartMax)}</Text>
            <Text dimColor>0</Text>
          </Box>
          {dayList.map((_, day) => (
            <Box flexDirection="column" justifyContent="flex-end" width={barCh} height={CHART_LH} flexShrink={0}>
              {[...series].reverse().map(one => {
                const value = one.values[day] ?? 0
                return value > 0 ? (
                  <Box width={Math.round(barCh * 0.8 * 100) / 100} height={Math.max(0.05, Math.round(((value / chartMax) * CHART_LH) * 100) / 100)} backgroundColor={one.color} />
                ) : null
              })}
            </Box>
          ))}
        </Box>
        <Box flexDirection="row" flexWrap="nowrap" width={6 + barCh * dayList.length}>
          <Box width={6} flexShrink={0} />
          <Text dimColor>{dayLabel(dayList[0] ?? today)}</Text>
          <Box flexGrow={1} />
          <Text dimColor>{dayLabel(dayList[dayList.length - 1] ?? today)}</Text>
        </Box>
      </Box>
    )
    const lineChart = isBoxApp ? (
      boxChart
    ) : isApp && Svg !== undefined ? (
        (() => {
          const svg = chartSvg(series, dayList, colors.gray)
          // Das Diagramm hat feste px; im schmalen Fenster maßstäblich kleiner, die viewBox hält das Verhältnis.
          const scale = Math.min(1, (columns * APP_CELL_PX) / svg.width)

          return (
            <Svg
              alt="Tokens per day by model"
              width={Math.floor(svg.width * scale)}
              height={Math.floor(svg.height * scale)}
              source={svg.source}
            />
          )
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
            {/* Der Punkt in der Farbe der Linie: so findet man das Modell im Diagramm wieder. */}
            <Text color={colorOf(id)[0]}>{nb('● ')}</Text>
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
    // VS Code rastert jedes Svg in einem eigenen iframe, das hier nicht zeichnet (es meldet sich
    // nicht rechtzeitig, dann steht der alt-Text da). Dort ist der Balken eine Box und Clawd
    // Text wie im Terminal; die Desktop-App behält ihre Svg.
    const Svg = e.surface !== 'vscode' && 'Svg' in elements ? elements.Svg : undefined
    const isTerminal = e.surface === 'terminal'
    const isTextApp = !isTerminal && Svg === undefined
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
    const liveTotal = Math.max(0, totals[span.key] + inFlight - behindBy)
    const liveValue = liveCount(liveTotal)
    // ↓ wie im Spinner, solange eine Antwort hereinkommt.
    const liveArrow = inFlight > 0 ? '↓ ' : ''
    const liveRest = ` tokens · ${span.label} ›`
    // Fest reserviert, mit Pfeil und der längsten Zahl: so bricht die Leiste beim
    // Hochzählen nicht um, und die Details links wechseln nicht mit dem Zählerstand.
    const liveRoomOf = (withMoney: boolean) =>
      (liveMoney === '' || !withMoney ? 0 : '$000.00 · '.length) + '↓ '.length + liveRoomFor(Math.max(liveTotal, totals.all)) + liveRest.length
    const liveRoom = liveRoomOf(true)
    // Clawd steht in beiden Zuständen gleich breit da (dafür zwei Leerzeichen weniger davor).
    // Er kommt nur, wenn links dafür nichts wegfallen muss.
    const tapRoom = TAP_WIDTH - 1
    const canTap = e.props.bodyColumns >= TAP_MIN_COLUMNS
    const arrivalAt = await read($, arrival)
    // Das Wasser läuft, solange der Hahn offen ist: beim Streamen und noch kurz danach, bis es ausgelaufen ist.
    const flowAt = await read($, flow)
    const isDripping = flowAt >= 0 && arrivalAt < 0
    const strength = Math.max(0, flowAt)
    const frames = FLOWS[strength] ?? FLOWS[0] ?? [RESTING]
    const roleAt = ROLES[(await read($, role)) % ROLES.length] ?? 'tap'
    // Im Leerlauf tickt die Szene im eigenen Takt, und am Hahn fällt ab und zu ein Tropfen.
    const idleAt = isDripping || arrivalAt >= 0 ? -1 : await read($, idle)
    const water = isDripping
      ? (frames[(await read($, drip)) % frames.length] ?? RESTING)
      : idleAt >= 0 && roleAt === 'tap'
        ? idleDrip(idleAt)
        : null
    // Die Liter wie der Zähler (Session, 24h, ...); am Hahn die Bequemlichkeit nach der Sitzung.
    const isTap = roleAt === 'tap'
    const outs = await read($, liveOut)
    const sessionOut = (await read($, tokens)).output + inFlight
    const liters = literText((outs[span.key] + inFlight) * ML_PER_TOKEN)
    const scene = {
      role: roleAt,
      water,
      strength,
      tick: idleAt >= 0 ? idleAt : await read($, drip),
      idle: idleAt,
      level: isTap ? tapLevel(sessionOut * ML_PER_TOKEN) : sizeLevel(Math.max(0, totals.session + inFlight - behindBy)),
      liters,
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
    // VS Code: jede Pixelzeile eine Box, darin je Lauf gleicher Farbe eine Box (leer, wo nichts
    // ist). nowrap, sonst bräche VS Code eine Zeile um; so bleiben es rund 130 Knoten.
    const pixelPart = (scale: number) => {
      const size = pixelSize(scale)
      const across = (n: number) => Math.round(n * size.width * 1000) / 1000

      return (
        <Box key="hahn" flexDirection="column" width={across(PIXEL_GRID.cols)} flexShrink={0}>
          {scenePixels(scene, tapColors).map(row => {
            const runs: { color: string | null; n: number }[] = []
            for (const color of row.slice(0, row.findLastIndex(c => c !== null) + 1)) {
              const last = runs[runs.length - 1]
              if (last !== undefined && last.color === color) last.n += 1
              else runs.push({ color, n: 1 })
            }

            return (
              <Box flexDirection="row" flexWrap="nowrap" height={size.height}>
                {runs.map(run =>
                  run.color === null ? (
                    <Box width={across(run.n)} height={size.height} flexShrink={0} />
                  ) : (
                    <Box width={across(run.n)} height={size.height} flexShrink={0} backgroundColor={run.color} />
                  ),
                )}
              </Box>
            )
          })}
        </Box>
      )
    }
    // In den Apps 2-fach oder, wenn es eng wird, 1,5-fach (siehe appPlan); in VS Code aus
    // Box-Pixeln, groß oder klein.
    const tapPart = (scale = APP_LARGE) =>
      !isTerminal && Svg !== undefined ? (
        <Svg
          key="hahn"
          alt={sceneAlt(scene)}
          width={appScene(scale).width}
          height={appScene(scale).height}
          source={sceneSvg(scene, tapColors)}
        />
      ) : isTextApp ? (
        pixelPart(scale)
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
    // In den Apps stehen die Liter neben dem Becken, im Terminal zeichnet sie die Szene.
    const literPart =
      !isTerminal ? (
        <Text key="liter" size="footnote" color="suggestion" tabular>
          {nb(liters === '' ? '' : ` ${liters}`)}
        </Text>
      ) : null
    // Im Terminal ist der ganze Zähler der Knopf.
    const livePart = (hasTap: boolean) => [
      <Box flexGrow={1} />,
      <Text>{nb(hasTap ? ' ' : '   ')}</Text>,
      hasTap ? tapPart() : null,
      hasTap ? literPart : null,
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

    // Die Apps, desktop und vscode gleich und nur nach der Breite, in einer Zeile:
    // erst kürzen sich die Details, dann wird Clawd kleiner (2-fach, 1,5-fach, im schmalen Panel 1-fach),
    // dann geht der Preis, erst dann die Liter. Die Liter bleiben also, solange es geht: das
    // Seitenpanel von VS Code ist selten breiter als 100 Zeichen. Passt nicht alles in die Zeile,
    // rückt der Zähler mit ihm unter die Limits; erst wenn selbst das nicht passt, tritt er
    // beiseite. Jede Stufe passt auch bei jeder größeren Breite, und es gilt die erste, die
    // passt: so zeigt ein breiteres Fenster Clawd nie kleiner als ein schmaleres.
    // Das Terminal rechnet weiter wie unten.
    type AppPlan = {
      detail: string | undefined
      hasTap: boolean
      // 0 ohne Clawd, sonst seine Größe zum viewBox
      scale: number
      withMoney: boolean
      withLiters: boolean
      isStacked: boolean
    }
    const APP_STEPS = [
      { scale: APP_LARGE, withMoney: true, withLiters: true },
      { scale: APP_SMALL, withMoney: true, withLiters: true },
      { scale: APP_SMALL, withMoney: false, withLiters: true },
      { scale: APP_SMALL, withMoney: true, withLiters: false },
      { scale: APP_SMALL, withMoney: false, withLiters: false },
      { scale: APP_TINY, withMoney: true, withLiters: true },
      { scale: APP_TINY, withMoney: false, withLiters: true },
      { scale: APP_TINY, withMoney: true, withLiters: false },
      { scale: APP_TINY, withMoney: false, withLiters: false },
      { scale: 0, withMoney: true, withLiters: false },
      { scale: 0, withMoney: false, withLiters: false },
    ] as const
    type AppStep = (typeof APP_STEPS)[number]
    const appRoom = e.props.bodyColumns - 1 - APP_SLACK
    const appLive = (step: AppStep) =>
      appText((step.scale > 0 ? 3 : 2) + liveRoomOf(step.withMoney) + (step.withLiters ? LITER_WIDTH : 0)) +
      (step.scale === 0
        ? 0
        : isTextApp
          ? appCells(PIXEL_GRID.cols * pixelSize(step.scale).width * APP_CH_PX)
          : appCells(appScene(step.scale).width))
    const appPlan = (left: (detail: string | undefined) => number, details: string[]): AppPlan => {
      const options = [...details, undefined]
      const inRow = (step: AppStep): AppPlan | null => {
        const at = options.findIndex(d => left(d) + appLive(step) <= appRoom)

        return at < 0 ? null : { detail: options[at], ...step, hasTap: step.scale > 0, isStacked: false }
      }
      // Gestapelt steht Clawd klein, damit die Leiste flach bleibt; im ganz schmalen Panel
      // winzig, statt zu gehen (VS Code ist oft so schmal).
      const stacked = (step: AppStep): AppPlan | null =>
        appLive(step) <= appRoom
          ? { detail: options.find(d => left(d) <= appRoom), ...step, hasTap: step.scale > 0, isStacked: true }
          : null
      // Eine Zeile nur mit Litern und Preis: lieber gestapelt mit allem als einzeilig mit Lücke.
      const withTap = APP_STEPS.filter(step => step.scale > 0)
      const without = APP_STEPS.filter(step => step.scale === 0)
      const isWhole = (step: AppStep) => step.withLiters && step.withMoney
      // Winzig steht er nur gestapelt: in einer Zeile wäre er neben dem Text zu klein.
      const plans = [
        ...withTap.filter(step => isWhole(step) && step.scale > APP_TINY).map(inRow),
        ...withTap.filter(step => step.scale < APP_LARGE).map(stacked),
        ...withTap.filter(step => !isWhole(step) && step.scale > APP_TINY).map(inRow),
        ...without.map(inRow),
        ...without.map(stacked),
      ]

      return (
        plans.find(plan => plan !== null) ?? {
          detail: options.find(d => left(d) <= appRoom),
          hasTap: false,
          scale: 0,
          withMoney: false,
          withLiters: false,
          isStacked: true,
        }
      )
    }
    // Rechts der Zähler als Text; nur der Zeitraum ist der Knopf, denn die Apps zeichnen
    // jeden Button als ihren eigenen Knopf. Farben stehen außerhalb davon (siehe unten).
    // Der Text kürzt sein Ende, statt umzubrechen (die festen Leerzeichen ließen ihn sonst
    // über den Rand laufen); schrumpfen darf er nicht, das tun erst die Details links.
    const appCounter = (withMoney: boolean) => [
      <Text size="footnote" tabular wrap="truncate-end">
        {liveMoney !== '' && withMoney && <Text color="claude">{liveMoney}</Text>}
        {liveMoney !== '' && withMoney && <Text dimColor>{nb(' · ')}</Text>}
        {liveArrow !== '' && <Text dimColor>{nb(liveArrow)}</Text>}
        <Text color="claude">{liveValue}</Text>
        <Text dimColor>{nb(' tokens · ')}</Text>
      </Text>,
      <Button
        key="live"
        plain
        dimColor
        label={nb(`${span.label} ›`)}
        onPress={async () => {
          await update($, liveSpan, i => (i + 1) % SPANS.length)
          await publish($, true)
        }}
      >
        <Text size="footnote">{nb(`${span.label} ›`)}</Text>
      </Button>,
    ]
    // Eine ruhige Zeile: links die Limits, rechts Clawd (höher als der Text), Liter, Zähler;
    // alles mittig, so steht der Text auf halber Höhe neben ihm. Rechts schrumpft nichts:
    // Clawd würde gestaucht, der Zähler zerrissen. Liegt die Schätzung daneben, gibt die
    // Lücke nach, dann kürzen sich links die Details; was dann noch übersteht,
    // schneidet die Zeile am Rand ab, statt darüber hinaus zu zeichnen.
    // VS Code bricht Zeilen-Boxen sonst um (flex-wrap: wrap); die Leiste bleibt eine Zeile.
    const oneLine = isTextApp ? { flexWrap: 'nowrap' as const } : {}
    const appRight = (plan: AppPlan) => [
      <Box flexGrow={1} />,
      plan.hasTap && (
        <Box flexDirection="row" alignItems="center" flexShrink={0} {...oneLine}>
          {tapPart(plan.scale)}
          {plan.withLiters && literPart}
        </Box>
      ),
      <Text>{nb(plan.hasTap ? '  ' : '   ')}</Text>,
      // Text und Knopf gemeinsam mittig: VS Code setzt Knöpfe sonst oben an (flex-start).
      <Box flexDirection="row" alignItems="center" flexShrink={0} {...oneLine}>
        {appCounter(plan.withMoney)}
      </Box>,
    ]
    const appBand = (plan: AppPlan, left: ReturnType<typeof h>) =>
      plan.isStacked ? (
        <Box flexDirection="column" overflow="hidden">
          {left}
          <Box flexDirection="row" alignItems="center" overflow="hidden" {...oneLine}>
            {appRight(plan)}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="row" alignItems="center" overflow="hidden" {...oneLine}>
          {left}
          {appRight(plan)}
        </Box>
      )

    const current = await read($, reading)
    if (current === null && !isTerminal) {
      // Kürzer, ehe Clawd oder eine Zahl gehen muss.
      const waiting = ["Usage limits appear after Claude's next reply", 'Limits after the next reply']
      const plan = appPlan(text => appText(MARK.length + (text?.length ?? 0)), waiting)

      return appBand(
        plan,
        // minWidth 0: sonst hielte der Text links seine volle Breite, statt sein Ende zu kürzen.
        <Box flexDirection="row" alignItems="center" flexShrink={1} minWidth={0} {...oneLine}>
          <Text size="footnote" wrap="truncate-end">
            <Text color="claude">{nb(MARK)}</Text>
            <Text dimColor>{nb(plan.detail ?? '')}</Text>
          </Text>
        </Box>,
      )
    }
    if (current === null) {
      return withUnder(
        canTap,
        <Box flexDirection="row" alignItems="center">
          <Text mono size={isTerminal ? undefined : 'footnote'} wrap="truncate-end">
            <Text color="claude">{nb(MARK)}</Text>
            <Text dimColor>{nb("Usage limits appear after Claude's next reply")}</Text>
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
    const termDetail = shown.details.find(text => fixed + text.length <= room)
    const hasTermTap = canTap && shown.details.find(text => fixed + text.length <= room - tapRoom) === termDetail
    // In den Apps steht der Balken als Svg in px da, der Trenner nur mit einem Detail.
    const plan = isTerminal
      ? null
      : appPlan(
          text =>
            appText(fixed - barCells - (text === undefined ? separator.length : 0) + (text?.length ?? 0)) +
            (shown.percent === null ? 0 : Svg !== undefined ? appCells(APP_BAR.width) : appCells(BAR_WIDTH * APP_CH_PX)),
          shown.details,
        )
    const detail = plan === null ? termDetail : plan.detail
    const hasTap = plan === null ? hasTermTap : plan.hasTap
    const filled =
      shown.percent === null
        ? 0
        : Math.round((Math.min(100, Math.max(0, shown.percent)) / 100) * BAR_WIDTH)
    const color = shown.percent === null || shown.isStale ? undefined : barColor(shown.percent)
    const tail = nb(detail === undefined ? '' : `${separator}${detail}`)
    const colors = !isTerminal && (await read($, isLight)) ? PALETTE.light : PALETTE.dark

    // Farben stehen außerhalb der Buttons: die Desktop-App übermalt deren Inhalt.
    const controls = [
      position !== '' && (
        <Button
          key="burn"
          plain
          dimColor
          autoFocus
          label={nb(position)}
          onPress={() => void update($, view, i => (i + 1) % list.length)}
        >
          <Text size="footnote">{nb(position)}</Text>
        </Button>
      ),
      <Text>{nb('  ')}</Text>,
      <Button
        key="statistik"
        plain
        dimColor
        label={STATS_BUTTON}
        onPress={() => void $.ui.open({ id: PANE, title: PANE_TITLE, closeOnEscape: true })}
      >
        <Text size="footnote">{STATS_BUTTON}</Text>
      </Button>,
    ]
    const limits = isTerminal ? (
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
      // Schrumpft als Erstes, wenn die Schätzung zu knapp war; minWidth 0, sonst hielte jeder
      // Text seine volle Breite, und das Kürzen unten griffe nie.
      <Box flexDirection="row" alignItems="center" flexShrink={1} minWidth={0} {...oneLine}>
        <Text size="footnote" wrap="truncate-end">
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
            // In VS Code flach wie der Svg-Strich: 0,3 Zeilen hoch statt einer ganzen.
            <Box flexDirection="row" width={BAR_WIDTH} height={isTextApp ? 0.3 : 1} flexShrink={0} {...oneLine}>
              {filled > 0 && <Box width={filled} height={isTextApp ? 0.3 : 1} backgroundColor={color ?? 'inactive'} />}
              {filled < BAR_WIDTH && (
                <Box width={BAR_WIDTH - filled} height={isTextApp ? 0.3 : 1} backgroundColor="subtle" />
              )}
            </Box>
          ))}
        {/* Liegt die Schätzung daneben, kürzt das Detail sein Ende, statt umzubrechen. */}
        <Text size="footnote" tabular wrap="truncate-end">
          <Text>{nb(amount)}</Text>
          <Text dimColor>{tail}</Text>
          <Text>{nb(gap)}</Text>
        </Text>
      </Box>
    )

    // Die Knöpfe kürzen sich nie: ein halber Knopf wäre keiner. Es kürzen sich die Limits davor.
    if (plan !== null) {
      return appBand(
        plan,
        <Box flexDirection="row" alignItems="center" flexShrink={1} minWidth={0} {...oneLine}>
          {limits}
          <Box flexDirection="row" alignItems="center" flexShrink={0} {...oneLine}>
            {controls}
          </Box>
        </Box>,
      )
    }

    return withUnder(
      hasTap,
      <Box flexDirection="row" alignItems="center">
        {limits}
        {controls}
        {livePart(hasTap)}
      </Box>,
    )
  })
}
