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
// In der Leiste der Apps steht die Szene 1,5-fach (90 × 41): auf Retina drei Gerätepixel je
// Szenenpixel, also scharf, und groß genug, dass man Clawd erkennt. Die halbe Zeile, die 40,5 px
// zu 41 fehlt, bleibt unten frei (preserveAspectRatio oben bündig), damit nichts verschwimmt.
// Wird es eng, steht er 1-fach (60 × 27), gestapelt immer 1-fach, damit die Leiste flach bleibt.
// Ein engerer Ausschnitt ginge nicht: Sonnenschirm, Dampf, Noten und Pool reichen bis an den Rand.
export const appScene = (scale: number) => ({ width: SCENE_VIEW.width * scale, height: Math.ceil(SCENE_VIEW.height * scale) })
export const APP_SCENE = appScene(1.5)
export const APP_SCENE_FLAT = appScene(1)
// `isLight`: auf hellem Grund bekommen Weißes (Schaum, Dampf, Becken, Wanne) Kontur und Ton.
export type SceneColors = { suggestion: string; gray: string; isLight?: boolean }
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
// Ein Pixelrechteck der Szene: x, y, Breite, Höhe, Farbe. Svg und die Box-Pixel für VS Code
// zeichnen aus denselben Listen.
type Shape = [number, number, number, number, string]
const pxOf = (shapes: Shape[]) => shapes.map(([x, y, w, h, c]) => px(x, y, w, h, c)).join('')
function clawdShapes(role: Role, step: number, isSinging = false, isSitting = false): Shape[] {
  const legs = [8, 12, 18, 22]
  const parts: Shape[] = [
    [4, 15, 4, 4, INK.clay],
    [8, 12, 16, 10, INK.clay],
    [24, 15, 4, 4, INK.clay],
    ...(isSinging
      ? ([[10, 15, 2, 1, INK.ink], [20, 15, 2, 1, INK.ink]] satisfies Shape[])
      : ([[10, 14, 2, 2, INK.ink], [20, 14, 2, 2, INK.ink]] satisfies Shape[])),
    ...(isSitting ? [] : legs.map((x, i): Shape => [x, 22 - (step % 2 === 1 && i % 2 === 1 ? 1 : 0), 2, 4, INK.clay])),
  ]
  if (role === 'shower') {
    // Rosa Duschhaube mit weißen Tupfen und Rüschenrand
    parts.push(
      [11, 8, 10, 1, CAP_PINK],
      [9, 9, 14, 3, CAP_PINK],
      [8, 11.5, 16, 1, '#E58BAE'],
      [12, 9.5, 1, 1, TOWEL],
      [16, 9, 1, 1, TOWEL],
      [20, 10, 1, 1, TOWEL],
    )
  } else if (role === 'pool') {
    // Sonnenbrille, Düse in der vorderen Schere
    parts.push(
      [9, 13.5, 5, 2.5, INK.ink],
      [18, 13.5, 5, 2.5, INK.ink],
      [14, 14, 4, 0.8, INK.ink],
      [10, 14, 1.5, 0.6, INK.silver],
      [19, 14, 1.5, 0.6, INK.silver],
      [27, 16, 1, 2, INK.leaf],
      [28, 16, 4, 2, INK.brass],
      [32, 16.5, 2, 1, INK.tip],
    )
  } else if (role === 'lake') {
    // Strohhut mit grünem Band
    parts.push(
      [11, 6, 10, 1, INK.straw],
      [10, 7, 12, 3, INK.straw],
      [10, 9, 12, 1, INK.leaf],
      [4, 10, 24, 1, INK.strawDark],
      [5, 11, 22, 1, INK.straw],
    )
  }

  return parts
}
const clawdPx = (role: Role, step: number, isSinging = false, isSitting = false) =>
  crisp(pxOf(clawdShapes(role, step, isSinging, isSitting)))
// Was Clawd herbeiträgt: ein Handtuch über der Schulter oder den aufgerollten Gartenschlauch.
const towelPx = crisp(px(5, 11.5, 6, 1.2, TOWEL) + px(5, 12.7, 2, 6, TOWEL) + px(5, 16, 2, 0.6, INK.red))
const coilPx = [2.4, 1.3].map(r => `<circle cx="30" cy="18" r="${r}" fill="none" stroke="${INK.leaf}" stroke-width="0.9"/>`).join('')

