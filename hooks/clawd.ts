// Clawd neben dem Preis. Pro Sitzung wird eine Rolle ausgelost; in jeder steht das Tempo
// für die Tokens pro Sekunde (nur solange gestreamt wird) und die Größe für die Sitzung. Zu
// Beginn und nach einer langen Pause kommt er erst an. Das Thema: KI verschwendet Wasser, jede
// Antwort kostet ein paar Schlucke; unter jeder Szene stehen die Liter.
//   Hahn:    Clawd dreht auf und scrollt am Handy, das Wasser läuft in den Abfluss. Je mehr Liter,
//            desto bequemer: Hocker, Liegestuhl, Sonnenschirm mit Drink.
//   Dusche:  Clawd singt unter der Dauerdusche, der Dampf wird mit der Sitzung dichter.
//   Pool:    Clawd füllt mit Sonnenbrille den Pool, am Ende läuft er über und eine Ente schwimmt.
//   Wanne:   Clawd liegt in der Badewanne, der Schaum türmt sich, am Ende schwappt sie über.
//   See:     Clawd schlürft mit dem Strohhalm einen See leer, am Ende zappelt ein Fisch im Trockenen.

export type Color = 'claude' | 'error' | 'warning' | 'suggestion' | 'inactive' | 'success'
export type Piece = { text: string; color?: Color; dim?: boolean }

export const ROLES = ['tap', 'shower', 'pool', 'bath', 'lake'] as const
export type Role = (typeof ROLES)[number]
// Für /clawd: englisch wie die Leiste, die deutschen Wörter gehen auch.
export const ROLE_WORDS: Record<Role, string[]> = {
  tap: ['tap', 'hahn', 'wasserhahn', 'abfluss', 'drain', 'handy', 'phone'],
  shower: ['shower', 'dusche', 'duschen', 'brause', 'singen', 'sing'],
  pool: ['pool', 'schwimmbad', 'planschbecken', 'gartenschlauch', 'hose'],
  bath: ['bath', 'badewanne', 'wanne', 'bad', 'schaum', 'foam'],
  lake: ['lake', 'see', 'strohhalm', 'straw', 'schlürfen', 'schluerfen'],
}
// Alle kommen zu Fuß, nur zum See rudert Clawd.
const isWalking = (role: Role) => role !== 'lake'

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

// Ab diesen Tokens der Sitzung eine Stufe größer (Dampf, Pool, Schaum, See), bis Stufe 10.
const SIZE_AT = [1, 50_000, 250_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000]
export const sizeLevel = (n: number) => SIZE_AT.filter(at => n >= at).length

// Die Anfahrt in Takten: hinfahren, halten (Clawd steigt aus), wegfahren. Zu Fuß ohne Wegfahren,
// dafür dreht er in den Haltetakten auf.
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
  // Takt der Anfahrt, -1 ist angekommen
  arrival: number
  // Die verschwendeten Liter, wie sie unter der Szene stehen
  liters?: string
}

// Wasser je ausgegebenem Token nach Mistrals Ökobilanz (2025): 45 ml für eine Antwort mit 400 Tokens.
export const ML_PER_TOKEN = 45 / 400
// „≈ 340 ml“, ab einem Liter „≈ 1,4 L“, ab 100 L ohne Nachkomma; nichts, solange nichts lief.
export function literText(ml: number): string {
  if (ml < 0.5) return ''
  if (ml < 1_000) return `≈ ${Math.round(ml)} ml`
  const liters = ml / 1_000
  const shown = liters < 100 ? liters.toFixed(1).replace('.', ',') : Math.round(liters).toLocaleString('de-DE')

  return `≈ ${shown} L`
}
// Am Hahn zählt die Größe in Litern der Sitzung: 1 sobald etwas lief, dann je eine Stufe bequemer
// ab 1, 5 und 20 L (Hocker, Liegestuhl, Sonnenschirm mit Drink).
const COMFORT_AT = [1_000, 5_000, 20_000]
export const tapLevel = (ml: number) => (ml < 0.5 ? 0 : 1 + COMFORT_AT.filter(at => ml >= at).length)
const comfortOf = (level: number) => Math.max(0, Math.min(3, level - 1))

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

// Alle Kopfbedeckungen sitzen mittig über Clawd (Spalten 0 bis 6, Mitte 3,5); nur Hahn und
// Rohre reichen in die Spalten 7 und 8.
// Die Beine wie im Clawd-Logo: vorne links, hinten rechts angesetzt, also mittig unter ihm.
export const LEGS: Piece[] = [{ text: ' ▘▘ ▝▝   ', color: 'claude' }]
// Beim Gehen im Wechsel ein Bein vor.
const STEP: Piece[] = [{ text: ' ▝▘ ▘▝   ', color: 'claude' }]
const CLAWD: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '  ' }]
// Der Hahn mit rotem Hebel: aufgedreht steht er hoch, zu liegt er flach.
const TAP: Piece[] = [{ text: '┓', color: 'inactive' }]
const TAP_OPEN: Piece[] = [{ text: '┻', color: 'error' }]
const TAP_SHUT: Piece[] = [{ text: '━', color: 'error' }]
// Der Sonnenschirm ab 20 L, rot und weiß gestreift.
const PARASOL: Piece[] = [
  { text: '▗▄', color: 'error' },
  { text: '▆', color: 'inactive' },
  { text: '█', color: 'error' },
  { text: '▆', color: 'inactive' },
  { text: '▄▖', color: 'error' },
]
// Strohhut für den Strohhalm: flache Krone, breite Krempe.
const STRAW_HAT: Piece[] = [{ text: '▁▂▅▅▅▂▁▁ ', color: 'warning' }]
// Rosa Duschhaube mit Rüschen; am Pool eine Sonnenbrille statt Augen.
const SHOWER_CAP: Piece[] = [{ text: '▗▄▆▆▆▄▖', color: 'error' }]
const SHADES: Piece[] = [{ text: '▐', color: 'claude' }, { text: '▀▀', color: 'inactive' }, { text: '█', color: 'claude' }, { text: '▀▀', color: 'inactive' }, { text: '▌', color: 'claude' }]
// Das Ruderboot auf dem Wasser: Holzrand über dem Rumpf, das Ruder zieht im Takt durchs Wasser,
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
// Was Clawd beim Herlaufen trägt: das Handy, ein Handtuch, den aufgerollten Schlauch.
const CARRIED: Record<Role, Piece> = {
  tap: { text: '▮', color: 'suggestion' },
  shower: { text: '▬', color: 'error' },
  pool: { text: '◎', color: 'success' },
  bath: { text: '▬', color: 'error' },
  lake: { text: ' ' },
}

