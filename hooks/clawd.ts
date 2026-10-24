// Clawd neben dem Preis. Pro Sitzung wird eine Rolle ausgelost; in jeder steht das Tempo
// für die Tokens pro Sekunde (nur solange gestreamt wird) und die Größe für die Tokens der
// Sitzung. Zu Beginn und nach einer langen Pause kommt er erst an. Das Thema: KI trinkt Wasser,
// jede Antwort kostet ein paar Schlucke. Clawd weiß das und macht trotzdem weiter.
//   Hahn:     Klempner-Clawd am tropfenden Hahn, der Eimer füllt sich, läuft über, die Pfütze wächst.
//   Cloud:    Clawd unterm Schirm, in der Wolke blinken Server, bei viel Tempo blitzt es.
//   Kühlturm: Feuerwehr-Clawd kühlt einen Serverschrank, der beim Streamen heiß wird; der Tank leert sich.
//   Durst:    Clawd gluckert aus der Flasche, die leeren stapeln sich neben ihm.
//   See:      Clawd schlürft mit dem Strohhalm einen See leer, am Ende zappelt ein Fisch im Trockenen.

export type Color = 'claude' | 'error' | 'warning' | 'suggestion' | 'inactive' | 'success'
export type Piece = { text: string; color?: Color; dim?: boolean }

export const ROLES = ['tap', 'cloud', 'cooling', 'thirst', 'lake'] as const
export type Role = (typeof ROLES)[number]
// Für /clawd: englisch wie die Leiste, die deutschen Wörter gehen auch.
export const ROLE_WORDS: Record<Role, string[]> = {
  tap: ['tap', 'hahn', 'wasserhahn', 'eimer', 'bucket', 'klempner', 'plumber'],
  cloud: ['cloud', 'wolke', 'regen', 'rain', 'schirm', 'umbrella'],
  cooling: ['cooling', 'kühlturm', 'kuehlturm', 'kühlung', 'kuehlung', 'server', 'feuerwehr'],
  thirst: ['thirst', 'durst', 'flasche', 'bottle', 'trinken', 'drink'],
  lake: ['lake', 'see', 'strohhalm', 'straw', 'schlürfen', 'schluerfen'],
}
// Diese Rollen kommen zu Fuß, die anderen fahren vor.
const isWalking = (role: Role) => role === 'tap' || role === 'cloud'

// Ein Bild am Strahlrohr: das Wasser rechts davon, die Spalte, in der es auf den Boden trifft,
// ob es gerade aufschlägt, für die Apps die Höhe des Tropfens (0 bis 2) oder die Breite des Strahls.
export type Flow = { cell: string; land: number | null; isSplash: boolean; drop: number | null; jet: number }
const fall = (drop: number): Flow => ({ cell: ['˙', '·', '.'][drop] ?? ' ', land: null, isSplash: false, drop, jet: 0 })
const SPLASHED: Flow = { cell: ' ', land: 0, isSplash: true, drop: null, jet: 0 }
export const RESTING: Flow = { cell: ' ', land: null, isSplash: false, drop: null, jet: 0 }
const jet = (cell: string, width: number, isSplash: boolean): Flow => ({
  cell,
  land: cell.length - 1,
  isSplash,
  drop: null,
  jet: width,
})
// Je Stärke eine Bildfolge im Takt von DRIP.
export const FLOWS: Flow[][] = [
  // Tröpfeln: ein Tropfen alle anderthalb Sekunden.
  [fall(0), fall(0), fall(1), fall(1), fall(2), fall(2), SPLASHED, SPLASHED, RESTING, RESTING],
  // Tropfen: ohne Pause, einer alle 0,6 s.
  [fall(0), fall(1), fall(2), SPLASHED],
  // Strahl und starker Strahl: im Bogen nach rechts, die Striche wandern, die Pfütze spritzt.
  [jet('╌─╌╮', 1.2, false), jet('─╌─╮', 1.2, true)],
  [jet('━╍━╍━┓', 2.6, false), jet('╍━╍━╍┓', 2.6, true)],
]
// Ruht das Tröpfeln in diesem Takt? Dort darf der auslaufende Hahn zugehen, ohne dass ein
// Tropfen mitten im Fall verschwindet.
export const isRestingAt = (tick: number) => (FLOWS[0]?.[tick % (FLOWS[0]?.length ?? 1)] ?? RESTING) === RESTING

// Ab diesen Tokens der Sitzung eine Stufe größer (Eimer, Wolke, Tank, Flaschen, See), bis Stufe 10.
const SIZE_AT = [1, 50_000, 250_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000]
export const sizeLevel = (n: number) => SIZE_AT.filter(at => n >= at).length

// Der Serverschrank im Kühlturm: 0 ist kalt, 100 glüht. Je Takt beim Streamen so viel wärmer,
// je Stärke; der Schlauch kommt gegen viele Tokens pro Sekunde nicht an.
export const HEAT_FULL = 100
export const WARM = [0.5, 1, 2, 3.5]
export const stageOf = (heat: number) => (heat <= 0 ? 0 : Math.min(4, Math.ceil(heat / 25)))

// Die Anfahrt in Takten: hinfahren, halten (Clawd steigt aus), wegfahren. Zu Fuß ohne Wegfahren,
// dafür stellt er in den Haltetakten den Eimer ab, oder die Wolke zieht auf.
export const ARRIVE = { in: 10, hold: 4, out: 10 }
export const arrivalLength = (role: Role) => ARRIVE.in + ARRIVE.hold + (isWalking(role) ? 0 : ARRIVE.out)
// Wo das Fahrzeug steht: -1 ganz draußen links, 0 an Clawds Platz, 1 rechts hinaus. Es bremst beim
// Ankommen ab und fährt beim Wegfahren langsam an, statt mit gleicher Geschwindigkeit hart zu halten
// und loszuschießen. Terminal und Apps nehmen dieselbe Kurve, damit beide gleich fahren.
export function arrivalShift(arrival: number): number {
  if (arrival < ARRIVE.in) return -((1 - arrival / ARRIVE.in) ** 2)
  if (arrival < ARRIVE.in + ARRIVE.hold) return 0

  return ((arrival - ARRIVE.in - ARRIVE.hold + 1) / ARRIVE.out) ** 2
}
// Räder, Ruder und Kurbel drehen sich nur, solange das Fahrzeug fährt; im Halt stehen sie still.
// So breit sind die Fahrzeuge in den Apps; gewendet spiegeln sie sich um diese Breite.
const VEHICLE_WIDTH = 34
const rollOf = (arrival: number) => (arrival >= ARRIVE.in && arrival < ARRIVE.in + ARRIVE.hold ? ARRIVE.in : arrival)

export type Scene = {
  role: Role
  // null zugedreht, sonst das Bild aus FLOWS
  water: Flow | null
  // Stärke 0 bis 3 wie FLOWS
  strength: number
  tick: number
  level: number
  // Hitze des Serverschranks, 0 bis 4 wie stageOf
  stage: number
  flicker: number
  // Takt der Anfahrt, -1 ist angekommen
  arrival: number
}

// ---------- Terminal ----------
// Drei Zeilen, je neun Spalten für Clawd: Kopf in der Leiste, darunter zwei Zeilen. Rechts davon
// läuft die Szene in den Leerraum unter dem Zähler, links ist während der Anfahrt Platz für das Auto.

export const SLOT = 9
type Cell = { ch: string; color?: Color; dim?: boolean }
const BLANK: Cell = { ch: ' ' }
const cellsOf = (pieces: Piece[]): Cell[] =>
  pieces.flatMap(p => [...p.text].map(ch => ({ ch, color: p.color, dim: p.dim })))
const blank = (n: number): Cell[] => Array.from({ length: Math.max(0, n) }, () => BLANK)
// Setzt eine Zelle und füllt die Zeile bis dahin mit Leerzeichen auf.
function put(row: Cell[], at: number, cell: Cell) {
  while (row.length <= at) row.push(BLANK)
  row[at] = cell
}
// Gleich gefärbte Zellen wieder zu Stücken zusammen.
export function runsOf(cells: Cell[]): Piece[] {
  const runs: Piece[] = []
  for (const cell of cells) {
    const last = runs[runs.length - 1]
    const color = cell.ch === ' ' ? undefined : cell.color
    const dim = cell.ch === ' ' ? undefined : cell.dim
    if (last !== undefined && last.color === color && last.dim === dim) last.text += cell.ch
    else runs.push({ text: cell.ch, color, dim })
  }

  return runs
}
export const piecesText = (pieces: Piece[]) => pieces.map(p => p.text).join('')

