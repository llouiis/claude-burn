// Das Stufen-Liniendiagramm „Tokens per Day“ aus /usage › Stats › Models,
// einmal als Zeichenraster fürs Terminal, einmal als SVG für die Apps.

import { MONTHS } from './stats'

export type Series = { name: string; color: string; svgColor: string; values: number[] }
export type Run = { text: string; color?: string; isDim?: boolean }

type Cell = { char: string; color?: string }

const STEPS = 9

// 0, 45.8M, 366.1M: die Achsenbeschriftung wie im Original.
export function axisLabel(n: number): string {
  if (n === 0) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`

  return String(Math.round(n))
}

// 2026-10-09 → Oct 9
export const dayLabel = (day: string) =>
  `${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''} ${Number(day.slice(8, 10))}`

const level = (value: number, max: number) =>
  max === 0 ? 0 : Math.round((value / max) * (STEPS - 1))

export function chartRows(series: Series[], days: string[], columns: number): Run[][] {
  const max = Math.max(0, ...series.flatMap(s => s.values))
  const labels = Array.from({ length: STEPS }, (_, i) => axisLabel((max * i) / (STEPS - 1)))
  const axis = Math.max(...labels.map(label => label.length))
  const perDay = Math.max(1, Math.min(4, Math.floor((columns - axis - 2) / Math.max(1, days.length))))
  const width = perDay * days.length
  const grid: Cell[][] = Array.from({ length: STEPS }, () =>
    Array.from({ length: width }, () => ({ char: ' ' })),
  )
  const put = (row: number, x: number, char: string, color: string) => {
    const line = grid[STEPS - 1 - row]
    if (line !== undefined && x >= 0 && x < width) line[x] = { char, color }
  }

  // In der Reihenfolge der Legende, wie /stats: das letzte Modell liegt obenauf.
  for (const one of series) {
    one.values.forEach((value, day) => {
      const here = level(value, max)
      const start = day * perDay
      for (let x = start; x < start + perDay; x += 1) put(here, x, '─', one.color)
      const before = day === 0 ? here : level(one.values[day - 1] ?? 0, max)
      if (day > 0 && before !== here) {
        const up = here > before
        put(before, start, up ? '╯' : '╮', one.color)
        for (let row = Math.min(before, here) + 1; row < Math.max(before, here); row += 1) {
          put(row, start, '│', one.color)
        }
        put(here, start, up ? '╭' : '╰', one.color)
      }
    })
  }

  const rows: Run[][] = grid.map((line, index) => {
    const row = STEPS - 1 - index
    const runs: Run[] = [{ text: `${(labels[row] ?? '').padStart(axis)} ${row === 0 ? '┼' : '┤'}` }]
    for (const cell of line) {
      const last = runs[runs.length - 1]
      if (runs.length > 1 && last !== undefined && last.color === cell.color) last.text += cell.char
      else runs.push({ text: cell.char, color: cell.color })
    }

    return runs
  })

  // Datumszeile: so viele Beschriftungen, wie ohne Überlappen hineinpassen.
  const dates = Array.from({ length: width }, () => ' ')
  let free = 0
  days.forEach((day, i) => {
    const label = dayLabel(day)
    const x = i * perDay
    if (x >= free && x + label.length <= width) {
      dates.splice(x, label.length, ...label)
      free = x + label.length + 2
    }
  })
  rows.push([{ text: `${' '.repeat(axis + 2)}${dates.join('')}`, isDim: true }])

  return rows
}

export function chartSvg(series: Series[], days: string[], text: string) {
  const max = Math.max(0, ...series.flatMap(s => s.values))
  const left = 52
  const top = 8
  const height = 150
  const perDay = Math.max(10, Math.min(32, Math.floor(400 / Math.max(1, days.length))))
  const width = perDay * days.length
  const y = (value: number) => top + height - (max === 0 ? 0 : (value / max) * height)

  const ticks = Array.from({ length: STEPS }, (_, i) => (max * i) / (STEPS - 1)).map(
    value =>
      `<text x="${left - 8}" y="${y(value) + 3}" text-anchor="end">${axisLabel(value)}</text>` +
      `<line x1="${left - 4}" x2="${left}" y1="${y(value)}" y2="${y(value)}" stroke="${text}"/>`,
  )
  const lines = series.map(one => {
    const points = one.values.flatMap((value, day) => [
      `${left + day * perDay},${y(value)}`,
      `${left + (day + 1) * perDay},${y(value)}`,
    ])

    return `<polyline points="${points.join(' ')}" fill="none" stroke="${one.svgColor}" stroke-width="1.2"/>`
  })
  const step = Math.max(1, Math.ceil(days.length / 5))
  const labels = days.flatMap((day, i) =>
    i % step === 0 ? [`<text x="${left + i * perDay}" y="${top + height + 16}">${dayLabel(day)}</text>`] : [],
  )
  const total = { width: left + width + 8, height: top + height + 22 }

  return {
    ...total,
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total.width} ${total.height}" font-family="ui-monospace, Menlo, monospace" font-size="10" fill="${text}"><line x1="${left}" x2="${left}" y1="${top}" y2="${top + height}" stroke="${text}"/>${ticks.join('')}${lines.join('')}${labels.join('')}</svg>`,
  }
}