// Der Gartenschlauch spritzt nach rechts im Bogen, wie FLOWS ihn vorgibt.
const spray = (water: Flow | null): Cell[] =>
  water === null ? [] : cellsOf([{ text: water.cell, color: 'suggestion' }])
const splashAt = (water: Flow | null) => (water !== null && water.isSplash ? water.land : null)

// Die Pfütze neben der Wanne beginnt an ihrem Rand und wächst nach rechts, zur Mitte hin tiefer
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

// Hahn: der Hahn hängt in der Leiste über dem Becken (Spalten 7 bis 9), das Wasser fällt in
// Spalte 8 in den Abfluss und ist weg. Clawd hält das Handy in Spalte 7 und sieht nicht hin. Mit
// den Litern wird er bequemer: auf dem Hocker, im Liegestuhl, dann unterm Sonnenschirm mit Drink.
const SEATS = [
  [{ text: ' ▘▘ ▝▝ ', color: 'claude' }],
  [{ text: ' ╤═══╤ ', color: 'warning' }],
  [{ text: '╲', color: 'inactive' }, { text: '▚▚▚▚▚', color: 'warning' }, { text: '╱', color: 'inactive' }],
] satisfies Piece[][]
export const isTapOpen = (arrival: number) => arrival < 0 || arrival > ARRIVE.in
function tapParts(scene: Scene): Parts {
  const { water, strength, tick, level, arrival } = scene
  const comfort = comfortOf(level)
  const head = [...(comfort === 3 ? cellsOf(PARASOL) : blank(7)), ...cellsOf(isTapOpen(arrival) ? TAP_OPEN : TAP_SHUT), ...cellsOf(TAP)]
  // Das Handy leuchtet; beim Scrollen flackert es ab und zu.
  const top: Cell[] = [...cellsOf([{ text: '▐▛███▜▌', color: 'claude' }]), { ch: '▮', color: 'suggestion', dim: tick % 5 === 4 }, BLANK]
  const low: Cell[] = cellsOf(SEATS[Math.min(2, comfort)] ?? [])
  const right: Cell[] = []
  if (comfort === 3) put(right, 2, { ch: '▿', color: 'warning' })
  let drain: Cell = level === 0 ? { ch: '▁', color: 'inactive', dim: true } : { ch: '▁', color: 'suggestion', dim: true }
  if (water !== null) {
    if (strength <= 1) {
      if (water.drop !== null) top[8] = { ch: water.cell, color: 'suggestion' }
      if (water.isSplash) drain = { ch: ',', color: 'suggestion' }
    } else {
      // Läuft und sprudelt: ein Strahl, dessen Striche wandern; im Abfluss strudelt es.
      top[8] = { ch: strength === 3 ? (tick % 2 === 0 ? '┃' : '╏') : tick % 2 === 0 ? '│' : '╎', color: 'suggestion' }
      drain = { ch: tick % 2 === 0 ? '◌' : '○', color: 'suggestion' }
      if (strength === 3) put(right, 1, { ch: tick % 2 === 0 ? '˙' : '·', color: 'suggestion' })
    }
  }
  low.push({ ch: '╲', color: 'inactive' }, drain)

  return { head, slots: [top, low], rights: [right, [{ ch: '╱', color: 'inactive' }]] }
}

// Wasser, das senkrecht fällt, in Spalte `col` zweier Zeilen: Tropfen einzeln, der Strahl als
// wandernde Striche, wie am Hahn.
function falling(water: Flow | null, strength: number, tick: number, rows: Cell[][], col: number) {
  if (water === null) return
  if (strength <= 1) {
    if (water.drop !== null) put(rows[water.drop === 2 ? 1 : 0] ?? [], col, { ch: water.cell, color: 'suggestion' })
    return
  }
  const ch = strength === 3 ? (tick % 2 === 0 ? '┃' : '╏') : tick % 2 === 0 ? '│' : '╎'
  for (const row of rows) put(row, col, { ch, color: 'suggestion' })
}

// Dusche: die Haube auf Clawds Kopf, daneben der Brausekopf am Rohr (Spalten 7 und 8); das Wasser
// prasselt in Spalte 7 neben ihm herab. Solange es läuft, singt er, die Noten steigen rechts auf.
// Der Dampf wächst mit der Sitzung, erst unten, dann auch oben.
function showerParts(scene: Scene): Parts {
  const { water, strength, tick, level } = scene
  const head = [...cellsOf(SHOWER_CAP), { ch: '┳', color: 'inactive' }, { ch: '┓', color: 'inactive' }] satisfies Cell[]
  const top = cellsOf(CLAWD)
  const low = cellsOf(LEGS)
  top[8] = { ch: '┃', color: 'inactive' }
  low[8] = { ch: '┃', color: 'inactive' }
  falling(water, strength, tick, [top, low], 7)
  if (water !== null && water.isSplash) low[7] = { ch: ',', color: 'suggestion' }
  const steam = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => ({ ch: (i + tick) % 3 === 0 ? '▒' : '░', color: 'inactive', dim: true }) satisfies Cell)
  const rights = [steam(level - 3), steam(level)]
  if (water !== null) put(rights[0] ?? [], 1 + (tick % 2), { ch: tick % 4 < 2 ? '♪' : '♫', color: 'warning' })

  return { head, slots: [top, low], rights }
}