// Alle Kopfbedeckungen sitzen mittig über Clawd (Spalten 0 bis 6, Mitte 3,5); nur Krempe,
// Schirm oder der Hahn reichen in die Spalten 7 und 8.
// Feuerwehrhelm: lange Krempe hinten, vorn das gelbe Abzeichen.
export const HELMET: Piece[] = [{ text: '▂▄▆█', color: 'error' }, { text: '█', color: 'warning' }, { text: '▆▖  ', color: 'error' }]
export const BODY: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '━', color: 'error' }, { text: '╾', color: 'warning' }]
// Die Beine wie im Clawd-Logo: vorne links, hinten rechts angesetzt, also mittig unter ihm.
export const LEGS: Piece[] = [{ text: ' ▘▘ ▝▝   ', color: 'claude' }]
// Beim Gehen im Wechsel ein Bein vor.
const STEP: Piece[] = [{ text: ' ▝▘ ▘▝   ', color: 'claude' }]
const CLAWD: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '  ' }]
// Klempnerkappe mit dem Schild nach vorn, daneben hängt der Hahn mit rotem Griff.
const CAP: Piece[] = [{ text: ' ▄▆██▆▄▖', color: 'suggestion' }]
const TAP: Piece[] = [{ text: '┓', color: 'inactive' }]
const TAP_HANDLE: Piece[] = [{ text: '┻', color: 'error' }]
// Strohhut für den Strohhalm: flache Krone, breite Krempe.
const STRAW_HAT: Piece[] = [{ text: '▁▂▅▅▅▂▁▁ ', color: 'warning' }]
// Schirm mit gelben und roten Bahnen wie in den Apps, damit er nicht wie ein Hut aussieht.
const CANOPY: Piece[] = [
  { text: '▄▆', color: 'warning' },
  { text: '█', color: 'error' },
  { text: '█', color: 'warning' },
  { text: '█', color: 'error' },
  { text: '▆▄', color: 'warning' },
  { text: '  ' },
]
const UNDER: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '  ' }]
// Die Fahrzeuge, je neun Spalten in zwei Zeilen.
// Feuerwehr: Drehleiter auf dem Aufbau, das Blaulicht vorn am Führerhaus blinkt.
const truck = (t: number): [Piece[], Piece[]] => [
  [{ text: '╤╤╤╤╤╕', color: 'inactive' }, { text: '▝', color: t % 2 === 0 ? 'suggestion' : 'inactive' }, { text: '█▙', color: 'error' }],
  [
    { text: '█', color: 'error' },
    { text: '●', color: 'inactive' },
    { text: '████', color: 'error' },
    { text: '●', color: 'inactive' },
    { text: '██', color: 'error' },
  ],
]
// Ruderboot auf dem Wasser: Holzrand über dem Rumpf, das Ruder zieht im Takt durchs Wasser,
// vorn die Bugwelle.
const rowboat = (t: number): [Piece[], Piece[]] => {
  const isPulling = t % 2 === 0

  return [
    [{ text: isPulling ? '╲ ' : '──', color: 'warning' }, { text: '▄▄▄▄▄▄▖', color: 'warning' }],
    [
      { text: isPulling ? '≈' : '~', color: 'suggestion' },
      { text: isPulling ? '╲' : ' ', color: 'warning' },
      { text: '▜████▛', color: 'claude' },
      { text: '≈', color: 'suggestion' },
    ],
  ]
}
// Lastenrad: Hinterrad und Sattel, die Kurbel dreht sich, vorn die rote Kiste voller Wasserflaschen.
const cargoBike = (t: number): [Piece[], Piece[]] => [
  [{ text: ' ▬╮ ┃', color: 'inactive' }, { text: '╻╻╻', color: 'suggestion' }, { text: ' ' }],
  [
    { text: '(●)', color: 'inactive' },
    { text: t % 2 === 0 ? '┼' : '╳', color: 'inactive' },
    { text: '┻', color: 'inactive' },
    { text: '███', color: 'error' },
    { text: '●', color: 'inactive' },
  ],
]

// Feuerwehrschlauch nach rechts im Bogen, wie FLOWS ihn vorgibt.
const spray = (water: Flow | null): Cell[] =>
  water === null ? [] : cellsOf([{ text: water.cell, color: 'suggestion' }])
const splashAt = (water: Flow | null) => (water !== null && water.isSplash ? water.land : null)

// Die Pfütze unterm Schirm beginnt an Clawds Füßen und wächst nach rechts, zur Mitte hin tiefer
// (ab Stufe 3 und 6 je eine Stufe). Wo das Wasser aufschlägt, hebt sie sich; daneben spritzt es nur.
export function puddle(level: number, hit: number | null): string {
  const width = level === 0 ? 0 : 2 * level - 1
  const deepest = level >= 6 ? 2 : level >= 3 ? 1 : 0
  const cells = Array.from({ length: width }, (_, i) => '▁▂▃'[Math.min(deepest, i, width - 1 - i)] ?? '▁')
  if (hit === null) return cells.join('')
  while (cells.length <= hit) cells.push(' ')
  const was = cells[hit]
  cells[hit] = was === ' ' ? ',' : was === '▁' ? '▂' : was === '▂' ? '▃' : '▄'

  return cells.join('')
}

// Was eine Rolle zeichnet: den Kopf in der Leiste, Clawds zwei Zeilen und rechts die Szene.
type Parts = { head: Cell[]; slots: Cell[][]; rights: Cell[][] }

// Hahn: der Hahn hängt in der Leiste neben der Kappe, darunter fällt das Wasser in Spalte 8
// in den Eimer (Spalten 7 bis 9). Bis Stufe 5 steigt der Pegel, danach läuft er über und die
// Pfütze breitet sich nach rechts aus.
const BUCKET = '▁▂▃▄▆█'
const OVERFLOW = [1, 2, 4, 6, 8]
function tapParts(scene: Scene): Parts {
  const { water, strength, tick, level } = scene
  const head = cellsOf([...CAP, ...TAP])
  head[7] = cellsOf(TAP_HANDLE)[0] ?? BLANK
  const top = cellsOf(CLAWD)
  const low = cellsOf(LEGS)
  const fill = Math.min(5, level)
  let inner = fill
  const right: Cell[] = []
  // Dicht ist er nie: zugedreht hängt ein Tropfen am Auslauf.
  if (water === null) top[8] = { ch: "'", color: 'suggestion', dim: true }
  if (water !== null) {
    if (strength <= 1) {
      if (water.drop !== null) top[8] = { ch: water.cell, color: 'suggestion' }
      if (water.isSplash) inner += 1
    } else {
      // Läuft und sprudelt: ein Strahl, dessen Striche wandern; ganz stark spritzt es aus dem Eimer.
      top[8] = { ch: strength === 3 ? (tick % 2 === 0 ? '┃' : '╏') : tick % 2 === 0 ? '│' : '╎', color: 'suggestion' }
      inner += tick % 2
      if (strength === 3) put(tick % 2 === 0 ? right : top, tick % 2 === 0 ? 1 : 7, { ch: '˙', color: 'suggestion' })
    }
  }
  const water8 = BUCKET[Math.min(BUCKET.length - 1, inner)] ?? '█'
  low[7] = { ch: '▕', color: 'inactive' }
  low[8] = level === 0 && inner === 0 ? { ch: '▁', color: 'inactive', dim: true } : { ch: water8, color: 'suggestion' }
  const floor: Cell[] = [{ ch: '▏', color: 'inactive' }]
  const spill = OVERFLOW[level - 6] ?? 0
  for (let i = 0; i < spill; i += 1) {
    const ch = i === 0 || (level >= 9 && i < 3) ? '▂' : '▁'
    const isWave = water !== null && i === spill - 1 && tick % 2 === 1
    floor.push({ ch: isWave ? '▂' : ch, color: 'suggestion', dim: true })
  }

  return { head, slots: [top, low], rights: [right, floor] }
}

// Die Wolke steht rechtsbündig über dem Schirm und wird mit den Tokens breiter. Innen
// wechseln hohe und niedrige Bäusche, damit sie nach Wolke aussieht und nicht nach Hügel.
// Ein paar Bäusche sind Server-LEDs: Sie leuchten grün, beim Regen blinken sie, beim Gewitter gelb.
const CLOUD_WIDTH = [3, 3, 4, 5, 5, 6, 6, 7, 8, 8, 9]
const PUFFS = '▆█▅▇▆█▅'
const LEDS: Color[] = ['success', 'suggestion', 'warning']
export function cloud(level: number, share = 1, tick = 0, strength = -1): Cell[] {
  const full = CLOUD_WIDTH[Math.min(level, 10)] ?? 3
  const width = share <= 0 ? 0 : Math.max(1, Math.round(full * Math.min(1, share)))
  const puffs = width < 3 ? '▄▃'.slice(0, width) : `▃${PUFFS.slice(0, width - 2)}▃`
  const cells = cellsOf([{ text: ' '.repeat(SLOT - width) }, { text: puffs, color: 'inactive' }])
  if (share < 1) return cells
  const isFlash = strength === 3 && tick % 4 < 2
  LEDS.forEach((color, k) => {
    const at = SLOT - 2 - k * 2
    const cell = cells[at]
    if (cell === undefined || at <= SLOT - width) return
    const isLit = strength < 0 ? k === 0 : (tick + k) % 3 !== 0
    if (isLit || isFlash) cells[at] = { ch: cell.ch, color: isFlash ? 'warning' : color }
  })

  return cells
}
// Regen neben dem Schirm in den Spalten 7 und 8, im Tempo der Tokens.
const RAIN = ['˙', '·', '╎', '╏']
function rain(strength: number, tick: number): [Cell[], Cell[]] {
  const ch = RAIN[strength] ?? '˙'
  const top = blank(SLOT)
  const low = blank(SLOT)
  const drop = (row: Cell[], col: number) => (row[col] = { ch, color: 'suggestion' })
  if (strength === 0) {
    const phase = tick % 4
    if (phase === 0) drop(top, 8)
    if (phase === 1) drop(low, 8)
  } else if (strength === 1) {
    drop(top, 7 + (tick % 2))
    drop(low, 8 - (tick % 2))
  } else {
    for (const row of [top, low]) for (const col of [7, 8]) drop(row, col)
    if (tick % 2 === 1) top[7] = { ch: ' ' }
    // Gewitter: Der Blitz zuckt neben dem Schirm.
    if (strength === 3 && tick % 4 < 2) {
      top[8] = { ch: '╲', color: 'warning' }
      low[8] = { ch: '╱', color: 'warning' }
    }
  }

  return [top, low]
}
function cloudParts(scene: Scene): Parts {
  const { water, strength, tick, level } = scene
  let slots = [cellsOf(CANOPY), cellsOf(UNDER)]
  if (water !== null) {
    const drops = rain(strength, tick)
    slots = slots.map((slot, r) => slot.map((cell, i) => {
      const drop = drops[r]?.[i]
      return drop !== undefined && drop.ch !== ' ' ? drop : cell
    }))
  }

  return {
    head: cloud(level, 1, tick, water === null ? -1 : strength),
    slots,
    rights: [[], cellsOf([{ text: puddle(level, water !== null && water.isSplash ? 0 : null), color: 'suggestion', dim: true }])],
  }
}

