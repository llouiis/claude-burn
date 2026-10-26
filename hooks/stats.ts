// Liest Claude Codes eigenen /stats-Zwischenspeicher (~/.claude/stats-cache.json)
// und rechnet daraus, was das Statistik-Fenster zeigt. Keine Aufrufe an `$`.
// Claude Code schreibt ihn nur neu, wenn /stats im Terminal läuft; in den Apps bleibt er
// stehen. Deshalb führt Burn ab 0.19.0 ein eigenes Tagebuch je Unterhaltung (DayBook) und
// zählt damit alle Tage nach dem letzten Rechentag des Zwischenspeichers.

type DailyActivity = {
  date: string
  messageCount: number
  sessionCount: number
  toolCallCount: number
}

type ModelTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

export type StatsCache = {
  lastComputedDate?: string
  dailyActivity?: DailyActivity[]
  dailyModelTokens?: { date: string; tokensByModel: Record<string, number> }[]
  modelUsage?: Record<string, ModelTotals>
  longestSession?: { duration: number }
  firstSessionDate?: string
  hourCounts?: Record<string, number>
}

// Ein Tag einer Unterhaltung: Messages wie im Transkript (Prompts, je Antwort ihre Blöcke,
// je Tool-Call sein Ergebnis; Anhänge und Systemzeilen, die /stats auch zählt, sieht Burn
// nicht), Tool-Calls, die Stunde, in der sie an dem Tag begann, und die Tokens je Modell.
export type DayEntry = { messages: number; toolCalls: number; hour: number; models: Record<string, ModelTotals> }
export type DayBook = Record<string, DayEntry>
// Tokens aus dem Stundenbuch, die kein Tagebuch einem Modell zuordnet (vor 0.19.0 gezählt).
export const UNTRACKED = 'untracked'
const NO_TOKENS: ModelTotals = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }
export const totalOf = (m: ModelTotals) => m.inputTokens + m.outputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens

export function addToBook(book: DayBook, date: string, hour: number, add: Partial<Omit<DayEntry, 'hour' | 'models'>> & { model?: string; tokens?: ModelTotals }): DayBook {
  const was = book[date] ?? { messages: 0, toolCalls: 0, hour, models: {} }
  const models = { ...was.models }
  if (add.model !== undefined && add.tokens !== undefined) {
    const m = models[add.model] ?? NO_TOKENS
    models[add.model] = {
      inputTokens: m.inputTokens + add.tokens.inputTokens,
      outputTokens: m.outputTokens + add.tokens.outputTokens,
      cacheReadInputTokens: m.cacheReadInputTokens + add.tokens.cacheReadInputTokens,
      cacheCreationInputTokens: m.cacheCreationInputTokens + add.tokens.cacheCreationInputTokens,
    }
  }

  return {
    ...book,
    [date]: { messages: was.messages + (add.messages ?? 0), toolCalls: was.toolCalls + (add.toolCalls ?? 0), hour: was.hour, models },
  }
}