// Pool: Clawd mit Sonnenbrille, der grüne Schlauch mit Messingdüse in Spalte 7 und 8. Der Strahl
// fliegt im Bogen in den Pool rechts, der sich mit der Sitzung füllt; ab Stufe 6 schwimmt eine
// Ente, ab Stufe 9 läuft er über.
const POOL = 10
const POOL_FILL = ['▁', '▁', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '█']
function poolParts(scene: Scene): Parts {
  const { water, tick, level } = scene
  const top = cellsOf([...SHADES, { text: '━', color: 'success' }, { text: '╾', color: 'warning' }])
  const low = cellsOf(LEGS)
  low[8] = { ch: '▕', color: 'inactive' }
  const fill = POOL_FILL[Math.min(10, level)] ?? '▁'
  const pool: Cell[] = Array.from({ length: POOL }, () => (level === 0 ? { ch: '▁', color: 'inactive', dim: true } : { ch: fill, color: 'suggestion', dim: true }))
  const hit = splashAt(water)
  if (hit !== null && hit < POOL) pool[hit] = { ch: level <= 1 ? ',' : level >= 9 ? '˙' : (POOL_FILL[Math.min(10, level + 2)] ?? '▃'), color: 'suggestion' }
  if (level >= 6) pool[7] = { ch: '◗', color: 'warning' }
  pool.push({ ch: '▏', color: 'inactive' })
  if (level >= 9) pool.push({ ch: water !== null && tick % 2 === 0 ? ',' : '▁', color: 'suggestion', dim: true }, { ch: '▁', color: 'suggestion', dim: true })

  return { head: blank(SLOT), slots: [top, low], rights: [spray(water), pool] }
}