// Kühlturm: der Strahl in den Spalten 0 bis 5, dahinter der Serverschrank (6 bis 9), der mit der
// Hitze erst gelb, dann orange, dann rot wird. Daneben dampft es, solange Wasser auf ihn trifft,
// sonst flimmert die Hitze; ganz rechts der Kühlwassertank, der sich mit den Tokens leert.
const RACK_AT = 6
const RACK_HEAT: Color[] = ['inactive', 'inactive', 'warning', 'claude', 'error']
const EIGHTHS = ' ▁▂▃▄▅▆▇█'
function coolingParts(scene: Scene): Parts {
  const { water, tick, level, stage, flicker } = scene
  const top = spray(water)
  const low: Cell[] = []
  const hit = splashAt(water)
  if (hit !== null) put(low, hit, { ch: ',', color: 'suggestion' })
  const frame = RACK_HEAT[stage] ?? 'inactive'
  const isOn = water !== null
  for (const [r, row] of [top, low].entries()) {
    put(row, RACK_AT, { ch: '▐', color: frame })
    for (const i of [1, 2]) {
      const isLit = !isOn || (tick + i + r) % 3 !== 0
      put(row, RACK_AT + i, isLit ? { ch: '▪', color: stage >= 3 ? 'error' : stage === 2 ? 'warning' : 'success' } : { ch: '▫', color: 'inactive' })
    }
    put(row, RACK_AT + 3, { ch: '▌', color: frame })
  }
  if (isOn && stage > 0) {
    put(top, RACK_AT + 4 + (tick % 2), { ch: tick % 2 === 0 ? '˜' : '~', color: 'inactive' })
  } else if (stage >= 2) {
    put(top, RACK_AT + 4, { ch: flicker % 2 === 0 ? '≀' : '~', color: stage >= 4 ? 'error' : 'claude' })
  }
  const units = Math.round(16 * (1 - Math.min(10, level) / 10))
  const tank = [Math.max(0, units - 8), Math.min(8, units)]
  for (const [r, row] of [top, low].entries()) {
    const at = RACK_AT + 6
    const amount = tank[r] ?? 0
    put(row, at, { ch: '▕', color: 'inactive' })
    put(row, at + 1, amount === 0 ? (r === 1 ? { ch: '▁', color: 'inactive', dim: true } : BLANK) : { ch: EIGHTHS[amount] ?? '█', color: 'suggestion', dim: true })
    put(row, at + 2, { ch: '▏', color: 'inactive' })
  }

  return { head: cellsOf(HELMET), slots: [cellsOf(BODY), cellsOf(LEGS)], rights: [top, low] }
}

// Durst: die Flasche liegt Clawd quer am Mund (Hals in Spalte 7, Bauch bis Spalte 11). Beim
// Gluckern wandert eine Luftblase zum Flaschenboden, je mehr Tempo, desto mehr; ganz viel, und
// es kleckert. Die leeren Flaschen stehen rechts, unten sechs, darüber vier.
function thirstParts(scene: Scene, isPresent: boolean): Parts {
  const { water, strength, tick, level } = scene
  const top = cellsOf([{ text: '▐▛███▜▌', color: 'claude' }, { text: '╺', color: 'inactive' }, { text: '▆', color: 'suggestion' }])
  const right = cellsOf([{ text: '▆▆', color: 'suggestion' }, { text: '▌', color: 'suggestion', dim: true }])
  const bottle = [top, top, right, right, right]
  const bottleAt = [8, 8, 0, 1, 2]
  if (water !== null) {
    // Je mehr Tempo, desto mehr Blasen und desto schneller wandern sie.
    const count = [1, 1, 2, 3][strength] ?? 1
    for (let k = 0; k < count; k += 1) {
      const at = 1 + ((tick * (strength + 1) + k * 2) % 3)
      const row = bottle[at] ?? right
      put(row, bottleAt[at] ?? 0, { ch: '▄', color: 'suggestion' })
    }
  }
  const low = cellsOf(LEGS)
  if (water !== null && strength === 3) low[7] = { ch: tick % 2 === 0 ? '˙' : ',', color: 'suggestion' }
  const empties: Cell[][] = [isPresent ? [...right] : [], []]
  const bottom = Math.min(6, level)
  const upper = Math.max(0, Math.min(4, level - 6))
  for (let i = 0; i < bottom; i += 1) put(empties[1] ?? [], 4 + i, { ch: '▯', color: 'inactive' })
  for (let i = 0; i < upper; i += 1) put(empties[0] ?? [], 5 + i, { ch: '▯', color: 'inactive' })

  return { head: blank(SLOT), slots: [top, low], rights: empties }
}

// See: Clawd schlürft durch den rot-weißen Strohhalm (Spalte 7 bis zum Knick in Spalte 10, dann
// hinab ins Wasser). Die Streifen wandern beim Saugen zu ihm, im See steigen Blasen auf. Mit den
// Tokens schrumpft der See von rechts, zurück bleibt rissiger Boden, und ab Stufe 8 zappelt ein Fisch.
const LAKE_WIDTH = [13, 12, 11, 10, 9, 8, 7, 5, 4, 2, 0]
const LAKE = 13
function lakeParts(scene: Scene, isPresent: boolean): Parts {
  const { water, strength, tick, level } = scene
  const isOn = water !== null
  // Die Streifen wandern je Stärke schneller.
  const flow = isOn ? tick * (strength + 1) : 0
  const stripe = (i: number): Cell => ({ ch: '━', color: (i + flow) % 2 === 0 ? 'error' : undefined })
  const top = cellsOf(CLAWD)
  top[7] = stripe(0)
  top[8] = stripe(1)
  const right: Cell[] = [stripe(2), { ch: '┓', color: (3 + flow) % 2 === 0 ? 'error' : undefined }]
  const width = LAKE_WIDTH[Math.min(10, level)] ?? 0
  const lake: Cell[] = Array.from({ length: LAKE }, (_, i) => {
    if (i < width) return { ch: isOn && i === 2 && tick % 2 === 0 ? '~' : '≈', color: 'suggestion', dim: true }
    // Trockener Boden, mit der Zeit rissig.
    return { ch: level >= 5 && (i - width) % 3 === 1 ? 'ˇ' : '▁', color: 'warning', dim: true }
  })
  if (isPresent) lake[1] = { ch: '┃', color: (4 + flow) % 2 === 0 ? 'error' : undefined }
  if (isOn && width > 2) {
    const count = [1, 1, 2, 3][strength] ?? 1
    for (let k = 0; k < count; k += 1) {
      const at = 2 + ((flow + k * 2) % 3)
      if (at < width + 1) put(right, at, { ch: (tick + k) % 2 === 0 ? '°' : 'o', color: 'suggestion' })
    }
  }
  if (level >= 8) {
    const isFlopping = isOn && tick % 2 === 1
    cellsOf([{ text: isFlopping ? '<><' : '><>', color: 'warning' }]).forEach((cell, i) => (lake[LAKE - 4 + i] = cell))
    if (isFlopping) put(right, LAKE - 3, { ch: '˙', color: 'inactive' })
  }

  return { head: cellsOf(STRAW_HAT), slots: [top, cellsOf(LEGS)], rights: [isPresent ? right : [], lake] }
}

// `isPresent`: Clawd steht an seinem Platz; solange das Fahrzeug davor hält, fehlt auch, was er hält.
function partsOf(scene: Scene, isPresent: boolean): Parts {
  if (scene.role === 'tap') return tapParts(scene)
  if (scene.role === 'cloud') return cloudParts(scene)
  if (scene.role === 'cooling') return coolingParts(scene)
  if (scene.role === 'thirst') return thirstParts(scene, isPresent)

  return lakeParts(scene, isPresent)
}

export type TerminalScene = {
  // Die Zeile in der Leiste und die Zeile, wenn nur eine Platz hat
  head: Piece[]
  flat: Piece[]
  // Zeilen darunter: links Platz für die Anfahrt, Clawds Spalten, rechts die Szene
  rows: { left: Piece[]; slot: Piece[]; right: Piece[] }[]
}