// Der Zwischenspeicher bis zu seinem letzten Rechentag, danach die Tagebücher. Die Tokens je Tag
// danach kommen aus dem Stundenbuch (`hourTokens`, Tag in deutscher Zeit wie `dayNumber`), damit
// sie zur Leiste passen; was davon keinem Modell zugeordnet ist, steht unter UNTRACKED.
export function withBooks(cache: StatsCache | null, books: DayBook[], hourTokens: Map<number, number>, today: string): StatsCache | null {
  const lastDay = cache?.lastComputedDate === undefined ? Number.NEGATIVE_INFINITY : dayNumber(cache.lastComputedDate)
  const days = new Map<number, { activity: DailyActivity; models: Map<string, number> }>()
  const usage: Record<string, ModelTotals> = { ...(cache?.modelUsage ?? {}) }
  const hours: Record<string, number> = { ...(cache?.hourCounts ?? {}) }
  const dayOf = (day: number) => {
    let entry = days.get(day)
    if (entry === undefined) {
      entry = { activity: { date: dateOf(day), messageCount: 0, sessionCount: 0, toolCallCount: 0 }, models: new Map() }
      days.set(day, entry)
    }
    return entry
  }
  for (const book of books) {
    for (const [date, entry] of Object.entries(book)) {
      const day = dayNumber(date)
      if (day <= lastDay) continue
      const { activity, models } = dayOf(day)
      activity.messageCount += entry.messages
      activity.toolCallCount += entry.toolCalls
      activity.sessionCount += 1
      hours[String(entry.hour)] = (hours[String(entry.hour)] ?? 0) + 1
      for (const [model, m] of Object.entries(entry.models)) {
        models.set(model, (models.get(model) ?? 0) + totalOf(m))
        const was = usage[model] ?? NO_TOKENS
        usage[model] = {
          inputTokens: was.inputTokens + m.inputTokens,
          outputTokens: was.outputTokens + m.outputTokens,
          cacheReadInputTokens: was.cacheReadInputTokens + m.cacheReadInputTokens,
          cacheCreationInputTokens: was.cacheCreationInputTokens + m.cacheCreationInputTokens,
        }
      }
    }
  }
  for (const [day, amount] of hourTokens) {
    if (day <= lastDay || amount <= 0) continue
    const { models } = dayOf(day)
    const known = [...models.values()].reduce((a, b) => a + b, 0)
    if (amount > known) models.set(UNTRACKED, amount - known)
  }
  if (cache === null && days.size === 0) return null

  const added = [...days.entries()].sort((a, b) => a[0] - b[0])
  const firstAdded = added[0] === undefined ? undefined : dateOf(added[0][0])
  const first = [cache?.firstSessionDate, firstAdded].filter((d): d is string => d !== undefined).sort((a, b) => a.localeCompare(b))[0]

  return {
    ...cache,
    lastComputedDate: added.length > 0 ? today : cache?.lastComputedDate,
    firstSessionDate: first,
    dailyActivity: [...(cache?.dailyActivity ?? []), ...added.filter(([, e]) => e.activity.sessionCount > 0).map(([, e]) => e.activity)],
    dailyModelTokens: [
      ...(cache?.dailyModelTokens ?? []),
      ...added.map(([day, e]) => ({ date: dateOf(day), tokensByModel: Object.fromEntries(e.models) })),
    ],
    modelUsage: usage,
    hourCounts: hours,
  }
}

export const RANGES = [
  { label: 'All time', days: null },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
] as const

export type Summary = {
  tokens: number
  favoriteModel: string | null
  sessions: number
  messages: number
  toolCalls: number
  activeDays: number
  spanDays: number
  longestStreak: number
  currentStreak: number
  mostActiveDay: string | null
  mostActiveHour: number | null
  longestSessionMs: number | null
  split: { input: number; output: number; cacheRead: number; cacheWrite: number } | null
}

const DAY = 86_400_000

// Tage als fortlaufende Zahl, damit Spannen und Serien ohne Zeitzonen rechnen.
export const dayNumber = (date: string) => Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY)
export const dateOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10)

