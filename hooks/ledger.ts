// Ein Kassenbuch der Tokens über alle Sitzungen: jede Sitzung schreibt unter
// ihrem eigenen Schlüssel stündliche Summen, so überschreiben sich parallele
// Sitzungen nicht. Vor dem ersten Eintrag helfen die Tageswerte von /stats aus.

import { dayNumber } from './stats'
import type { StatsCache } from './stats'

export type Buckets = Record<string, number>
// Was älter als 31 Tage ist, wandert als Summe nach `archived`: Gesamt bleibt vollständig.
export type Ledger = { buckets: Buckets; archived: number }
export type Live = { session: number; day: number; week: number; month: number; all: number }

export const PREFIX = 'ledger:'
export const START_KEY = 'ledgerStart'
const HOUR = 3_600_000
const KEEP = 31 * 24 * HOUR

export const SPANS = [
  { key: 'session', label: 'session' },
  { key: 'day', label: '24h' },
  { key: 'week', label: '7d' },
  { key: 'month', label: '30d' },
  { key: 'all', label: 'all time' },
] as const

// Die Stunde als Schlüssel: Millisekunden seit 1970, auf die volle Stunde gekürzt.
export const hourKey = (ms: number) => String(Math.floor(ms / HOUR) * HOUR)

export function addTo(ledger: Ledger, ms: number, amount: number, nowMs: number): Ledger {
  const buckets: Buckets = {}
  let archived = ledger.archived
  for (const [hour, value] of Object.entries(ledger.buckets)) {
    if (Number(hour) >= nowMs - KEEP) buckets[hour] = value
    else archived += value
  }
  const key = hourKey(ms)
  buckets[key] = (buckets[key] ?? 0) + amount

  return { buckets, archived }
}

// `today` ist der heutige Tag in deutscher Zeit, `berlinDay` rechnet einen
// Zeitpunkt auf seinen deutschen Kalendertag um.
export function liveTotals(
  ledgers: Ledger[],
  ledgerStart: number,
  cache: StatsCache | null,
  session: number,
  nowMs: number,
  berlinDay: (ms: number) => number,
): Live {
  const hours = ledgers.flatMap(ledger =>
    Object.entries(ledger.buckets).map(([hour, value]) => [Number(hour), value] as const),
  )
  const today = berlinDay(nowMs)
  const startDay = berlinDay(ledgerStart)
  const fromLedger = (since: number) =>
    hours.reduce((sum, [hour, value]) => (hour + HOUR > since ? sum + value : sum), 0)
  const fromCache = (firstDay: number) =>
    (cache?.dailyModelTokens ?? []).reduce((sum, entry) => {
      const day = dayNumber(entry.date)
      if (day < firstDay || day >= startDay) return sum

      return sum + Object.values(entry.tokensByModel).reduce((a, b) => a + b, 0)
    }, 0)
  const lastDays = (n: number) =>
    fromCache(today - n + 1) + hours.reduce((sum, [hour, value]) => (berlinDay(hour) > today - n ? sum + value : sum), 0)

  return {
    session,
    day: fromLedger(nowMs - 24 * HOUR),
    week: lastDays(7),
    month: lastDays(30),
    all:
      fromCache(Number.NEGATIVE_INFINITY) +
      fromLedger(0) +
      ledgers.reduce((sum, ledger) => sum + ledger.archived, 0),
  }
}

// Wann ein Kostenwert vollständig ist: Session und 24h sofort (so gewünscht),
// 7d und 30d erst, wenn das Kassenbuch den ganzen Zeitraum abdeckt. Vor dem
// Start kennt niemand die Kosten, deshalb wird „all time“ nie vollständig.
// Liefert true, den Tag (fortlaufende Zahl), ab dem der Wert zählt, oder null.
export function costFrom(
  span: Live extends Record<infer K, number> ? K : never,
  trackedSince: number | undefined,
  nowMs: number,
  berlinDay: (ms: number) => number,
): true | number | null {
  if (span === 'session' || span === 'day') return true
  if (span === 'all') return null
  const length = span === 'week' ? 7 : 30
  // Der Starttag selbst ist angebrochen: voll zählt erst der Tag danach.
  const readyDay = berlinDay(trackedSince ?? nowMs) + length

  return berlinDay(nowMs) >= readyDay ? true : readyDay
}

// Die ausgegebenen Tokens seit Beginn für die Liter am Hahn: /stats kennt sie je Modell bis zu
// seinem letzten Rechentag, danach zählt das eigene Buch. Für 24h, 7d und 30d reicht das Buch
// allein, es füllt sich ab seinem ersten Eintrag.
export function allOutput(cache: StatsCache | null, ledgers: Ledger[], berlinDay: (ms: number) => number): number {
  const fromCache = Object.values(cache?.modelUsage ?? {}).reduce((sum, m) => sum + m.outputTokens, 0)
  const lastDay = cache?.lastComputedDate === undefined ? Number.NEGATIVE_INFINITY : dayNumber(cache.lastComputedDate)
  const after = ledgers.reduce(
    (sum, ledger) =>
      sum +
      Object.entries(ledger.buckets).reduce((s, [hour, value]) => (berlinDay(Number(hour)) > lastDay ? s + value : s), 0) +
      (fromCache === 0 ? ledger.archived : 0),
    0,
  )

  return fromCache + after
}