// `room` ist der Platz links für die Anfahrt, `reach` die Breite rechts bis unter das Ende des Zählers.
export function terminalScene(scene: Scene, room: number, reach: number): TerminalScene {
  const { role, level, arrival } = scene
  const parts = partsOf(scene, arrival < 0 || isWalking(role) || arrival >= ARRIVE.in + ARRIVE.hold)
  const flat = runsOf(parts.slots[0] ?? [])
  let { head: headCells, slots, rights } = parts
  let lefts: Cell[][] = [blank(room), blank(room)]

  // Legt das, was hereinkommt, über die Zeilen: links die Spur, Clawds Platz, rechts die Szene.
  const overlay = (moving: Cell[][], at: number, under: Cell[][]) => {
    const rowsAt = under.map((slot, r) => {
      const row = [...blank(room), ...slot, ...(rights[r] ?? []), ...blank(reach)].slice(0, room + SLOT + reach)
      ;(moving[r] ?? []).forEach((cell, i) => {
        const x = room + at + i
        if (x >= 0 && x < row.length) row[x] = cell
      })

      return row
    })
    lefts = rowsAt.map(row => row.slice(0, room))
    slots = rowsAt.map(row => row.slice(room, room + SLOT))
    rights = rowsAt.map(row => row.slice(room + SLOT))
  }

  if (arrival >= 0) {
    const hidden = blank(SLOT)
    if (isWalking(role)) {
      // Zu Fuß: Clawd läuft von links an seinen Platz. Unterm Schirm zieht danach die Wolke auf;
      // als Klempner trägt er den Eimer und setzt erst dort die Kappe auf.
      const walked = Math.min(1, arrival / ARRIVE.in)
      const at = Math.round(-(room + SLOT) * (1 - walked))
      if (role === 'cloud') {
        overlay(slots, at, [hidden, hidden])
        const share = arrival < ARRIVE.in ? 0 : (arrival - ARRIVE.in + 1) / ARRIVE.hold
        headCells = cloud(level, share)
      } else if (arrival < ARRIVE.in) {
        const carrying = [
          cellsOf([...CLAWD.slice(0, 1), { text: ' ' }, { text: '▙▟', color: 'inactive' }]),
          cellsOf(arrival % 2 === 0 ? LEGS : STEP),
        ]
        rights = [[], []]
        overlay(carrying, at, [hidden, hidden])
        headCells = [...blank(7), ...headCells.slice(7)]
      }
    } else {
      // Mit dem Fahrzeug: von links bis vor Clawds Platz, kurz halten, dann nach links wieder
      // weg, statt durch die Szene zu fahren.
      // Ab dem zweiten Haltetakt ist Clawd ausgestiegen und sein Kopf schaut über das Dach.
      const vehicle = role === 'thirst' ? cargoBike(rollOf(arrival)) : role === 'lake' ? rowboat(rollOf(arrival)) : truck(arrival)
      const shift = arrivalShift(arrival)
      const at = Math.round((shift < 0 ? shift : -shift) * (room + SLOT))
      const isOut = arrival > ARRIVE.in
      overlay(vehicle.map(cellsOf), at, isOut ? slots : [hidden, hidden])
      if (!isOut) headCells = hidden
    }
  }

  const fit = (cells: Cell[]) => [...cells, ...blank(reach)].slice(0, reach)

  return {
    head: runsOf([...headCells, ...blank(SLOT)].slice(0, SLOT)),
    flat,
    rows: [0, 1].map(r => ({
      left: runsOf(lefts[r] ?? []),
      slot: runsOf([...(slots[r] ?? []), ...blank(SLOT)].slice(0, SLOT)),
      right: runsOf(fit(rights[r] ?? [])),
    })),
  }
}