const splashSvg = (x: number, y: number, colors: SceneColors) =>
  `<ellipse cx="${x}" cy="${y}" rx="2.5" ry="0.9" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.6" stroke-width="0.7"/><circle cx="${x - 1.5}" cy="${y - 2}" r="0.6" fill="${colors.suggestion}" fill-opacity="0.7"/><circle cx="${x + 1.5}" cy="${y - 2.5}" r="0.6" fill="${colors.suggestion}" fill-opacity="0.7"/>`

// Hahn: ein Waschbecken auf dem Standfuß, der Hahn mit rotem Hebel hinten rechts, der Auslauf
// über dem Abfluss. Aufgefangen wird nichts: das Wasser gurgelt weg, beim Strahl strudelt es.
const SPOUT = { x: 47.2, y: 13.6 }
const DRAIN = { x: 47, y: 20.4 }
// Auf hellem Grund eine graue Kontur um Weißes, sonst ginge es unter.
const edgeOf = (colors: SceneColors, width = 0.45) => (colors.isLight === true ? ` stroke="${INK.concrete}" stroke-width="${width}"` : '')
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
    `<path d="M37 18.6 L57 18.6 Q 56 23 47 23 Q 38 23 37 18.6 Z" fill="${INK.silver}"${edgeOf(colors)}/>` +
    `<path d="M38.6 19.6 L55.4 19.6 Q 54.4 21.8 47 21.8 Q 39.6 21.8 38.6 19.6 Z" fill="${INK.concreteTop}"${level > 0 ? '' : ' fill-opacity="0.6"'}/>` +
    crisp(px(36.6, 17.8, 20.8, 1, colors.isLight === true ? INK.concrete : INK.flourDark)) +
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
// Clawd am Handy, ohne die scrollende Zeile (die hat im Svg eine Deckkraft).
function idlerShapes(comfort: number, step: number): Shape[] {
  const lift = (i: number) => (step % 2 === 1 && i % 2 === 1 ? 1 : 0)
  // Stehend vier Beine, auf dem Hocker baumeln zwei, im Liegestuhl sind sie angezogen.
  const legs: Shape[] =
    comfort === 0
      ? [8, 12, 18, 22].map((x, i): Shape => [x, 22 - lift(i), 2, 4, INK.clay])
      : comfort === 1
        ? [[10, 22, 2, 2.5, INK.clay], [20, 22, 2, 2.5, INK.clay]]
        : []

  return [
    [4, 15, 4, 4, INK.clay],
    [8, 12, 16, 10, INK.clay],
    [24, 15, 2, 3, INK.clay],
    [11, 15, 2, 1.2, INK.ink],
    [19, 15, 2, 1.2, INK.ink],
    ...legs,
    // Das Handy: dunkle Hülle, das Display leuchtet.
    [25.6, 12, 2.8, 4.6, INK.boot],
    [26, 12.5, 2, 3.6, SCREEN],
  ]
}
function idlerPx(comfort: number, step: number, tick: number): string {
  // Eine Zeile scrollt über das Display.
  const shape = pxOf(idlerShapes(comfort, step)) + px(26, 12.6 + (tick % 4) * 0.8, 2, 0.4, '#FFFFFF', ' fill-opacity="0.8"')
  const body = crisp(shape)
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
  // Gedreht ohne crispEdges, sonst werden die schrägen Kanten treppig.
  const lying = `<g transform="translate(3 3) rotate(-24 16 22)">${shape}</g>`
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
function showerBackSvg(colors: SceneColors): string {
  return (
    crisp(
      [
        px(32.5, 3.6, 1.6, GROUND - 3.6, INK.concrete),
        px(16, 3.6, 18, 1.2, INK.concreteTop),
        px(15.4, 3.6, 1.2, 1.4, INK.concreteTop),
        px(0.5, GROUND - 1, 35, 1, colors.isLight === true ? INK.concrete : TOWEL),
      ].join(''),
    ) +
    `<path d="M${BRAUSE.left} ${BRAUSE.y} L${BRAUSE.right} ${BRAUSE.y} L${BRAUSE.right - 1.5} ${BRAUSE.y - 1.2} L${BRAUSE.left + 1.5} ${BRAUSE.y - 1.2} Z" fill="${INK.concreteTop}"/>` +
    `<circle cx="33.3" cy="16" r="1.3" fill="${INK.red}"/>`
  )
}
const STEAM_PUFFS: [number, number, number][] = [[4, 23, 3], [30, 20, 3.5], [6, 8, 3], [27, 8, 3.5], [16, 25, 3.5], [1.5, 15, 2.6], [36, 12, 4], [24, 25, 3.2], [13, 4, 3.5], [40, 5, 4]]
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
  // Dampfschwaden: mit jeder Stufe einer mehr und alle dichter. Sie ziehen um Clawd herum,
  // über der Haube und unten um die Beine, sein Gesicht (x 8 bis 24, y 12 bis 19) bleibt frei.
  // Auf hellem Grund ist der Dampf grau statt weiß.
  const puff = colors.isLight === true ? INK.concrete : '#FFFFFF'
  const steam = STEAM_PUFFS
    .slice(0, Math.min(10, level))
    .map(([x, y, r], i) => `<circle cx="${x + ((tick + i) % 2) * 0.4}" cy="${y}" r="${r}" fill="${puff}" fill-opacity="${(0.08 + Math.min(10, level) * 0.025).toFixed(2)}"/>`)
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
    `<path d="M${TUB.left} ${TUB.rim} L${TUB.right} ${TUB.rim} L${TUB.right - 1.5} 25 Q ${TUB.right - 2} 26.4 ${TUB.right - 3.5} 26.4 L${TUB.left + 3.5} 26.4 Q ${TUB.left + 2} 26.4 ${TUB.left + 1.5} 25 Z" fill="${INK.silver}"${edgeOf(colors)}/>` +
    crisp(px(TUB.left - 0.5, TUB.rim - 0.6, TUB.right - TUB.left + 1, 1, colors.isLight === true ? INK.concrete : TOWEL) + px(4, 26.4, 2, 1.1, INK.gold) + px(TUB.right - 6, 26.4, 2, 1.1, INK.gold))
  const foam = FOAM_AT.slice(0, Math.min(10, level))
    .map(([x, dy, r], i) => `<circle cx="${(x + ((tick + i) % 3 === 0 ? 0.2 : 0)).toFixed(1)}" cy="${(TUB.rim - 0.4 + dy).toFixed(1)}" r="${r}" fill="#FFFFFF" fill-opacity="0.92"${edgeOf(colors, 0.3)}/>`)
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
    back.push(showerBackSvg(colors))
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
    back.push(`<g mask="url(#burn-einfahrt)"><g transform="${turn}">${rowboatPx(roll, colors)}</g></g>`)
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
  // Was hereinkommt, blendet am linken Rand weich ein, statt dort hart abgeschnitten zu sein; bis
  // x 4, wo Clawds Schere beginnt, damit er angekommen nicht verblasst.
  const fade =
    arrival >= 0
      ? `<defs><linearGradient id="burn-rand" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="4" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#FFF"/></linearGradient><mask id="burn-einfahrt" maskUnits="userSpaceOnUse" x="-60" y="0" width="180" height="40"><rect x="-60" y="0" width="180" height="40" fill="url(#burn-rand)"/></mask></defs>`
      : ''
  const soft = (inner: string) => (arrival >= 0 && inner !== '' ? `<g mask="url(#burn-einfahrt)">${inner}</g>` : inner)

  return `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMin meet" viewBox="${x} ${y} ${width} ${height}">${fade}${back.join('')}${soft(clawd)}${front.join('')}</svg>`
}