// claude-opus-5-5 → Opus 5.5. Ein Datum am Ende (-20251001) und ein Zusatz wie [1m]
// fallen weg, ältere IDs mit der Version vorn (claude-3-5-sonnet) lesen sich genauso.
export function modelName(id: string): string {
  if (id === UNTRACKED) return 'Untracked'
  const parts = id
    .replace(/^claude-/, '')
    .replace(/\[.*\]$/, '')
    .split('-')
    .filter(part => !/^\d{8}$/.test(part))
  const family = parts.find(part => /^[a-z]/i.test(part)) ?? parts[0] ?? id
  const version = parts.filter(part => part !== family)

  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.join('.')}`.trim()
}

export function tokensByDay(cache: StatsCache): Map<number, number> {
  const days = new Map<number, number>()
  for (const entry of cache.dailyModelTokens ?? []) {
    const sum = Object.values(entry.tokensByModel).reduce((a, b) => a + b, 0)
    days.set(dayNumber(entry.date), (days.get(dayNumber(entry.date)) ?? 0) + sum)
  }

  return days
}

// `today` ist das heutige Datum in deutscher Zeit; die laufende Sitzung zählt als aktiv.
export function summarize(cache: StatsCache, today: string, days: number | null): Summary {
  const last = dayNumber(today)
  const first =
    days === null
      ? Math.min(last, dayNumber(cache.firstSessionDate ?? today))
      : last - days + 1
  const inRange = (date: string) => dayNumber(date) >= first && dayNumber(date) <= last

  const activity = (cache.dailyActivity ?? []).filter(entry => inRange(entry.date))
  const models = new Map<string, number>()
  let tokens = 0
  for (const entry of cache.dailyModelTokens ?? []) {
    if (!inRange(entry.date)) continue
    for (const [model, count] of Object.entries(entry.tokensByModel)) {
      models.set(model, (models.get(model) ?? 0) + count)
      tokens += count
    }
  }
  const favorite = [...models.entries()].filter(([model]) => model !== UNTRACKED).sort((a, b) => b[1] - a[1])[0]

  const active = new Set(activity.map(entry => dayNumber(entry.date)))
  active.add(last)
  let longestStreak = 0
  let run = 0
  for (let day = first; day <= last; day += 1) {
    run = active.has(day) ? run + 1 : 0
    longestStreak = Math.max(longestStreak, run)
  }
  let currentStreak = 0
  while (active.has(last - currentStreak)) currentStreak += 1

  const busiest = [...activity].sort((a, b) => b.messageCount - a.messageCount)[0]
  const hours = Object.entries(cache.hourCounts ?? {}).sort((a, b) => b[1] - a[1])[0]
  const usage = Object.values(cache.modelUsage ?? {})
  const sum = (pick: (m: ModelTotals) => number) => usage.reduce((total, m) => total + pick(m), 0)

  return {
    tokens,
    favoriteModel: favorite === undefined ? null : modelName(favorite[0]),
    sessions: activity.reduce((total, entry) => total + entry.sessionCount, 0),
    messages: activity.reduce((total, entry) => total + entry.messageCount, 0),
    toolCalls: activity.reduce((total, entry) => total + entry.toolCallCount, 0),
    activeDays: active.size,
    spanDays: last - first + 1,
    longestStreak,
    currentStreak,
    mostActiveDay: busiest?.date ?? null,
    mostActiveHour: days === null && hours !== undefined ? Number(hours[0]) : null,
    longestSessionMs: cache.longestSession?.duration ?? null,
    split:
      days === null && usage.length > 0
        ? {
            input: sum(m => m.inputTokens),
            output: sum(m => m.outputTokens),
            cacheRead: sum(m => m.cacheReadInputTokens),
            cacheWrite: sum(m => m.cacheCreationInputTokens),
          }
        : null,
  }
}

export type Heatmap = {
  // levels[week][weekday]: -1 nach heute, 0 ohne Aktivität, 1 bis 4 nach Menge.
  levels: number[][]
  // Woche, in der ein Monat beginnt, und sein Kürzel.
  months: { week: number; label: string }[]
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function heatmap(cache: StatsCache, today: string, weeks: number): Heatmap {
  const last = dayNumber(today)
  // Wie /stats beginnt die Woche am Sonntag; Tag 0 (1.1.1970) war ein Donnerstag.
  const weekday = (day: number) => (((day + 4) % 7) + 7) % 7
  const start = last - weekday(last) - (weeks - 1) * 7
  const perDay = tokensByDay(cache)
  const amounts = [...perDay.values()].filter(n => n > 0).sort((a, b) => a - b)
  const quartile = (q: number) => amounts[Math.min(amounts.length - 1, Math.floor(q * amounts.length))] ?? 0
  const steps = [quartile(0.25), quartile(0.5), quartile(0.75)]

  const levels: number[][] = []
  const months: { week: number; label: string }[] = []
  for (let week = 0; week < weeks; week += 1) {
    const column: number[] = []
    for (let row = 0; row < 7; row += 1) {
      const day = start + week * 7 + row
      const amount = perDay.get(day) ?? 0
      column.push(day > last ? -1 : amount === 0 ? 0 : 1 + steps.filter(step => amount > step).length)
      const date = dateOf(day)
      if (date.endsWith('-01')) months.push({ week, label: MONTHS[Number(date.slice(5, 7)) - 1] ?? '' })
    }
    levels.push(column)
  }

  return { levels, months }
}