// ---------- Apps ----------
// Pixel wie die Krabben der Clawd-Crew, gezeichnet in 60 × 27, angezeigt gut 1,3-fach.
export const SCENE_VIEW = { x: 0, y: 3, width: 60, height: 27 }
export const SCENE_SVG = { width: 80, height: 36 }
export type SceneColors = { suggestion: string; gray: string }
const INK = {
  clay: '#D97757',
  ink: '#1F1E1D',
  red: '#C8372D',
  shine: '#E25A4C',
  brim: '#8E2219',
  gold: '#F5C542',
  silver: '#E6E4DD',
  boot: '#2B2724',
  hose: '#B3322A',
  brass: '#D4A93F',
  tip: '#8F7429',
  straw: '#E8C872',
  strawDark: '#C9A04E',
  leaf: '#4E8A3E',
  denim: '#4A6FA5',
  denimDark: '#34507D',
  soil: '#7A5A3A',
  crack: '#5A4129',
  concrete: '#8D8B85',
  concreteTop: '#A9A7A0',
  orange: '#E8743B',
  glass: '#BFD9F2',
  glassEdge: '#7C9AB5',
  siren: '#4A7DFF',
  sirenOff: '#22397A',
  umbrella: '#F5C542',
  umbrellaDark: '#C99A1E',
  led: '#4EBA65',
  rack: '#3A3633',
  flour: '#F4F1EA',
  flourDark: '#D8D2C4',
  wood: '#B07A45',
  crust: '#C98A4B',
  fish: '#9DB8C9',
  sole: '#5E5550',
}
const GROUND = 27.5
const px = (x: number, y: number, w: number, h: number, c: string, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"${extra}/>`
const crisp = (inner: string) => `<g shape-rendering="crispEdges">${inner}</g>`

// Stiefel je Rolle, hell genug für dunkle und helle Hintergründe: Arbeitsschuhe, barfuß unterm
// Schirm, Gummistiefel, weiße Turnschuhe, barfuß am See.
const BOOTS: Record<Role, string | null> = {
  tap: INK.sole,
  cloud: null,
  cooling: INK.sole,
  thirst: INK.flourDark,
  lake: null,
}
// Clawd selbst, im Kostüm seiner Rolle; `step` hebt beim Gehen jedes zweite Bein, `isGulping`
// kneift beim Schlucken die Augen zu, `isHolding` lässt die vordere Schere für die Flasche frei.
function clawdPx(role: Role, step: number, isGulping = false, isHolding = false): string {
  const legs = [8, 12, 18, 22]
  const boot = BOOTS[role]
  const parts = [
    px(4, 15, 4, 4, INK.clay),
    px(8, 12, 16, 10, INK.clay),
    isHolding ? px(24, 15, 2, 3, INK.clay) : px(24, 15, 4, 4, INK.clay),
    isGulping ? px(10, 15, 2, 1, INK.ink) + px(20, 15, 2, 1, INK.ink) : px(10, 14, 2, 2, INK.ink) + px(20, 14, 2, 2, INK.ink),
    ...legs.flatMap((x, i) => {
      const lift = step % 2 === 1 && i % 2 === 1 ? 1 : 0
      return boot === null
        ? [px(x, 22 - lift, 2, 4, INK.clay)]
        : [px(x, 22 - lift, 2, 2, INK.clay), px(x, 24 - lift, 2, 2, boot)]
    }),
  ]
  if (role === 'cooling') {
    parts.push(
      // Reflexstreifen, Helm mit Kamm, langer Krempe hinten und Abzeichen vorn
      px(8, 19, 16, 1, INK.gold),
      px(8, 20, 16, 1, INK.silver),
      px(12, 6, 8, 1, INK.red),
      px(11, 7, 10, 1, INK.red),
      px(10, 8, 12, 2, INK.red),
      px(9, 10, 14, 1, INK.red),
      px(15, 6, 2, 4, INK.shine),
      px(3, 11, 22, 1, INK.brim),
      px(19, 7, 3, 3, INK.gold),
      px(20, 8, 1, 1, INK.red),
      // Strahlrohr in der vorderen Schere
      px(27, 16, 1, 2, INK.hose),
      px(28, 16, 4, 2, INK.brass),
      px(32, 16.5, 2, 1, INK.tip),
    )
  } else if (role === 'tap') {
    parts.push(
      // Blaue Latzhose, Kappe mit dem Schild nach vorn, Rohrzange in der Schere
      px(11, 17, 10, 2, INK.denim),
      px(8, 19, 16, 3, INK.denim),
      px(12, 18, 1, 1, INK.gold),
      px(19, 18, 1, 1, INK.gold),
      px(11, 7, 10, 1, INK.denim),
      px(10, 8, 12, 3, INK.denim),
      px(10, 10, 12, 1, INK.denimDark),
      px(19, 11, 8, 1, INK.denimDark),
      px(15, 8, 2, 1, INK.shine),
      px(27, 16.5, 5, 1, INK.concrete),
      px(31, 15, 1, 1.5, INK.concrete),
      px(32, 15, 1.5, 1, INK.concrete),
    )
  } else if (role === 'thirst') {
    // Rotes Schweißband, die Enden flattern hinten links.
    parts.push(px(8, 12, 16, 1.5, INK.red), px(5, 12.5, 3, 0.8, INK.red), px(4.5, 13.6, 2.5, 0.8, INK.brim))
  } else if (role === 'lake') {
    // Strohhut mit grünem Band
    parts.push(
      px(11, 6, 10, 1, INK.straw),
      px(10, 7, 12, 3, INK.straw),
      px(10, 9, 12, 1, INK.leaf),
      px(4, 10, 24, 1, INK.strawDark),
      px(5, 11, 22, 1, INK.straw),
    )
  } else {
    // Aufgespannter Schirm aus fünf Bahnen, gelb und rot im Wechsel wie im Terminal, unten
    // gewellt; tief über den Kopf gezogen, damit darüber Platz für die Wolke bleibt.
    const panels: [number, number, boolean][] = [[4, 10, false], [10, 14, true], [14, 18, false], [18, 22, true], [22, 28, false]]
    const rows: [number, number, number][] = [[9, 11, 21], [10, 7, 25], [11, 4, 28]]
    parts.push(px(15, 7.5, 2, 1.5, INK.umbrellaDark))
    for (const [y, from, to] of rows) {
      for (const [a, b, isRed] of panels) {
        const left = Math.max(a, from)
        const right = Math.min(b, to)
        if (right > left) parts.push(px(left, y, right - left, 1, isRed ? INK.shine : INK.umbrella))
      }
    }
    parts.push(...panels.map(([a, b, isRed]) => px(a + 0.5, 12, b - a - 1, 1, isRed ? INK.brim : INK.umbrellaDark)))
  }

  return crisp(parts.join(''))
}

// Rad mit Reifen und Nabe; das Profil dreht sich beim Fahren mit dem Takt.
const wheelPx = (cx: number, cy: number, r: number, hub: string, t: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${INK.boot}"/>` +
  `<circle cx="${cx}" cy="${cy}" r="${r - 0.5}" fill="none" stroke="${INK.ink}" stroke-width="0.8" stroke-dasharray="1 1" stroke-dashoffset="${(t % 2) * 1}"/>` +
  `<circle cx="${cx}" cy="${cy}" r="${(r * 0.4).toFixed(2)}" fill="${hub}"/>`

// Feuerwehr: Aufbau mit Geräteräumen und Drehleiter, Führerhaus mit Scheibe, Tür und Scheinwerfer,
// zwei Blaulichter auf dem Dach blinken im Wechsel.
function truckPx(t: number, roll: number): string {
  const isLeft = t % 2 === 0
  return (
    crisp(
      [
        px(0, 15, 24, 10, INK.red),
        px(24, 13, 10, 12, INK.red),
        px(27, 15, 6, 4, INK.glass),
        px(25, 15, 1, 8, INK.brim),
        px(1, 13, 21, 0.6, INK.silver),
        px(1, 14.4, 21, 0.6, INK.silver),
        ...[3, 7, 11, 15, 19].map(x => px(x, 13, 0.6, 2, INK.silver)),
        ...[2, 9, 16].map(x => px(x, 16, 5, 4.5, INK.brim) + px(x + 2, 18, 1, 0.5, INK.silver)),
        px(0, 21, 34, 1, INK.gold),
        px(25, 11.5, 8, 1.5, INK.silver),
        px(26, 10, 2, 1.5, isLeft ? INK.siren : INK.sirenOff),
        px(30, 10, 2, 1.5, isLeft ? INK.sirenOff : INK.siren),
        px(33, 18, 1, 2, INK.gold),
        px(33, 22, 2, 2, INK.concrete),
      ].join(''),
    ) + [7, 28].map(x => wheelPx(x, 25, 2.6, INK.concrete, roll)).join('')
  )
}

const splashSvg = (x: number, y: number, colors: SceneColors) =>
  `<ellipse cx="${x}" cy="${y}" rx="2.5" ry="0.9" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.6" stroke-width="0.7"/><circle cx="${x - 1.5}" cy="${y - 2}" r="0.6" fill="${colors.suggestion}" fill-opacity="0.7"/><circle cx="${x + 1.5}" cy="${y - 2.5}" r="0.6" fill="${colors.suggestion}" fill-opacity="0.7"/>`

// Hahn: Standrohr bei x 48 mit rotem Drehgriff, der Auslauf über dem Eimer bei x 41. Der Eimer
// füllt sich bis Stufe 5, danach rinnt es über den Rand und die Pfütze wird breiter, bis Clawd
// nasse Füße hat.
const SPOUT = { x: 41, y: 14.5 }
const PAIL = { left: 36, right: 46, top: 19.5 }
function tapSvg(scene: Scene, colors: SceneColors, hasBucket: boolean): { back: string; front: string } {
  const { water, strength, tick, level } = scene
  const wet = `fill="${colors.suggestion}"`
  const spill = Math.max(0, level - 5)
  const pool = spill > 0 ? `<ellipse cx="41" cy="${GROUND}" rx="${7 + spill * 2.6}" ry="${1 + spill * 0.15}" ${wet} fill-opacity="0.35"/>` : ''
  const pipe = crisp(
    [
      px(47, 10, 2.5, GROUND - 10, INK.concrete),
      px(46.5, GROUND - 1, 3.5, 1, INK.concreteTop),
      px(40, 10, 9.5, 2, INK.concreteTop),
      px(40, 12, 2, 2.5, INK.concreteTop),
      px(39.7, 14, 2.6, 0.6, INK.concrete),
      px(44, 9, 1, 1, INK.concrete),
      px(42, 7.8, 5, 1.2, INK.red),
      px(44, 7, 1, 3, INK.red),
    ].join(''),
  )
  if (!hasBucket) return { back: pool + pipe, front: '' }
  const fill = Math.min(5, level) / 5
  const depth = 7.2 * fill
  const surface = GROUND - 0.6 - depth
  // Der Eimer verjüngt sich nach unten: oben 10 breit, unten 8.
  const inset = (y: number) => ((y - PAIL.top) / (GROUND - PAIL.top)) * 1
  const bucket =
    `<path d="M${PAIL.left} ${PAIL.top} L${PAIL.right} ${PAIL.top} L${PAIL.right - 1} ${GROUND} L${PAIL.left + 1} ${GROUND} Z" fill="${INK.concrete}"/>` +
    (depth > 0
      ? `<path d="M${PAIL.left + 0.8 + inset(surface)} ${surface} L${PAIL.right - 0.8 - inset(surface)} ${surface} L${PAIL.right - 1.6} ${GROUND - 0.6} L${PAIL.left + 1.6} ${GROUND - 0.6} Z" ${wet} fill-opacity="0.85"/>`
      : '') +
    crisp(px(PAIL.left - 0.3, PAIL.top - 0.6, 10.6, 1, INK.concreteTop) + px(PAIL.left + 1, 23.5, 8, 0.4, INK.concreteTop, ' fill-opacity="0.5"')) +
    `<path d="M${PAIL.left + 1} ${PAIL.top - 0.4} Q 41 ${PAIL.top - 5} ${PAIL.right - 1} ${PAIL.top - 0.4}" fill="none" stroke="${INK.concreteTop}" stroke-width="0.5"/>`
  // Übergelaufen: an beiden Seiten rinnt es den Eimer hinab.
  const over =
    spill > 0
      ? `<path d="M${PAIL.left} ${PAIL.top - 0.2} Q ${PAIL.left - 0.8} 23 ${PAIL.left - 0.2} ${GROUND}" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.8" stroke-width="0.9"/>` +
        `<path d="M${PAIL.right} ${PAIL.top - 0.2} Q ${PAIL.right + 0.8} 23 ${PAIL.right + 0.2} ${GROUND}" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.8" stroke-width="0.9"/>`
      : ''
  const land = depth > 0 ? surface : GROUND - 1
  let stream = ''
  if (water !== null) {
    if (water.drop !== null) {
      const y = SPOUT.y + 1 + ((land - SPOUT.y - 2) * water.drop) / 2
      stream = `<ellipse cx="${SPOUT.x}" cy="${y.toFixed(1)}" rx="0.9" ry="1.2" ${wet} fill-opacity="0.9"/>`
    } else if (water.isSplash && water.jet === 0) {
      stream = splashSvg(SPOUT.x, land, colors)
    }
    if (water.jet > 0) {
      const width = strength === 3 ? 2 : 1.1
      stream =
        `<path d="M${SPOUT.x} ${SPOUT.y} L${SPOUT.x} ${land}" stroke="${colors.suggestion}" stroke-opacity="0.85" stroke-width="${width}" stroke-dasharray="${strength === 3 ? '3 0.8' : '2 1.2'}" stroke-dashoffset="${-(tick % 4) * 0.9}"/>` +
        `<ellipse cx="${SPOUT.x}" cy="${land}" rx="${strength === 3 ? 3 : 2}" ry="0.7" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.7" stroke-width="0.6"/>`
      // Sprudelt: Spritzer fliegen aus dem Eimer.
      if (strength === 3) {
        const up = tick % 2 === 0 ? 0 : 1.5
        stream += [[-3.5, -3], [3.5, -2.5], [-1.8, -5], [2, -4.5]]
          .map(([dx, dy], i) => `<circle cx="${SPOUT.x + (dx ?? 0) * (i % 2 === tick % 2 ? 1.2 : 1)}" cy="${(land + (dy ?? 0) - (i < 2 ? up : -up * 0.5)).toFixed(1)}" r="0.55" ${wet} fill-opacity="0.85"/>`)
          .join('')
      }
    }
  }

  return { back: pool + pipe, front: bucket + over + stream }
}
// Der Eimer in der Schere, solange Clawd ihn herbeiträgt.
const carriedPail = crisp(px(28, 18, 5, 4, INK.concrete) + px(27.7, 17.5, 5.6, 0.8, INK.concreteTop)) +
  `<path d="M28.5 17.8 Q 30.5 14.5 32.5 17.8" fill="none" stroke="${INK.concreteTop}" stroke-width="0.5"/>`

// Die Wolke schwebt rechts über dem Schirm und wächst mit den Tokens in die Breite und in die
// Höhe: unten ein flacher Bauch, oben Bäusche verschiedener Größe, der höchste in der Mitte. Im
// Bauch sitzt eine kleine Rack-Front mit Server-LEDs, die beim Regnen blinken.
const BELLY = 9.5
const cloudShape = (level: number) => {
  const size = Math.min(10, level) / 10
  const width = 15 + 14 * size
  return { width, height: 3.6 + 2 * size, center: 32 + 9 * size }
}
// Bäusche: Lage über die Breite und Größe im Verhältnis zur Höhe.
const BILLOWS: [number, number][] = [[0.1, 0.5], [0.27, 0.78], [0.47, 1], [0.64, 0.72], [0.8, 0.84], [0.93, 0.48], [0.37, 0.6]]
const LED_COLORS = [INK.led, INK.siren, INK.gold]
function cloudSvg(scene: Scene, share: number, colors: SceneColors): string {
  if (share <= 0) return ''
  const { water, strength, tick, level } = scene
  const isRaining = water !== null
  const isDark = isRaining && strength >= 2
  const isFlash = isRaining && strength === 3 && tick % 4 < 2
  const shape = cloudShape(level)
  const grow = Math.min(1, share)
  const width = shape.width * grow
  const height = shape.height * (0.5 + grow / 2)
  const left = shape.center - width / 2
  const tone = isFlash ? '#B9AE8E' : isDark ? '#80838F' : colors.gray
  const fill = `fill="${tone}" fill-opacity="${(0.92 * Math.min(1, share + 0.2)).toFixed(2)}"`
  const puffs = BILLOWS.map(([at, size]) => {
    const r = size * height * 0.55
    return `<circle cx="${(left + at * width).toFixed(2)}" cy="${(BELLY - 1 - r * 0.75).toFixed(2)}" r="${r.toFixed(2)}" ${fill}/>`
  }).join('')
  const belly = `<rect x="${(left + 0.4).toFixed(2)}" y="${BELLY - 2.6}" width="${(width - 0.8).toFixed(2)}" height="2.6" rx="1.3" ${fill}/>`
  const body = `<g>${puffs}${belly}</g>`
  if (share < 1) return body
  // Die Rack-Front: ein dunkler Streifen im Bauch, darin eine Reihe LEDs.
  const rack = { x: shape.center - width * 0.3, width: width * 0.6 }
  const count = Math.floor((rack.width - 1) / 1.8)
  const leds = Array.from({ length: count }, (_, i) => {
    const isLit = !isRaining ? i % 3 === 0 : (i + tick) % 3 !== 0
    const color = isFlash ? INK.gold : (LED_COLORS[i % LED_COLORS.length] ?? INK.led)
    return isLit || isFlash ? px(rack.x + 0.8 + i * 1.8, BELLY - 1.75, 0.9, 0.7, color) : ''
  }).join('')
  const front = crisp(px(rack.x, BELLY - 2.2, rack.width, 1.6, INK.rack, ' fill-opacity="0.85"') + leds)

  return body + front + (isFlash ? boltSvg(shape.center + width * 0.12) : '')
}
// Der Blitz zuckt aus dem Wolkenbauch senkrecht hinab, rechts vom Schirm.
function boltSvg(x: number): string {
  const y = BELLY - 0.3
  return `<path d="M${x - 0.6} ${y} L${x + 1.4} ${y} L${x + 0.4} ${y + 4.5} L${x + 2} ${y + 4.3} L${x - 0.8} ${y + 11} L${x} ${y + 6} L${x - 1.6} ${y + 6.2} Z" fill="${INK.gold}"/>`
}
// Die Schirmkante: bis hier fällt der Regen über Clawd, dann springen die Tropfen ab.
const umbrellaAt = (x: number) => (x < 4 || x > 28 ? null : x < 7 || x > 25 ? 11 : x < 11 || x > 21 ? 10 : 9)
// Regenstriche unter der ganzen Wolke; auf dem Schirm springen die Tropfen ab. Je stärker, desto dichter.
function rainSvg(level: number, strength: number, tick: number, colors: SceneColors): string {
  const shape = cloudShape(level)
  const left = shape.center - shape.width / 2
  const gap = [4, 2.8, 2, 1.5][strength] ?? 4
  const length = [1.2, 2, 3, 4][strength] ?? 1.2
  const drops: string[] = []
  for (let x = left + 1.2, k = 0; x <= left + shape.width - 1; x += gap, k += 1) {
    const roof = umbrellaAt(x)
    const stop = roof ?? GROUND - 0.5
    const span = stop - BELLY
    const y = BELLY + 0.5 + ((tick * 3 + k * 7) % Math.max(1, Math.round(span)))
    if (y + 0.5 < stop) {
      drops.push(`<line x1="${x.toFixed(1)}" y1="${y}" x2="${(x - 0.4).toFixed(1)}" y2="${Math.min(y + length, stop).toFixed(1)}" stroke="${colors.suggestion}" stroke-opacity="0.8" stroke-width="0.6" stroke-linecap="round"/>`)
    } else if (roof !== null) {
      drops.push(`<circle cx="${(x + (k % 2 === 0 ? 0.6 : -0.6)).toFixed(1)}" cy="${(stop - 0.8).toFixed(1)}" r="0.4" fill="${colors.suggestion}" fill-opacity="0.8"/>`)
    }
  }

  return drops.join('')
}
// Die Pfütze liegt unter der Wolke und wächst mit ihr; Clawd steht mit den Füßen darin.
function cloudPuddleSvg(level: number, colors: SceneColors): string {
  if (level === 0) return ''
  const shape = cloudShape(level)
  return `<ellipse cx="${(shape.center + 2).toFixed(1)}" cy="${GROUND}" rx="${(shape.width * 0.45).toFixed(1)}" ry="${(0.8 + level * 0.12).toFixed(2)}" fill="${colors.suggestion}" fill-opacity="0.35"/>`
}

// Kühlturm: der Schlauch kommt von links zum Strahlrohr, der Strahl trifft die Front des
// Serverschranks (x 44 bis 54). Der glüht mit der Hitze, darüber flimmert die Luft; wo das
// Wasser auftrifft, dampft es. Rechts der Kühlwassertank, der mit den Tokens leer wird.
const NOZZLE = { x: 34, y: 17 }
const RACK = { x: 44, y: 9, width: 10 }
// Das Blech wird mit der Hitze erst warm, dann orange, dann rot; außen herum ein Glühen.
const RACK_FRAME = [INK.concrete, '#A98F7B', '#C9784A', '#DB5A3A', '#EF4430']
const GLOW = ['', INK.orange, INK.orange, INK.shine, INK.red]
function coolingSvg(scene: Scene, colors: SceneColors, isHere: boolean): string {
  const { water, strength, tick, level, stage, flicker } = scene
  const isOn = isHere && water !== null
  const wet = `fill="${colors.suggestion}"`
  const height = GROUND - RACK.y
  const glow = GLOW[stage] ?? ''
  const halo = glow === '' ? '' : `<rect x="${RACK.x - 1.5}" y="${RACK.y - 1.5}" width="${RACK.width + 3}" height="${height + 1.5}" rx="1.5" fill="${glow}" fill-opacity="${(0.06 + stage * 0.06).toFixed(2)}"/>`
  const ledColor = stage >= 3 ? INK.shine : stage === 2 ? INK.gold : INK.led
  const units = [10.5, 14.5, 18.5, 22.5].map((y, u) => {
    const leds = [0, 1].map(i => {
      const isLit = !isOn || (tick + i + u) % 3 !== 0
      return isLit ? px(RACK.x + 1.5 + i * 1.6, y + 1, 1, 1, ledColor) : ''
    })
    const vents = [0, 1, 2].map(i => px(RACK.x + 5 + i * 1.4, y + 0.7, 0.6, 1.8, INK.boot))
    return px(RACK.x + 1, y, RACK.width - 2, 3, INK.rack) + leds.join('') + vents.join('')
  })
  const rack =
    halo +
    crisp(
      [px(RACK.x, RACK.y, RACK.width, height, RACK_FRAME[stage] ?? INK.concrete), px(RACK.x, RACK.y, RACK.width, 1, stage === 0 ? INK.concreteTop : INK.gold, stage === 0 ? '' : ` fill-opacity="${(stage * 0.2).toFixed(1)}"`), ...units, px(RACK.x + 1, 26, 1, 1.5, INK.boot), px(RACK.x + RACK.width - 2, 26, 1, 1.5, INK.boot)].join(''),
    )
  // Hitzeflimmern: Wellenlinien steigen über dem Schrank auf.
  const shimmer =
    stage >= 2 && !isOn
      ? [0, 1, 2]
          .slice(0, stage - 1)
          .map(i => {
            const y = RACK.y - 1.5 - i * 1.8 - (flicker % 2) * 0.6
            return `<path d="M${RACK.x + 1.5} ${y.toFixed(1)} q 1 -0.8 2 0 t 2 0 t 2 0 t 2 0" fill="none" stroke="${glow}" stroke-opacity="${(0.7 - i * 0.18).toFixed(2)}" stroke-width="0.5"/>`
          })
          .join('')
      : ''
  // Der Tank: Wasser von voll bis leer, oben der Deckel.
  const tankHeight = 13
  const amount = tankHeight * (1 - Math.min(10, level) / 10)
  const tank =
    crisp(px(55.5, GROUND - tankHeight - 0.5, 4, tankHeight + 0.5, INK.concrete, ' fill-opacity="0.45"') + px(56.5, GROUND - tankHeight - 1.5, 2, 1, INK.concrete)) +
    (amount > 0 ? px(55.5, GROUND - amount, 4, amount, colors.suggestion, ' fill-opacity="0.8"') : '') +
    `<rect x="55.5" y="${GROUND - tankHeight - 0.5}" width="4" height="${tankHeight + 0.5}" fill="none" stroke="${INK.concreteTop}" stroke-width="0.4"/>`
  if (!isHere) return rack + shimmer + tank
  const hose = `<path d="M0 ${GROUND - 0.5} Q 3 ${GROUND - 0.5} 4.5 23 T 6 18" fill="none" stroke="${INK.hose}" stroke-width="2" stroke-linecap="round"/>`
  if (water === null) return rack + shimmer + tank + hose
  let arc = ''
  if (water.drop !== null) arc = `<circle cx="35" cy="${19 + water.drop * 2.5}" r="1.2" ${wet} fill-opacity="0.85"/>`
  if (water.isSplash && water.jet === 0) arc = splashSvg(35, GROUND - 1, colors)
  const hitY = strength === 3 ? 14 : 19
  if (water.jet > 0) {
    // Der Bogen: je stärker, desto höher; die Striche wandern mit dem Takt nach vorn.
    arc =
      `<path d="M${NOZZLE.x} ${NOZZLE.y} Q ${(NOZZLE.x + RACK.x) / 2} ${water.jet > 2 ? 9 : 13} ${RACK.x} ${hitY}" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.8" stroke-width="${water.jet}" stroke-linecap="round" stroke-dasharray="${water.jet > 2 ? '4 1.5' : '2.5 1.5'}" stroke-dashoffset="${-(tick % 4) * 1.4}"/>` +
      `<circle cx="${RACK.x - 1.5}" cy="${hitY + 2 + (tick % 2)}" r="0.6" ${wet}/><circle cx="${RACK.x - 0.8}" cy="${hitY + 4 - (tick % 2)}" r="0.5" ${wet}/>`
  }
  // Dampf: Wo Wasser auf heißes Blech trifft, steigen Wolken auf, mehr, je heißer.
  const steam =
    stage > 0 && water.jet > 0
      ? Array.from({ length: stage }, (_, i) => {
          const rise = (tick + i * 2) % 3
          return `<circle cx="${(RACK.x - 0.5 + i * 2.4 + rise * 0.5).toFixed(1)}" cy="${Math.max(6.8, hitY - 2.5 - rise * 1.8).toFixed(1)}" r="${(0.9 + rise * 0.35).toFixed(2)}" fill="#FFFFFF" fill-opacity="${(0.7 - rise * 0.12).toFixed(2)}"/>`
        }).join('')
      : ''

  return rack + tank + hose + arc + steam
}

// Durst: Clawd hebt die vordere Schere und hält die Flasche schräg an den Mund, Boden nach oben;
// beim Gluckern steigen Blasen zum Boden, ganz viel Tempo, und es tropft vom Mund. Daneben steht
// der Getränkekasten, in den nach und nach die leeren Flaschen kommen.
const MOUTH = { x: 18.5, y: 19.5 }
function bottleSvg(scene: Scene, colors: SceneColors): string {
  const { water, strength, tick } = scene
  const isOn = water !== null
  const bubbles = !isOn
    ? ''
    : Array.from({ length: 1 + Math.min(2, strength) }, (_, i) => {
        const along = 5 + ((tick + i * 3) % 6) * 1.2
        return `<circle cx="${along.toFixed(1)}" cy="${(i % 2 === 0 ? -0.6 : 0.5).toFixed(1)}" r="${0.45 + (i % 2) * 0.15}" fill="${INK.silver}" fill-opacity="0.9"/>`
      }).join('')
  // In der Flasche, Deckel am Mund bei 0, Boden bei 13; gedreht um den Mund.
  const body =
    `<rect x="3.5" y="-2" width="9.5" height="4" rx="0.9" fill="${INK.glass}" fill-opacity="0.6"/>` +
    `<rect x="3.5" y="-2" width="${isOn ? 6.5 : 8}" height="4" rx="0.9" fill="${colors.suggestion}" fill-opacity="0.9"/>` +
    `<path d="M3.6 -2 L1.6 -0.8 L1.6 0.8 L3.6 2 Z" fill="${INK.glass}" fill-opacity="0.85"/>` +
    `<rect x="0.4" y="-0.8" width="1.3" height="1.6" fill="${INK.glass}" fill-opacity="0.85"/>` +
    `<rect x="-0.4" y="-1" width="1" height="2" fill="${INK.siren}"/>` +
    `<rect x="9" y="-2" width="2" height="4" fill="${INK.siren}" fill-opacity="0.85"/>` +
    bubbles +
    `<path d="M1.6 -0.8 L3.6 -2 L12.1 -2 Q 13 -2 13 -1.1 L13 1.1 Q 13 2 12.1 2 L3.6 2 L1.6 0.8 Z" fill="none" stroke="${INK.glassEdge}" stroke-width="0.35"/>`
  // Die Schere greift die Flasche in der Mitte, der Arm kommt von der Schulter.
  const claw = crisp(px(24.5, 13.5, 4, 4, INK.clay))
  const dribble =
    isOn && strength === 3 ? `<ellipse cx="${MOUTH.x}" cy="${(MOUTH.y + 1.5 + (tick % 3) * 1.6).toFixed(1)}" rx="0.5" ry="0.7" fill="${colors.suggestion}"/>` : ''

  return `<g transform="translate(${MOUTH.x} ${MOUTH.y}) rotate(-28) scale(1 0.85)">${body}</g>` + claw + dribble
}
// Der Getränkekasten: zehn Fächer, je Stufe eine leere Flasche mehr; vorn verdeckt die rote
// Kastenwand die Bäuche, oben schauen Schultern, Hälse und blaue Deckel heraus.
const CRATE = { x: 35, width: 23.5, top: 21.5 }
function emptiesSvg(level: number): string {
  const bottles = Array.from({ length: Math.min(10, level) }, (_, i) => {
    const x = CRATE.x + 0.6 + i * 2.3
    return (
      `<rect x="${x}" y="17.6" width="1.8" height="9" rx="0.6" fill="${INK.glass}" fill-opacity="0.75" stroke="${INK.glassEdge}" stroke-width="0.25"/>` +
      px(x + 0.5, 15.8, 0.8, 2, INK.glass, ' fill-opacity="0.85"') +
      px(x + 0.4, 15.2, 1, 0.7, INK.siren)
    )
  }).join('')
  const crate = crisp(
    [
      px(CRATE.x, CRATE.top, CRATE.width, GROUND - CRATE.top, INK.red),
      px(CRATE.x, CRATE.top, CRATE.width, 0.8, INK.shine),
      px(CRATE.x + CRATE.width / 2 - 3, CRATE.top + 1.6, 6, 1.1, INK.brim),
      px(CRATE.x, GROUND - 1, CRATE.width, 1, INK.brim),
      ...[0.25, 0.75].map(f => px(CRATE.x + f * CRATE.width - 0.3, CRATE.top + 1, 0.6, 3.5, INK.brim)),
    ].join(''),
  )

  return bottles + crate
}

// See: Ufer aus Erde von x 33 bis 60, darüber das Wasser. Mit den Tokens schrumpft es zum
// Strohhalm hin, bis nur rissiger Boden bleibt; ab Stufe 8 zappelt ein Fisch im Trockenen.
// Der Strohhalm geht vom Mund hoch, über einen Knick hinab ins Wasser, die roten Streifen
// wandern beim Saugen zu Clawd; um die Spitze steigen Blasen.
const STRAW_TIP = { x: 40, y: 25.5 }
function lakeSvg(scene: Scene, colors: SceneColors, isHere: boolean): { back: string; front: string } {
  const { water, strength, tick, level } = scene
  const isOn = isHere && water !== null
  const share = 1 - Math.min(10, level) / 10
  const bed = `<ellipse cx="46.5" cy="${GROUND - 0.9}" rx="14" ry="3.1" fill="${INK.soil}" fill-opacity="0.75"/>`
  const rx = 13.5 * share
  const cx = 40 + 6.5 * share
  const ry = 0.8 + 2.1 * share
  // Wasser mit zwei Lichtstreifen, die sanft hin und her gleiten.
  const glints =
    share > 0.4
      ? [[-0.35, -0.3], [0.3, 0.25]]
          .map(([dx, dy], i) => px(cx + (dx ?? 0) * rx + ((tick + i) % 2) * 0.6, GROUND - 0.9 + (dy ?? 0) * ry * 2, 2.2, 0.35, INK.silver, ' fill-opacity="0.55"'))
          .join('')
      : ''
  const lake = share > 0 ? `<ellipse cx="${cx.toFixed(2)}" cy="${GROUND - 0.9}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="${colors.suggestion}" fill-opacity="0.65"/>` + glints : ''
  const shore = cx + rx
  const cracks =
    level >= 5
      ? [[44, 0], [48, 1], [52, 0], [56, 1], [59, 0]]
          .filter(([x]) => (x ?? 0) > shore + 0.5)
          .map(([x, k]) => `<path d="M${x} ${GROUND - 1.6 + (k ?? 0) * 0.5} l 0.8 0.6 l -0.5 0.6 l 0.9 0.5" fill="none" stroke="${INK.crack}" stroke-width="0.35"/>`)
          .join('')
      : ''
  const reeds = crisp([57, 58.3].map((x, i) => px(x, GROUND - 5 - i, 0.5, 4 + i, INK.leaf)).join('') + px(57.9, GROUND - 7, 0.9, 2, INK.soil))
  let fish = ''
  if (level >= 8) {
    const isUp = isOn && tick % 2 === 1
    const turn = isUp ? -25 : 8
    fish =
      `<g transform="translate(52 ${isUp ? GROUND - 3.6 : GROUND - 1.8}) rotate(${turn})">` +
      `<ellipse cx="0" cy="0" rx="2" ry="0.9" fill="${INK.fish}"/><path d="M1.8 0 L3.2 -0.9 L3.2 0.9 Z" fill="${INK.fish}"/><rect x="-1.2" y="-0.3" width="0.5" height="0.5" fill="${INK.ink}"/></g>`
  }
  const back = bed + lake + cracks + reeds + fish
  if (!isHere) return { back, front: '' }
  const flow = isOn ? -(tick * (strength >= 2 ? 1.6 : 0.8)) : 0
  const path = `M24.5 15.5 L28.5 9.5 Q 29.5 8 31 8 L37.8 8 Q 40 8 40 10 L${STRAW_TIP.x} ${STRAW_TIP.y}`
  const straw =
    `<path d="${path}" fill="none" stroke="${INK.flour}" stroke-width="1.1"/>` +
    `<path d="${path}" fill="none" stroke="${INK.red}" stroke-width="1.1" stroke-dasharray="1.2 1.2" stroke-dashoffset="${flow.toFixed(1)}"/>`
  const bubbles =
    isOn && share > 0
      ? Array.from({ length: 1 + strength }, (_, i) => {
          const rise = (tick + i * 2) % 4
          const x = STRAW_TIP.x + (i % 2 === 0 ? 1.4 : -1.3) + (i > 1 ? 1.2 : 0)
          return `<circle cx="${x.toFixed(1)}" cy="${(GROUND - 1.8 - rise * 0.9).toFixed(1)}" r="${(0.35 + rise * 0.1).toFixed(2)}" fill="none" stroke="${colors.suggestion}" stroke-width="0.35"/>`
        }).join('') +
        (strength >= 2 ? `<ellipse cx="${STRAW_TIP.x}" cy="${GROUND - 1.2}" rx="${(1.6 + (tick % 2) * 0.6).toFixed(1)}" ry="0.5" fill="none" stroke="${INK.silver}" stroke-opacity="0.6" stroke-width="0.35"/>` : '')
      : ''

  return { back, front: straw + bubbles }
}

// Ruderboot und Lastenrad für die Anfahrt.
// Das Ruderboot: Holzrumpf mit Rand und Planken, halb im Wasser, das Ruder zieht im Takt,
// vorn die Bugwelle. Das Wasser fährt mit, damit es nicht übers Gras rudert.
function rowboatPx(t: number, colors: SceneColors): string {
  const isPulling = t % 2 === 0
  const oar = isPulling ? { x: 1, y: 27 } : { x: -1, y: 20 }
  const wet = `fill="${colors.suggestion}"`
  return (
    `<path d="M1 18.5 L31 17 L27 26 L4 26 Z" fill="${INK.wood}"/>` +
    crisp([px(1, 18, 29, 1.2, INK.crust), px(3, 21.5, 25, 0.4, INK.soil), px(4, 23.5, 23, 0.4, INK.soil), px(10, 16.5, 1.5, 2, INK.boot)].join('')) +
    `<path d="M10.5 17.5 L${oar.x} ${oar.y}" stroke="${INK.crust}" stroke-width="1"/>` +
    `<ellipse cx="${oar.x}" cy="${oar.y}" rx="0.9" ry="1.6" transform="rotate(40 ${oar.x} ${oar.y})" fill="${INK.crust}"/>` +
    `<rect x="-4" y="24.5" width="38" height="3.5" ${wet} fill-opacity="0.55"/>` +
    [3, 12, 21].map(x => `<rect x="${x + (t % 2) * 2}" y="25.5" width="3" height="0.5" fill="${INK.silver}" fill-opacity="0.6"/>`).join('') +
    `<path d="M29 24.5 Q 31 ${isPulling ? 22.5 : 23} 33 24.5" fill="none" stroke="${INK.silver}" stroke-opacity="0.7" stroke-width="0.6"/>` +
    (isPulling ? `<circle cx="0" cy="24" r="0.6" ${wet}/><circle cx="2.5" cy="23.3" r="0.5" ${wet}/>` : '')
  )
}
// Lastenrad: großes Hinterrad, Sattel und Lenker, die Kurbel dreht sich, vorn über dem kleinen
// Rad die rote Kiste mit blauen Wasserflaschen.
function bikePx(t: number): string {
  const turn = ((t % 4) * Math.PI) / 2
  const pedal = { x: 12 + 2.2 * Math.cos(turn), y: 24 + 2.2 * Math.sin(turn) }
  const spoke = (cx: number, cy: number, r: number) => {
    const a = ((t % 4) * Math.PI) / 4
    const dx = r * Math.cos(a)
    const dy = r * Math.sin(a)
    return `<path d="M${(cx - dx).toFixed(2)} ${(cy - dy).toFixed(2)} L${(cx + dx).toFixed(2)} ${(cy + dy).toFixed(2)}" stroke="${INK.concreteTop}" stroke-width="0.4"/>`
  }
  const bottles = [22.5, 25.2, 27.9].map(x => px(x, 14.5, 1.8, 4, INK.glass) + px(x + 0.3, 13.5, 1.2, 1, INK.siren)).join('')
  return (
    `<path d="M6 24 L12 24 L10 16.5 M10.5 17.5 L18 17.5 M12 24 L29 24 M18 15 L18 24" fill="none" stroke="${INK.concrete}" stroke-width="0.9"/>` +
    crisp(
      [
        bottles,
        px(8.5, 15.5, 3.5, 1, INK.boot),
        px(16.5, 14.5, 3, 1, INK.boot),
        px(21, 17.5, 10, 6.5, INK.red),
        px(21, 17.5, 10, 0.8, INK.brim),
        px(22.5, 19.5, 7, 0.6, INK.brim),
        px(22.5, 21.5, 7, 0.6, INK.brim),
      ].join(''),
    ) +
    `<path d="M12 24 L${pedal.x.toFixed(2)} ${pedal.y.toFixed(2)}" stroke="${INK.boot}" stroke-width="0.7"/>` +
    px(pedal.x - 0.8, pedal.y - 0.3, 1.6, 0.6, INK.boot) +
    [
      [6, 24.3, 3.2],
      [29, 25.3, 2.2],
    ]
      .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK.concrete}" stroke-width="1.1"/>` + spoke(cx ?? 0, cy ?? 0, (r ?? 1) - 0.5))
      .join('')
  )
}

export function sceneSvg(scene: Scene, colors: SceneColors): string {
  const { role, water, tick, level, arrival } = scene
  const isHere = arrival < 0
  const back: string[] = []
  const front: string[] = []

  // Hinten und vorn die Szene, dazwischen Clawd.
  if (role === 'tap') {
    const hasBucket = arrival < 0 || arrival >= ARRIVE.in
    const drawn = tapSvg({ ...scene, water: isHere ? water : null }, colors, hasBucket)
    back.push(drawn.back)
    front.push(drawn.front)
  } else if (role === 'cloud') {
    back.push(cloudPuddleSvg(level, colors))
    const share = isHere ? 1 : arrival < ARRIVE.in ? 0 : (arrival - ARRIVE.in + 1) / ARRIVE.hold
    if (isHere && water !== null) front.push(rainSvg(level, scene.strength, tick, colors))
    front.push(cloudSvg({ ...scene, water: isHere ? water : null }, share, colors))
  } else if (role === 'cooling') {
    front.push(coolingSvg(scene, colors, isHere))
  } else if (role === 'thirst') {
    front.push(emptiesSvg(level))
    if (isHere) front.push(bottleSvg(scene, colors))
  } else {
    const drawn = lakeSvg(scene, colors, isHere)
    back.push(drawn.back)
    front.push(drawn.front)
  }

  // Die Anfahrt: das Fahrzeug fährt bis an Clawds Platz, er springt heraus, es wendet und fährt
  // nach links wieder weg, damit es nie durch die Szene rollt. Zu Fuß läuft er von links herein,
  // als Klempner mit dem Eimer in der Schere.
  let clawd = ''
  const isGulping = role === 'thirst' && isHere && water !== null && tick % 3 !== 2
  if (arrival >= 0 && !isWalking(role)) {
    const shift = arrivalShift(arrival)
    const roll = rollOf(arrival)
    const vehicle = role === 'thirst' ? bikePx(roll) : role === 'lake' ? rowboatPx(roll, colors) : truckPx(arrival, roll)
    const turn = shift > 0 ? `translate(${(VEHICLE_WIDTH - shift * 44).toFixed(1)} 0) scale(-1 1)` : `translate(${(shift * 40).toFixed(1)} 0)`
    back.push(`<g transform="${turn}">${vehicle}</g>`)
    if (arrival > ARRIVE.in) {
      const hop = arrival === ARRIVE.in + 1 ? -3 : arrival === ARRIVE.in + 2 ? -1 : 0
      clawd = `<g transform="translate(0 ${hop})">${clawdPx(role, 0)}</g>`
    }
  } else if (arrival >= 0) {
    const walked = Math.min(1, arrival / ARRIVE.in)
    const pail = role === 'tap' && arrival < ARRIVE.in ? carriedPail : ''
    clawd = `<g transform="translate(${(-32 * (1 - walked)).toFixed(1)} 0)">${clawdPx(role, walked < 1 ? arrival : 0)}${pail}</g>`
  } else {
    clawd = clawdPx(role, 0, isGulping, role === 'thirst')
  }
  const { x, y, width, height } = SCENE_VIEW

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}">${back.join('')}${clawd}${front.join('')}</svg>`
}