// ---------- Apps ohne Svg (VS Code) ----------
// VS Code zeichnet in der Leiste keine Svg und Text nur in seiner Chat-Schrift, Box aber treu.
// Dort steht dieselbe Szene aus Box-Pixeln: ein Raster aus 2 × 2 Szeneneinheiten (30 × 14 Pixel
// ab y 2, also Clawd 12 × 7), gemalt aus denselben Rechtecken wie das Svg; Kurven, Ellipsen
// und Linien werden zu Pixeln gerundet. Jede Zelle hat eine Farbe (Hex, auch mit Deckkraft)
// oder bleibt leer.
export const PIXEL_GRID = { cols: 30, rows: 14, unit: 2, top: 2 }
export type Pixels = (string | null)[][]
// x' = a·x + c·y + e, y' = b·x + d·y + f wie Svgs matrix()
type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const times = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
const moved = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
function turned(degrees: number, cx: number, cy: number): Matrix {
  const r = (degrees * Math.PI) / 180

  return times(moved(cx, cy), times([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0], moved(-cx, -cy)))
}
function inverse(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2]

  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
const withAlpha = (hex: string, alpha: number) => `${hex}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`

// Malt Formen ins Raster: je Zelle 3 × 3 Stichproben; trifft die Form mindestens `need` davon,
// nimmt die Zelle ihre Farbe. Später Gemaltes liegt oben.
function painter() {
  const { cols, rows, unit, top } = PIXEL_GRID
  const grid: Pixels = Array.from({ length: rows }, () => Array.from({ length: cols }, (): string | null => null))
  let matrix = IDENTITY
  const paint = (inside: (x: number, y: number) => boolean, box: [number, number, number, number], color: string, need: number) => {
    const back = inverse(matrix)
    const corners = [apply(matrix, box[0], box[1]), apply(matrix, box[2], box[1]), apply(matrix, box[0], box[3]), apply(matrix, box[2], box[3])]
    const c0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p[0])) / unit))
    const c1 = Math.min(cols - 1, Math.floor(Math.max(...corners.map(p => p[0])) / unit))
    const r0 = Math.max(0, Math.floor((Math.min(...corners.map(p => p[1])) - top) / unit))
    const r1 = Math.min(rows - 1, Math.floor((Math.max(...corners.map(p => p[1])) - top) / unit))
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        let hits = 0
        for (let i = 0; i < 3; i += 1) {
          for (let j = 0; j < 3; j += 1) {
            const [x, y] = apply(back, c * unit + ((i + 0.5) * unit) / 3, top + r * unit + ((j + 0.5) * unit) / 3)
            if (inside(x, y)) hits += 1
          }
        }
        const row = grid[r]
        if (hits >= need && row !== undefined) row[c] = color
      }
    }
  }
  const rect = (x: number, y: number, w: number, h: number, color: string, need = 4) =>
    paint((px, py) => px >= x && px < x + w && py >= y && py < y + h, [x, y, x + w, y + h], color, need)
  const oval = (cx: number, cy: number, rx: number, ry: number, color: string, need = 4) =>
    paint((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, [cx - rx, cy - ry, cx + rx, cy + ry], color, need)
  // Eine Linie so breit wie `width`, mindestens aber so, dass sie eine Zelle trifft.
  const line = (x1: number, y1: number, x2: number, y2: number, width: number, color: string) => {
    const half = Math.max(width, 1) / 2
    const dx = x2 - x1
    const dy = y2 - y1
    const length = dx * dx + dy * dy || 1
    paint(
      (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length))
        return (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 <= half * half
      },
      [Math.min(x1, x2) - half, Math.min(y1, y2) - half, Math.max(x1, x2) + half, Math.max(y1, y2) + half],
      color,
      2,
    )
  }
  const shapes = (list: Shape[], need = 4) => list.forEach(([x, y, w, h, c]) => rect(x, y, w, h, c, need))
  const within = (m: Matrix, draw: () => void) => {
    const was = matrix
    matrix = times(matrix, m)
    draw()
    matrix = was
  }

  return { grid, rect, oval, line, shapes, within }
}