// Wanne: Clawd sitzt bis zum Hals in der Wanne (Spalten 0 bis 8), rechts läuft der Hahn wie beim
// Hahn hinein. Der Schaum türmt sich mit der Sitzung rechts und über ihm, ab Stufe 8 schwappt sie
// über und daneben wächst die Pfütze.
const FOAM = '°o○o°○'
function bathParts(scene: Scene): Parts {
  const { water, strength, tick, level, arrival } = scene
  const bubble = (i: number): Cell => ({ ch: FOAM[(i + tick) % FOAM.length] ?? 'o', color: 'inactive' })
  const head: Cell[] = [...blank(7), ...cellsOf(isTapOpen(arrival) ? TAP_OPEN : TAP_SHUT), ...cellsOf(TAP)]
  for (let i = 0; i < Math.max(0, level - 6); i += 1) head[[1, 5, 3, 0][i] ?? 0] = bubble(i)
  const top = cellsOf(CLAWD)
  const low = cellsOf([{ text: '▙▄▄▄▄▄▄▄▟', color: 'inactive' }])
  falling(water, strength, tick, [top, []], 8)
  if (water !== null && strength >= 2) top[7] = { ch: tick % 2 === 0 ? '˙' : ' ', color: 'suggestion' }
  const right: Cell[] = []
  for (let i = 0; i < Math.min(6, level); i += 1) put(right, i, bubble(i))
  const spill = level >= 8 ? puddle(level - 7, water !== null && water.isSplash ? 0 : null) : ''

  return { head, slots: [top, low], rights: [right, cellsOf([{ text: spill, color: 'suggestion', dim: true }])] }
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
  if (scene.role === 'shower') return showerParts(scene)
  if (scene.role === 'pool') return poolParts(scene)
  if (scene.role === 'bath') return bathParts(scene)

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
      // Zu Fuß: Clawd läuft von links an seinen Platz und trägt, was er braucht. Hahn, Rohre und
      // Becken (grau) warten schon in den Spalten 7 und 8; aufgedreht wird erst, wenn er da ist.
      const walked = Math.min(1, arrival / ARRIVE.in)
      const at = Math.round(-(room + SLOT) * (1 - walked))
      if (arrival < ARRIVE.in) {
        const walking = [cellsOf([...CLAWD.slice(0, 1), CARRIED[role]]), cellsOf(arrival % 2 === 0 ? LEGS : STEP)]
        const fixtures = slots.map(slot => [...blank(7), ...slot.slice(7).map(cell => (cell.color === 'inactive' ? cell : BLANK))])
        overlay(walking, at, fixtures)
        headCells = [...blank(7), ...headCells.slice(7)]
      }
    } else {
      // Mit dem Boot: von links bis vor Clawds Platz, kurz halten, dann nach links wieder weg,
      // statt durch die Szene zu fahren. Ab dem zweiten Haltetakt ist Clawd ausgestiegen.
      const vehicle = rowboat(rollOf(arrival))
      const shift = arrivalShift(arrival)
      const at = Math.round((shift < 0 ? shift : -shift) * (room + SLOT))
      const isOut = arrival > ARRIVE.in
      overlay(vehicle.map(cellsOf), at, isOut ? slots : [hidden, hidden])
      if (!isOut) headCells = hidden
    }
  }

  // Die Liter stehen rechtsbündig unter dem Zähler, wenn die Szene ihnen Platz lässt.
  const liters = scene.liters ?? ''
  const floor = rights[1] ?? []
  const used = floor.findLastIndex(cell => cell.ch !== ' ') + 1
  if (liters !== '' && used + 1 + liters.length <= reach) {
    rights = [rights[0] ?? [], [...floor.slice(0, used), ...blank(reach - used - liters.length), ...cellsOf([{ text: liters, color: 'suggestion', dim: true }])]]
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
// In der Leiste der Apps steht die Szene in Texthöhe, ein Drittel kleiner als ihr viewBox.
export const APP_SCENE = { width: 40, height: 18 }
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

// Clawd selbst, im Kostüm seiner Rolle; `step` hebt beim Gehen jedes zweite Bein, `isSinging`
// kneift unter der Dusche die Augen zu, `isSitting` lässt in der Wanne die Beine weg.
const CAP_PINK = '#F2A7C3'
const TOWEL = '#F4F1EA'
function clawdPx(role: Role, step: number, isSinging = false, isSitting = false): string {
  const legs = [8, 12, 18, 22]
  const parts = [
    px(4, 15, 4, 4, INK.clay),
    px(8, 12, 16, 10, INK.clay),
    px(24, 15, 4, 4, INK.clay),
    isSinging ? px(10, 15, 2, 1, INK.ink) + px(20, 15, 2, 1, INK.ink) : px(10, 14, 2, 2, INK.ink) + px(20, 14, 2, 2, INK.ink),
    ...(isSitting ? [] : legs.map((x, i) => px(x, 22 - (step % 2 === 1 && i % 2 === 1 ? 1 : 0), 2, 4, INK.clay))),
  ]
  if (role === 'shower') {
    // Rosa Duschhaube mit weißen Tupfen und Rüschenrand
    parts.push(
      px(11, 8, 10, 1, CAP_PINK),
      px(9, 9, 14, 3, CAP_PINK),
      px(8, 11.5, 16, 1, '#E58BAE'),
      px(12, 9.5, 1, 1, TOWEL),
      px(16, 9, 1, 1, TOWEL),
      px(20, 10, 1, 1, TOWEL),
    )
  } else if (role === 'pool') {
    // Sonnenbrille, Düse in der vorderen Schere
    parts.push(
      px(9, 13.5, 5, 2.5, INK.ink),
      px(18, 13.5, 5, 2.5, INK.ink),
      px(14, 14, 4, 0.8, INK.ink),
      px(10, 14, 1.5, 0.6, INK.silver),
      px(19, 14, 1.5, 0.6, INK.silver),
      px(27, 16, 1, 2, INK.leaf),
      px(28, 16, 4, 2, INK.brass),
      px(32, 16.5, 2, 1, INK.tip),
    )
  } else if (role === 'lake') {
    // Strohhut mit grünem Band
    parts.push(
      px(11, 6, 10, 1, INK.straw),
      px(10, 7, 12, 3, INK.straw),
      px(10, 9, 12, 1, INK.leaf),
      px(4, 10, 24, 1, INK.strawDark),
      px(5, 11, 22, 1, INK.straw),
    )
  }

  return crisp(parts.join(''))
}
// Was Clawd herbeiträgt: ein Handtuch über der Schulter oder den aufgerollten Gartenschlauch.
const towelPx = crisp(px(5, 11.5, 6, 1.2, TOWEL) + px(5, 12.7, 2, 6, TOWEL) + px(5, 16, 2, 0.6, INK.red))
const coilPx = [2.4, 1.3].map(r => `<circle cx="30" cy="18" r="${r}" fill="none" stroke="${INK.leaf}" stroke-width="0.9"/>`).join('')

const splashSvg = (x: number, y: number, colors: SceneColors) =>
  `<ellipse cx="${x}" cy="${y}" rx="2.5" ry="0.9" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.6" stroke-width="0.7"/><circle cx="${x - 1.5}" cy="${y - 2}" r="0.6" fill="${colors.suggestion}" fill-opacity="0.7"/><circle cx="${x + 1.5}" cy="${y - 2.5}" r="0.6" fill="${colors.suggestion}" fill-opacity="0.7"/>`

// Hahn: ein Waschbecken auf dem Standfuß, der Hahn mit rotem Hebel hinten rechts, der Auslauf
// über dem Abfluss. Aufgefangen wird nichts: das Wasser gurgelt weg, beim Strahl strudelt es.
const SPOUT = { x: 47.2, y: 13.6 }
const DRAIN = { x: 47, y: 20.4 }
function sinkSvg(scene: Scene, colors: SceneColors, isOpen: boolean): string {
  const { water, strength, tick, level } = scene
  const wet = `fill="${colors.suggestion}"`
  const lever = isOpen
    ? `<path d="M52.5 10 L55.5 7.3" stroke="${INK.red}" stroke-width="1.3" stroke-linecap="round"/>`
    : `<path d="M52.5 10 L56.5 10" stroke="${INK.red}" stroke-width="1.3" stroke-linecap="round"/>`
  const sink =
    crisp(
      [
        px(45, 21.5, 4, GROUND - 21.5, INK.concrete),
        px(43.5, GROUND - 0.8, 7, 0.8, INK.concreteTop),
        px(51.5, 10, 2, 8, INK.concrete),
        px(46.4, 10, 7.1, 1.6, INK.concreteTop),
        px(46.4, 11.6, 1.6, 2, INK.concreteTop),
      ].join(''),
    ) +
    lever +
    `<path d="M37 18.6 L57 18.6 Q 56 23 47 23 Q 38 23 37 18.6 Z" fill="${INK.silver}"/>` +
    `<path d="M38.6 19.6 L55.4 19.6 Q 54.4 21.8 47 21.8 Q 39.6 21.8 38.6 19.6 Z" fill="${INK.concreteTop}"${level > 0 ? '' : ' fill-opacity="0.6"'}/>` +
    crisp(px(36.6, 17.8, 20.8, 1, INK.flourDark)) +
    `<ellipse cx="${DRAIN.x}" cy="${DRAIN.y}" rx="1.5" ry="0.45" fill="${INK.boot}"/>`
  let stream = ''
  if (water !== null) {
    if (water.drop !== null) {
      const y = SPOUT.y + 1 + ((DRAIN.y - SPOUT.y - 2) * water.drop) / 2
      stream = `<ellipse cx="${SPOUT.x}" cy="${y.toFixed(1)}" rx="0.9" ry="1.2" ${wet} fill-opacity="0.9"/>`
    } else if (water.isSplash && water.jet === 0) {
      stream = splashSvg(SPOUT.x, DRAIN.y, colors)
    }
    if (water.jet > 0) {
      const width = strength === 3 ? 2 : 1.1
      stream =
        `<path d="M${SPOUT.x} ${SPOUT.y} L${SPOUT.x} ${DRAIN.y}" stroke="${colors.suggestion}" stroke-opacity="0.85" stroke-width="${width}" stroke-dasharray="${strength === 3 ? '3 0.8' : '2 1.2'}" stroke-dashoffset="${-(tick % 4) * 0.9}"/>` +
        // Der Strudel im Abfluss dreht sich mit dem Takt, beim Sprudeln weiter außen ein zweiter Ring.
        [3, ...(strength === 3 ? [5.5] : [])]
          .map(
            (r, i) =>
              `<ellipse cx="${DRAIN.x}" cy="${DRAIN.y}" rx="${r}" ry="${(r * 0.28).toFixed(2)}" fill="none" stroke="${colors.suggestion}" stroke-opacity="${0.75 - i * 0.25}" stroke-width="0.6" stroke-dasharray="2.2 1.4" stroke-dashoffset="${((tick + i) % 4) * (i === 0 ? 0.9 : -0.9)}"/>`,
          )
          .join('')
      if (strength === 3) {
        const up = tick % 2 === 0 ? 0 : 1.2
        stream += [[-3, -2.5], [3, -2], [-1.5, -4]]
          .map(([dx, dy]) => `<circle cx="${DRAIN.x + (dx ?? 0)}" cy="${(DRAIN.y + (dy ?? 0) - up).toFixed(1)}" r="0.5" ${wet} fill-opacity="0.85"/>`)
          .join('')
      }
    }
  }

  return sink + stream
}

// Clawd am Hahn: das Handy in der vorderen Schere, der Blick gesenkt. `comfort` 0 steht er,
// 1 sitzt er auf dem Hocker, 2 liegt er im Liegestuhl, 3 dazu unterm Sonnenschirm mit Drink.
const SCREEN = '#9FD8FF'
function idlerPx(comfort: number, step: number, tick: number): string {
  const lift = (i: number) => (step % 2 === 1 && i % 2 === 1 ? 1 : 0)
  // Stehend vier Beine, auf dem Hocker baumeln zwei, im Liegestuhl sind sie angezogen.
  const legs =
    comfort === 0
      ? [8, 12, 18, 22].map((x, i) => px(x, 22 - lift(i), 2, 4, INK.clay))
      : comfort === 1
        ? [px(10, 22, 2, 2.5, INK.clay), px(20, 22, 2, 2.5, INK.clay)]
        : []
  const body = crisp(
    [
      px(4, 15, 4, 4, INK.clay),
      px(8, 12, 16, 10, INK.clay),
      px(24, 15, 2, 3, INK.clay),
      px(11, 15, 2, 1.2, INK.ink),
      px(19, 15, 2, 1.2, INK.ink),
      ...legs,
      // Das Handy: dunkle Hülle, das Display leuchtet, eine Zeile scrollt durch.
      px(25.6, 12, 2.8, 4.6, INK.boot),
      px(26, 12.5, 2, 3.6, SCREEN),
      px(26, 12.6 + (tick % 4) * 0.8, 2, 0.4, '#FFFFFF', ' fill-opacity="0.8"'),
    ].join(''),
  )
  if (comfort === 0) return body
  if (comfort === 1) {
    // Holzhocker, Clawd sitzt eine Spur tiefer darauf.
    return (
      `<g transform="translate(0 2)">${body}</g>` +
      crisp(px(6, 24.6, 20, 1.4, INK.wood) + px(7.5, 26, 1.4, GROUND - 26, INK.crust) + px(23.1, 26, 1.4, GROUND - 26, INK.crust))
    )
  }
  // Liegestuhl: gestreifter Stoff zwischen schrägem Rücken und Sitz, Clawd lehnt sich hinein.
  const chair =
    `<path d="M4 13 L11 24.5 L28 24.5" fill="none" stroke="${INK.wood}" stroke-width="3.2" stroke-linejoin="round"/>` +
    `<path d="M4 13 L11 24.5 L28 24.5" fill="none" stroke="${INK.red}" stroke-width="3.2" stroke-dasharray="1.6 1.6" stroke-linejoin="round"/>` +
    `<path d="M11 24.5 L8 ${GROUND} M28 24.5 L28 ${GROUND} M6 16 L3 ${GROUND}" stroke="${INK.crust}" stroke-width="1"/>`
  const lying = `<g transform="translate(3 3) rotate(-24 16 22)">${body}</g>`
  if (comfort === 2) return chair + lying
  // Sonnenschirm und ein Drink auf dem Beistelltisch.
  const parasol =
    `<path d="M2.5 4.5 L2.5 ${GROUND}" stroke="${INK.concrete}" stroke-width="0.9"/>` +
    `<path d="M-9 9 Q 2.5 0.5 14 9 Z" fill="${INK.red}"/>` +
    `<path d="M-1.5 8.6 Q 2.5 2.4 6.5 8.6 Z" fill="${INK.silver}"/>` +
    `<path d="M-9 9 Q -6 10 -3.3 9 Q -0.6 10 2.5 9 Q 5.6 10 8.3 9 Q 11 10 14 9" fill="none" stroke="${INK.brim}" stroke-width="0.6"/>`
  const drink =
    crisp(px(29.5, 22.2, 5, 0.8, INK.wood) + px(31.5, 23, 1, GROUND - 23, INK.crust)) +
    `<path d="M30 18 L34 18 L32 20.4 Z" fill="${SCREEN}" fill-opacity="0.85"/>` +
    `<path d="M32 20.4 L32 22.2" stroke="${INK.glassEdge}" stroke-width="0.4"/>` +
    `<path d="M32.6 18 L34.2 15.8" stroke="${INK.red}" stroke-width="0.4"/>` +
    `<circle cx="30.3" cy="18" r="0.9" fill="${INK.orange}"/>`

  return parasol + chair + lying + drink
}

// Dusche: hinten das Rohr mit rotem Drehknopf, oben der Brausekopf über Clawds Haube, unten die
// Duschwanne. Das Wasser prasselt auf die Haube und rinnt an ihm herab; solange es läuft, singt er.
// Der Dampf wird mit der Sitzung dichter, bis Clawd fast verschwindet.
const BRAUSE = { left: 11, right: 21, y: 5 }
function showerBackSvg(): string {
  return (
    crisp(
      [
        px(32.5, 3.6, 1.6, GROUND - 3.6, INK.concrete),
        px(16, 3.6, 18, 1.2, INK.concreteTop),
        px(15.4, 3.6, 1.2, 1.4, INK.concreteTop),
        px(0.5, GROUND - 1, 35, 1, TOWEL),
      ].join(''),
    ) +
    `<path d="M${BRAUSE.left} ${BRAUSE.y} L${BRAUSE.right} ${BRAUSE.y} L${BRAUSE.right - 1.5} ${BRAUSE.y - 1.2} L${BRAUSE.left + 1.5} ${BRAUSE.y - 1.2} Z" fill="${INK.concreteTop}"/>` +
    `<circle cx="33.3" cy="16" r="1.3" fill="${INK.red}"/>`
  )
}
function showerSvg(scene: Scene, colors: SceneColors, isHere: boolean): string {
  const { water, strength, tick, level } = scene
  const wet = `fill="${colors.suggestion}"`
  let rain = ''
  if (isHere && water !== null) {
    const xs = [12.5, 14.5, 16.5, 18.5, 20]
    const drop = water.drop
    if (drop !== null) {
      // Tropfen: fallen vom Brausekopf auf die Haube, abwechselnd links und rechts.
      rain = xs
        .filter((_, i) => i % 2 === tick % 2)
        .map(x => `<ellipse cx="${x}" cy="${(BRAUSE.y + 0.8 + drop * 0.9).toFixed(1)}" rx="0.5" ry="0.8" ${wet} fill-opacity="0.9"/>`)
        .join('')
    } else if (water.jet > 0) {
      const width = strength === 3 ? 0.8 : 0.5
      rain = xs
        .map(x => `<path d="M${x} ${BRAUSE.y} L${x} 8" stroke="${colors.suggestion}" stroke-width="${width}" stroke-dasharray="1 0.6" stroke-dashoffset="${-(tick % 3) * 0.5}"/>`)
        .join('')
      // Es rinnt an beiden Seiten herab bis in die Duschwanne.
      rain += [6.5, 25.5]
        .map(x => `<path d="M${x} 12 L${x} ${GROUND - 1}" stroke="${colors.suggestion}" stroke-opacity="0.7" stroke-width="${width}" stroke-dasharray="1.6 1" stroke-dashoffset="${-(tick % 3) * 0.8}"/>`)
        .join('')
      if (strength === 3) rain += [[9, 8.5], [23, 8], [7.5, 10]].map(([x, y]) => `<circle cx="${x}" cy="${(y ?? 0) - (tick % 2)}" r="0.45" ${wet}/>`).join('')
    } else if (water.isSplash) {
      rain = splashSvg(16, 8.5, colors)
    }
  }
  // Noten steigen rechts auf, im Takt versetzt.
  const notes =
    isHere && water !== null
      ? [0, 1]
          .map(i => {
            const k = (tick + i * 2) % 4
            const x = 27 + i * 3 + k * 0.6
            const y = 11 - k * 1.6 - i
            return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="0.9" ry="0.65" fill="${INK.gold}"/><path d="M${(x + 0.8).toFixed(1)} ${y.toFixed(1)} l 0 -3 l 1.2 0.8" fill="none" stroke="${INK.gold}" stroke-width="0.4"/>`
          })
          .join('')
      : ''
  // Dampfschwaden: mit jeder Stufe einer mehr und alle dichter.
  const puffs: [number, number, number][] = [[4, 22, 3], [30, 20, 3.5], [8, 9, 3], [26, 7, 3.5], [16, 14, 4], [2, 15, 3], [36, 12, 4], [20, 22, 4], [12, 4, 3.5], [40, 5, 4]]
  const steam = puffs
    .slice(0, Math.min(10, level))
    .map(([x, y, r], i) => `<circle cx="${x + ((tick + i) % 2) * 0.4}" cy="${y}" r="${r}" fill="#FFFFFF" fill-opacity="${(0.08 + Math.min(10, level) * 0.025).toFixed(2)}"/>`)
    .join('')

  return rain + notes + steam
}

// Pool: ein Aufstellpool rechts, die Seitenwand durchsichtig, damit man den Pegel sieht. Er füllt
// sich mit der Sitzung, ab Stufe 6 schwimmt eine Quietscheente, ab Stufe 9 läuft er über.
const NOZZLE = { x: 34, y: 17 }
const POOL_BOX = { left: 37, right: 59, top: 18.5 }
function poolSvg(scene: Scene, colors: SceneColors, isHere: boolean): { back: string; front: string } {
  const { water, strength, tick, level } = scene
  const wet = `fill="${colors.suggestion}"`
  const height = GROUND - POOL_BOX.top
  const width = POOL_BOX.right - POOL_BOX.left
  const depth = (height - 1) * (Math.min(8, level) / 8)
  const surface = GROUND - depth
  const wave = isHere && water !== null ? (tick % 2) * 0.4 : 0
  const pool =
    crisp(px(POOL_BOX.left, POOL_BOX.top, width, height, INK.denim, ' fill-opacity="0.25"')) +
    (depth > 0 ? `<path d="M${POOL_BOX.left} ${surface} q ${width / 4} ${-0.6 + wave} ${width / 2} 0 t ${width / 2} 0 L${POOL_BOX.right} ${GROUND} L${POOL_BOX.left} ${GROUND} Z" ${wet} fill-opacity="0.7"/>` : '') +
    crisp(
      [
        px(POOL_BOX.left - 0.5, POOL_BOX.top - 0.8, width + 1, 1, INK.silver),
        ...[POOL_BOX.left - 0.5, (POOL_BOX.left + POOL_BOX.right) / 2 - 0.5, POOL_BOX.right - 0.5].map(x => px(x, POOL_BOX.top, 1, height, INK.denimDark)),
      ].join(''),
    )
  let duck = ''
  if (level >= 6) {
    const y = surface - 1 + wave
    duck =
      `<ellipse cx="52" cy="${y.toFixed(1)}" rx="1.8" ry="1" fill="${INK.gold}"/>` +
      `<circle cx="53.3" cy="${(y - 1.4).toFixed(1)}" r="0.9" fill="${INK.gold}"/>` +
      px(54, y - 1.6, 1, 0.5, INK.orange) +
      px(53.4, y - 1.8, 0.4, 0.4, INK.ink)
  }
  const over =
    level >= 9
      ? [POOL_BOX.left - 0.6, POOL_BOX.right + 0.6]
          .map(x => `<path d="M${x} ${POOL_BOX.top - 0.4} L${x} ${GROUND}" stroke="${colors.suggestion}" stroke-opacity="0.8" stroke-width="0.8" stroke-dasharray="1.4 0.8" stroke-dashoffset="${-(tick % 3) * 0.7}"/>`)
          .join('') + `<ellipse cx="48" cy="${GROUND}" rx="${14 + (level - 9) * 3}" ry="0.9" ${wet} fill-opacity="0.35"/>`
      : ''
  const back = over + pool + duck
  if (!isHere) return { back, front: '' }
  const hose = `<path d="M0 ${GROUND - 0.5} Q 3 ${GROUND - 0.5} 4.5 23 T 6 18" fill="none" stroke="${INK.leaf}" stroke-width="2" stroke-linecap="round"/>`
  if (water === null) return { back, front: hose }
  const land = Math.min(surface, GROUND - 1)
  let arc = ''
  if (water.drop !== null) arc = `<circle cx="36" cy="${18 + water.drop * 2.5}" r="1.1" ${wet} fill-opacity="0.85"/>`
  if (water.isSplash && water.jet === 0) arc = splashSvg(40, land, colors)
  if (water.jet > 0) {
    // Der Bogen: je stärker, desto höher und weiter in den Pool.
    const end = POOL_BOX.left + (strength === 3 ? 9 : 4)
    arc =
      `<path d="M${NOZZLE.x} ${NOZZLE.y} Q ${(NOZZLE.x + end) / 2} ${water.jet > 2 ? 8 : 12} ${end} ${land}" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.8" stroke-width="${water.jet}" stroke-linecap="round" stroke-dasharray="${water.jet > 2 ? '4 1.5' : '2.5 1.5'}" stroke-dashoffset="${-(tick % 4) * 1.4}"/>` +
      `<ellipse cx="${end}" cy="${land}" rx="${strength === 3 ? 2.6 : 1.8}" ry="0.6" fill="none" stroke="${INK.silver}" stroke-opacity="0.7" stroke-width="0.5"/>`
  }

  return { back, front: hose + arc }
}

// Wanne: weiße Badewanne auf goldenen Füßen, Clawd sitzt darin, nur Kopf und Augen schauen
// heraus. Rechts der Hahn, der in die Wanne läuft. Der Schaum türmt sich mit der Sitzung, erst
// an den Rändern, dann um ihn herum, zuletzt auf seinem Kopf; ab Stufe 8 schwappt es über.
const TUB = { left: 1, right: 35, rim: 19.5 }
const BATH_SPOUT = { x: 31.2, y: 13.8 }
const FOAM_AT: [number, number, number][] = [[3.5, 0, 2], [32.5, 0, 1.8], [6.5, 0, 1.7], [28, 0, 2], [25, 0, 1.6], [4.5, -2.4, 1.6], [30, -2.2, 1.7], [17, -6.3, 1.8], [14.5, -5.6, 1.3], [19.5, -5.7, 1.4]]
function bathBackSvg(isOpen: boolean): string {
  return (
    crisp([px(33.6, 11, 1.6, TUB.rim - 11, INK.concrete), px(30.6, 11, 4.6, 1.4, INK.concreteTop), px(30.6, 12.4, 1.2, 1.4, INK.concreteTop)].join('')) +
    (isOpen
      ? `<path d="M34.4 11 L36.6 8.8" stroke="${INK.red}" stroke-width="1.1" stroke-linecap="round"/>`
      : `<path d="M34.4 11 L37.4 11" stroke="${INK.red}" stroke-width="1.1" stroke-linecap="round"/>`)
  )
}
function bathSvg(scene: Scene, colors: SceneColors, isHere: boolean): string {
  const { water, strength, tick, level } = scene
  const wet = `fill="${colors.suggestion}"`
  const tub =
    `<path d="M${TUB.left} ${TUB.rim} L${TUB.right} ${TUB.rim} L${TUB.right - 1.5} 25 Q ${TUB.right - 2} 26.4 ${TUB.right - 3.5} 26.4 L${TUB.left + 3.5} 26.4 Q ${TUB.left + 2} 26.4 ${TUB.left + 1.5} 25 Z" fill="${INK.silver}"/>` +
    crisp(px(TUB.left - 0.5, TUB.rim - 0.6, TUB.right - TUB.left + 1, 1, TOWEL) + px(4, 26.4, 2, 1.1, INK.gold) + px(TUB.right - 6, 26.4, 2, 1.1, INK.gold))
  const foam = FOAM_AT.slice(0, Math.min(10, level))
    .map(([x, dy, r], i) => `<circle cx="${(x + ((tick + i) % 3 === 0 ? 0.2 : 0)).toFixed(1)}" cy="${(TUB.rim - 0.4 + dy).toFixed(1)}" r="${r}" fill="#FFFFFF" fill-opacity="0.92"/>`)
    .join('')
  const over =
    level >= 8
      ? `<path d="M${TUB.right - 0.3} ${TUB.rim} Q ${TUB.right + 0.6} 23 ${TUB.right} ${GROUND}" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.8" stroke-width="0.9"/>` +
        `<ellipse cx="${TUB.right + 4}" cy="${GROUND}" rx="${4 + (level - 8) * 3}" ry="0.8" ${wet} fill-opacity="0.4"/>`
      : ''
  let stream = ''
  if (isHere && water !== null) {
    if (water.drop !== null) {
      const y = BATH_SPOUT.y + 1 + ((TUB.rim - BATH_SPOUT.y - 2) * water.drop) / 2
      stream = `<ellipse cx="${BATH_SPOUT.x}" cy="${y.toFixed(1)}" rx="0.8" ry="1.1" ${wet} fill-opacity="0.9"/>`
    } else if (water.isSplash && water.jet === 0) {
      stream = splashSvg(BATH_SPOUT.x, TUB.rim, colors)
    } else if (water.jet > 0) {
      stream =
        `<path d="M${BATH_SPOUT.x} ${BATH_SPOUT.y} L${BATH_SPOUT.x} ${TUB.rim}" stroke="${colors.suggestion}" stroke-opacity="0.85" stroke-width="${strength === 3 ? 1.8 : 1}" stroke-dasharray="${strength === 3 ? '3 0.8' : '2 1.2'}" stroke-dashoffset="${-(tick % 4) * 0.9}"/>` +
        (strength === 3 ? [[-2.5, -1.5], [2, -2]].map(([dx, dy]) => `<circle cx="${BATH_SPOUT.x + (dx ?? 0)}" cy="${TUB.rim + (dy ?? 0) - (tick % 2)}" r="0.5" ${wet}/>`).join('') : '')
    }
  }

  return over + tub + foam + stream
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

// Das Ruderboot für die Anfahrt zum See.
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
export function sceneSvg(scene: Scene, colors: SceneColors): string {
  const { role, water, tick, level, arrival } = scene
  const isHere = arrival < 0
  const isOn = isHere && water !== null
  const back: string[] = []
  const front: string[] = []

  // Hinten und vorn die Szene, dazwischen Clawd.
  if (role === 'tap') {
    back.push(sinkSvg({ ...scene, water: isHere ? water : null }, colors, isTapOpen(arrival)))
  } else if (role === 'shower') {
    back.push(showerBackSvg())
    front.push(showerSvg(scene, colors, isHere))
  } else if (role === 'pool') {
    const drawn = poolSvg(scene, colors, isHere)
    back.push(drawn.back)
    front.push(drawn.front)
  } else if (role === 'bath') {
    back.push(bathBackSvg(isTapOpen(arrival)))
    // Erst wenn Clawd drinsitzt, kommt die Wanne vor ihn; beim Herlaufen steht er davor.
    if (isHere) front.push(bathSvg(scene, colors, isHere))
    else back.push(bathSvg(scene, colors, isHere))
  } else {
    const drawn = lakeSvg(scene, colors, isHere)
    back.push(drawn.back)
    front.push(drawn.front)
  }

  // Die Anfahrt: zum See rudert er, das Boot wendet und fährt nach links wieder weg, damit es nie
  // durch die Szene fährt. Sonst läuft er von links herein und trägt, was er braucht.
  let clawd = ''
  if (arrival >= 0 && !isWalking(role)) {
    const shift = arrivalShift(arrival)
    const roll = rollOf(arrival)
    const turn = shift > 0 ? `translate(${(VEHICLE_WIDTH - shift * 44).toFixed(1)} 0) scale(-1 1)` : `translate(${(shift * 40).toFixed(1)} 0)`
    back.push(`<g transform="${turn}">${rowboatPx(roll, colors)}</g>`)
    if (arrival > ARRIVE.in) {
      const hop = arrival === ARRIVE.in + 1 ? -3 : arrival === ARRIVE.in + 2 ? -1 : 0
      clawd = `<g transform="translate(0 ${hop})">${clawdPx(role, 0)}</g>`
    }
  } else if (arrival >= 0) {
    const walked = Math.min(1, arrival / ARRIVE.in)
    const step = walked < 1 ? arrival : 0
    const carried = role === 'pool' ? coilPx : role === 'shower' || role === 'bath' ? towelPx : ''
    const walker = role === 'tap' ? idlerPx(0, step, tick) : clawdPx(role, step) + (walked < 1 ? carried : '')
    clawd = `<g transform="translate(${(-32 * (1 - walked)).toFixed(1)} 0)">${walker}</g>`
  } else if (role === 'tap') {
    clawd = idlerPx(comfortOf(level), 0, tick)
  } else if (role === 'bath') {
    // In der Wanne sitzt er tiefer, nur Kopf und Augen schauen über den Rand.
    clawd = `<g transform="translate(1 2)">${clawdPx(role, 0, false, true)}</g>`
  } else {
    clawd = clawdPx(role, 0, role === 'shower' && isOn)
  }
  const { x, y, width, height } = SCENE_VIEW

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}">${back.join('')}${clawd}${front.join('')}</svg>`
}

export function sceneAlt(scene: Scene): string {
  const { role, water, arrival, level } = scene
  if (arrival >= 0) {
    const arriving: Record<Role, string> = {
      tap: 'Clawd walking in, eyes on the phone',
      shower: 'Clawd walking in with a towel',
      pool: 'Clawd walking in with a garden hose',
      bath: 'Clawd walking in with a towel',
      lake: 'rowboat arriving',
    }
    return arriving[role]
  }
  const isOn = water !== null
  if (role === 'tap') {
    const where = ['next to the sink', 'on a stool', 'in a deck chair', 'in a deck chair under a parasol'][comfortOf(level)]
    if (isOn) return `Clawd on the phone ${where}, the tap ${scene.strength >= 2 ? 'runs' : 'drips'} into the drain`
    return `Clawd on the phone ${where}`
  }
  if (role === 'shower') {
    const steam = level >= 6 ? ' in thick steam' : ''
    return isOn ? `Clawd singing in the shower${steam}` : `Clawd in a shower cap under the shower${steam}`
  }
  if (role === 'pool') {
    const pool = level >= 9 ? 'the overflowing pool' : level >= 6 ? 'the pool with a rubber duck' : 'the pool'
    return isOn ? `Clawd in sunglasses filling ${pool} with a hose` : `Clawd in sunglasses next to ${pool}`
  }
  if (role === 'bath') {
    const tub = level >= 8 ? 'the overflowing bathtub' : 'a bathtub full of foam'
    return isOn ? `Clawd in ${tub}, the tap is running` : `Clawd in ${tub}`
  }
  if (level >= 10) return 'Clawd with a straw at the dried-up lake'

  return isOn ? 'Clawd slurping the lake through a straw' : 'Clawd with a straw at the lake'
}