export function sceneAlt(scene: Scene): string {
  const { role, water, arrival, stage, level } = scene
  if (arrival >= 0) {
    const arriving: Record<Role, string> = {
      tap: 'plumber Clawd walking in with a bucket',
      cloud: 'Clawd walking in under an umbrella',
      cooling: 'fire truck arriving',
      thirst: 'cargo bike with water arriving',
      lake: 'rowboat arriving',
    }
    return arriving[role]
  }
  const isOn = water !== null
  if (role === 'tap') {
    if (isOn) return scene.strength >= 2 ? 'plumber Clawd, the tap is running' : 'plumber Clawd, the tap is dripping'
    return level >= 6 ? 'plumber Clawd next to the tap, the bucket overflows' : 'plumber Clawd next to the tap'
  }
  if (role === 'cooling') {
    if (isOn) return stage > 0 ? 'firefighter Clawd cooling the hot server, it steams' : 'firefighter Clawd cooling the server'
    return stage > 0 ? 'firefighter Clawd next to the hot server' : 'firefighter Clawd next to the server, hose closed'
  }
  if (role === 'thirst') return isOn ? 'Clawd gulping from a water bottle' : 'Clawd with a water bottle'
  if (role === 'lake') {
    if (level >= 10) return 'Clawd with a straw at the dried-up lake'
    return isOn ? 'Clawd slurping the lake through a straw' : 'Clawd with a straw at the lake'
  }

  return isOn ? 'Clawd under an umbrella in the rain' : 'Clawd under an umbrella, cloudy'
}