export function scenePixels(scene: Scene, colors: SceneColors): Pixels {
  const { role, water, strength, tick, level, arrival } = scene
  const isHere = arrival < 0
  const isOn = isHere && water !== null
  const isLight = colors.isLight === true
  const p = painter()
  const wet = colors.suggestion
  // Weißes bekommt auf hellem Grund einen grauen Ton, sonst ginge es unter.
  const white = isLight ? INK.concreteTop : INK.silver
  const walked = Math.min(1, Math.max(0, arrival) / ARRIVE.in)
  const step = arrival >= 0 && walked < 1 ? arrival : 0
  const walkIn = (draw: () => void) => p.within(moved(-32 * (1 - walked), 0), draw)

  // Wasser senkrecht von `from` bis `to`: ein Tropfen, ein wandernder Strahl oder ein Spritzer.
  const fall = (x: number, from: number, to: number) => {
    if (!isOn || water === null) return
    if (water.drop !== null) {
      p.rect(x - 1, from + 1 + ((to - from - 2) * water.drop) / 2, 2, 2, wet, 3)
    } else if (water.jet > 0) {
      for (let y = from; y < to; y += 2) {
        if ((Math.round(y / 2) + tick) % 3 !== 0) p.rect(x - (strength === 3 ? 1 : 0.7), y, strength === 3 ? 2 : 1.4, 2, wet, 2)
      }
    } else if (water.isSplash) {
      p.rect(x - 3, to - 1, 6, 1.4, wet, 2)
    }
  }

  if (role === 'tap') {
    // Das Becken auf dem Standfuß, der Hahn mit rotem Hebel.
    p.rect(45, 21.5, 4, GROUND - 21.5, INK.concrete)
    p.rect(51.5, 10, 2, 8, INK.concrete)
    p.rect(46.4, 10, 7.1, 1.6, INK.concreteTop, 3)
    p.rect(46.4, 11.6, 1.6, 2, INK.concreteTop, 3)
    if (isTapOpen(arrival)) p.line(52.5, 10, 55.5, 7.3, 1.3, INK.red)
    else p.line(52.5, 10, 56.5, 10, 1.3, INK.red)
    p.rect(37, 18.6, 20, 2.4, white)
    p.rect(39.5, 21, 15, 2, white)
    p.rect(36.6, 17.8, 20.8, 1, isLight ? INK.concrete : INK.flourDark, 3)
    fall(SPOUT.x, SPOUT.y, DRAIN.y)
    const comfort = comfortOf(level)
    if (!isHere) {
      walkIn(() => p.shapes(idlerShapes(0, step)))
    } else if (comfort === 0) {
      p.shapes(idlerShapes(0, 0))
    } else if (comfort === 1) {
      p.within(moved(0, 2), () => p.shapes(idlerShapes(1, 0)))
      p.rect(6, 24.6, 20, 1.4, INK.wood, 3)
      p.rect(7.5, 26, 1.4, GROUND - 26, INK.crust, 2)
      p.rect(23.1, 26, 1.4, GROUND - 26, INK.crust, 2)
    } else {
      if (comfort === 3) {
        // Sonnenschirm, rot mit weißer Mitte, und der Drink.
        p.line(2.5, 4.5, 2.5, GROUND, 0.9, INK.concrete)
        p.rect(-9, 6, 23, 3, INK.red)
        p.rect(-1, 5, 7, 2, INK.silver, 3)
        p.rect(29.5, 22.2, 5, 1, INK.wood, 3)
        p.rect(31.5, 23, 1, GROUND - 23, INK.crust, 2)
        p.rect(30, 18, 4, 2.4, SCREEN, 3)
        p.oval(30.3, 18, 1, 1, INK.orange, 2)
      }
      // Liegestuhl: Rücken und Sitz gestreift, Clawd lehnt sich gedreht hinein.
      p.line(4, 13, 11, 24.5, 3.2, INK.wood)
      p.line(11, 24.5, 28, 24.5, 3.2, INK.red)
      p.line(11, 24.5, 8, GROUND, 1, INK.crust)
      p.line(28, 24.5, 28, GROUND, 1, INK.crust)
      p.within(times(moved(3, 3), turned(-24, 16, 22)), () => p.shapes(idlerShapes(2, 0)))
    }
  } else if (role === 'shower') {
    // Rohr, Brausekopf, Duschwanne; der Dampf zieht hinter Clawd, das Gesicht bleibt frei.
    p.rect(32.5, 3.6, 1.6, GROUND - 3.6, INK.concrete, 3)
    p.rect(16, 3.6, 18, 1.2, INK.concreteTop, 3)
    p.rect(11, 3.8, 10, 1.2, INK.concreteTop, 3)
    p.rect(0.5, GROUND - 1, 35, 1, isLight ? INK.concrete : TOWEL, 3)
    p.oval(33.3, 16, 1.3, 1.3, INK.red, 2)
    const puff = isLight ? INK.concrete : '#FFFFFF'
    for (const [x, y, r] of STEAM_PUFFS.slice(0, Math.min(10, level))) {
      p.oval(x, y, r, r, withAlpha(puff, 0.1 + Math.min(10, level) * 0.03))
    }
    if (!isHere) {
      walkIn(() => {
        p.shapes(clawdShapes('shower', step))
        if (walked < 1) p.shapes([[5, 11.5, 6, 1.2, TOWEL], [5, 12.7, 2, 6, TOWEL]], 3)
      })
    } else {
      p.shapes(clawdShapes('shower', 0, isOn))
    }
    if (isOn && water !== null) {
      if (water.drop !== null) {
        for (const x of [13, 17, 21].filter((_, i) => i % 2 === tick % 2)) p.rect(x - 1, 6 + water.drop, 2, 2, wet, 3)
      } else if (water.jet > 0) {
        for (const x of [13, 17, 21]) p.rect(x - 0.6, 5 + (tick % 2), 1.2, 2, wet, 2)
        for (let y = 12; y < GROUND - 1; y += 2) if ((y / 2 + tick) % 3 !== 0) for (const x of [6.5, 25.5]) p.rect(x - 0.6, y, 1.2, 2, wet, 2)
      }
      // Eine Note steigt rechts auf.
      p.rect(27 + (tick % 4) * 0.6, 9 - (tick % 4) * 1.6, 2, 2, INK.gold, 3)
    }
  } else if (role === 'pool') {
    // Aufstellpool mit durchsichtiger Wand, Pegel nach der Sitzung, Ente ab 6, Überlauf ab 9.
    const { left, right, top } = POOL_BOX
    const width = right - left
    const depth = (GROUND - top - 1) * (Math.min(8, level) / 8)
    const surface = GROUND - depth
    if (level >= 9) {
      p.oval(48, GROUND, 14 + (level - 9) * 3, 0.9, withAlpha(wet, 0.4), 3)
      p.line(left - 0.6, top, left - 0.6, GROUND, 0.8, wet)
      p.line(right + 0.6, top, right + 0.6, GROUND, 0.8, wet)
    }
    p.rect(left, top, width, GROUND - top, withAlpha(INK.denim, 0.3))
    if (depth > 0) p.rect(left, surface, width, depth, withAlpha(wet, 0.75), 3)
    for (const x of [left - 0.5, (left + right) / 2 - 0.5, right - 0.5]) p.rect(x, top, 1, GROUND - top, INK.denimDark, 3)
    p.rect(left - 0.5, top - 0.8, width + 1, 1, INK.silver, 3)
    if (level >= 6) {
      p.oval(52, surface - 1, 1.8, 1, INK.gold, 3)
      p.oval(53.3, surface - 2.4, 0.9, 0.9, INK.gold, 2)
    }
    if (!isHere) {
      walkIn(() => {
        p.shapes(clawdShapes('pool', step).slice(0, 7))
        if (walked < 1) p.oval(30, 18, 2.4, 2.4, INK.leaf, 3)
      })
    } else {
      p.shapes(clawdShapes('pool', 0), 3)
      p.line(0, GROUND - 0.5, 4.5, 23, 2, INK.leaf)
      p.line(4.5, 23, 6, 18, 2, INK.leaf)
    }
    if (isOn && water !== null) {
      const land = Math.min(surface, GROUND - 1)
      if (water.drop !== null) p.rect(35, 17 + water.drop * 2.5, 2, 2, wet, 3)
      else if (water.isSplash && water.jet === 0) p.rect(38, land - 1, 5, 1.4, wet, 2)
      if (water.jet > 0) {
        // Der Bogen in Stücken, die mit dem Takt wandern; je stärker, desto höher und weiter.
        const end = left + (strength === 3 ? 9 : 4)
        const peak = water.jet > 2 ? 8 : 12
        const mx = (NOZZLE.x + end) / 2
        for (let i = 0; i <= 12; i += 1) {
          if ((i + tick) % 4 === 0) continue
          const t = i / 12
          const x = (1 - t) ** 2 * NOZZLE.x + 2 * (1 - t) * t * mx + t * t * end
          const y = (1 - t) ** 2 * NOZZLE.y + 2 * (1 - t) * t * peak + t * t * land
          p.rect(x - 1, y - 1, 2, 2, wet, 3)
        }
      }
    }
  } else if (role === 'bath') {
    // Wanne auf goldenen Füßen, rechts der Hahn; Clawd sitzt darin, der Schaum türmt sich.
    p.rect(33.6, 11, 1.6, TUB.rim - 11, INK.concrete, 3)
    p.rect(30.6, 11, 4.6, 1.4, INK.concreteTop, 3)
    p.rect(30.6, 12.4, 1.2, 1.4, INK.concreteTop, 3)
    if (isTapOpen(arrival)) p.line(34.4, 11, 36.6, 8.8, 1.1, INK.red)
    else p.line(34.4, 11, 37.4, 11, 1.1, INK.red)
    const tub = () => {
      if (level >= 8) {
        p.oval(TUB.right + 4, GROUND, 4 + (level - 8) * 3, 0.9, withAlpha(wet, 0.45), 3)
        p.line(TUB.right, TUB.rim, TUB.right + 0.3, GROUND, 0.9, wet)
      }
      p.rect(TUB.left, TUB.rim, TUB.right - TUB.left, 5.5, white)
      p.rect(TUB.left + 2, 25, TUB.right - TUB.left - 4, 1.4, white, 3)
      p.rect(TUB.left - 0.5, TUB.rim - 0.6, TUB.right - TUB.left + 1, 1, isLight ? INK.concrete : TOWEL, 3)
      p.rect(4, 26.4, 2, 1.1, INK.gold, 2)
      p.rect(TUB.right - 6, 26.4, 2, 1.1, INK.gold, 2)
      for (const [x, dy, r] of FOAM_AT.slice(0, Math.min(10, level))) p.oval(x, TUB.rim - 0.4 + dy, r, r, isLight ? INK.flourDark : '#FFFFFF')
    }
    if (!isHere) {
      tub()
      walkIn(() => {
        p.shapes(clawdShapes('bath', step))
        if (walked < 1) p.shapes([[5, 11.5, 6, 1.2, TOWEL], [5, 12.7, 2, 6, TOWEL]], 3)
      })
    } else {
      p.within(moved(1, 2), () => p.shapes(clawdShapes('bath', 0, false, true)))
      tub()
      fall(BATH_SPOUT.x, BATH_SPOUT.y, TUB.rim)
    }
  } else {
    // See: Ufer, Wasser, das mit den Tokens schrumpft, Schilf, ab 8 ein Fisch; der Strohhalm.
    const share = 1 - Math.min(10, level) / 10
    p.oval(46.5, GROUND - 0.9, 14, 3.1, withAlpha(INK.soil, 0.8))
    if (share > 0) p.oval(40 + 6.5 * share, GROUND - 0.9, Math.max(1, 13.5 * share), 0.8 + 2.1 * share, withAlpha(wet, 0.75), 3)
    p.rect(57, GROUND - 5, 1, 4, INK.leaf, 3)
    if (level >= 8) p.oval(52, isOn && tick % 2 === 1 ? GROUND - 3.6 : GROUND - 1.8, 2, 0.9, INK.fish, 3)
    if (arrival >= 0) {
      // Das Ruderboot fährt heran und wendet nach links wieder weg.
      const shift = arrivalShift(arrival)
      const boat: Matrix = shift > 0 ? times(moved(VEHICLE_WIDTH - shift * 44, 0), [-1, 0, 0, 1, 0, 0]) : moved(shift * 40, 0)
      p.within(boat, () => {
        p.rect(-4, 24.5, 38, 3.5, withAlpha(wet, 0.55), 3)
        p.rect(2, 19, 28, 3, INK.wood)
        p.rect(4, 22, 23, 3, INK.wood)
        p.rect(1, 18, 29, 1.2, INK.crust, 3)
        const oar = rollOf(arrival) % 2 === 0 ? { x: 1, y: 27 } : { x: -1, y: 20 }
        p.line(10.5, 17.5, oar.x, oar.y, 1, INK.crust)
      })
      if (arrival > ARRIVE.in) {
        const hop = arrival === ARRIVE.in + 1 ? -3 : arrival === ARRIVE.in + 2 ? -1 : 0
        p.within(moved(0, hop), () => p.shapes(clawdShapes('lake', 0), 3))
      }
    } else {
      p.shapes(clawdShapes('lake', 0), 3)
      // Der Strohhalm, rot-weiß; die Streifen wandern beim Saugen zu Clawd.
      const flow = isOn ? tick * (strength >= 2 ? 2 : 1) : 0
      const path: [number, number][] = [[24.5, 15.5], [28.5, 9.5], [31, 8], [37.8, 8], [40, 10], [STRAW_TIP.x, STRAW_TIP.y]]
      let walkedAlong = 0
      for (let i = 1; i < path.length; i += 1) {
        const [x1, y1] = path[i - 1] ?? [0, 0]
        const [x2, y2] = path[i] ?? [0, 0]
        const length = Math.hypot(x2 - x1, y2 - y1)
        for (let d = 0; d < length; d += 2) {
          const t = d / length
          const color = (Math.floor((walkedAlong + d) / 2) + flow) % 2 === 0 ? INK.red : INK.flour
          p.rect(x1 + t * (x2 - x1) - 1, y1 + t * (y2 - y1) - 1, 2, 2, color, 3)
        }
        walkedAlong += length
      }
    }
  }

  return p.grid
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
