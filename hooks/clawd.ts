// Clawd neben dem Preis. Pro Sitzung wird eine von zwei Rollen ausgelost; in jeder steht das Tempo
// für die Tokens pro Sekunde (nur solange gestreamt wird) und die Größe für die Sitzung. Zu
// Beginn und nach einer langen Pause kommt er erst an. Das Thema: KI verschwendet Wasser, jede
// Antwort kostet ein paar Schlucke; unter jeder Szene stehen die Liter.
//   Hahn:    Clawd dreht auf und scrollt am Handy, das Wasser läuft in den Abfluss. Je mehr Liter,
//            desto bequemer: Hocker, Liegestuhl, Sonnenschirm mit Drink.
//   Dusche:  Clawd singt unter der Dauerdusche, der Dampf wird mit der Sitzung dichter.
// Pool, Wanne und See gab es bis 0.18.0.

export type Color = 'claude' | 'error' | 'warning' | 'suggestion' | 'inactive' | 'success'
export type Piece = { text: string; color?: Color; dim?: boolean }

export const ROLES = ['tap', 'shower'] as const
export type Role = (typeof ROLES)[number]
// Für /clawd: englisch wie die Leiste, die deutschen Wörter gehen auch.
export const ROLE_WORDS: Record<Role, string[]> = {
  tap: ['tap', 'hahn', 'wasserhahn', 'abfluss', 'drain', 'handy', 'phone'],
  shower: ['shower', 'dusche', 'duschen', 'brause', 'singen', 'sing'],
}

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

// Ab diesen Tokens der Sitzung eine Stufe größer (der Dampf unter der Dusche), bis Stufe 10.
const SIZE_AT = [1, 50_000, 250_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000]
export const sizeLevel = (n: number) => SIZE_AT.filter(at => n >= at).length

// Die Anfahrt in Takten: Clawd läuft heran, dann dreht er in den Haltetakten auf.
export const ARRIVE = { in: 10, hold: 4 }
export const arrivalLength = (_role: Role) => ARRIVE.in + ARRIVE.hold

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
  // Bild im Leerlauf (0 bis IDLE_LOOP - 1), solange nichts streamt; -1 oder fehlt sonst
  idle?: number
  // Die verschwendeten Liter, wie sie unter der Szene stehen
  liters?: string
}

// Der Leerlauf: steht Clawd da und es streamt nichts, läuft eine ruhige Schleife von 15 s im
// Halbsekundentakt. Er blinzelt zweimal; am Hahn scrollt er weiter, und der Hahn ist nie ganz zu:
// einmal je Schleife tropft er ins Becken. Unter der Dusche shampooniert er sich, Seifenblasen
// steigen schräg auf und zerplatzen.
export const IDLE_LOOP = 30
export const isBlinking = (idle: number | undefined) => idle === 6 || idle === 21
// Der eine Tropfen am Hahn, wie ein Bild aus FLOWS; sonst null.
export const idleDrip = (idle: number): Flow | null =>
  idle >= 12 && idle <= 14 ? fall(idle - 12) : idle === 15 ? SPLASHED : null
// Die Seifenblasen: je eine von drei Phasen versetzt, sechs Bilder im Aufstieg, dann platzt sie.
export type Bubble = { x: number; y: number; isPopping: boolean }
export function bubblesAt(idle: number | undefined): Bubble[] {
  if (idle === undefined || idle < 0) return []

  return [0, 1, 2].flatMap(k => {
    const phase = (idle - k * 5 + IDLE_LOOP) % 15
    if (phase > 6) return []
    const t = Math.min(phase, 5) / 5

    return [{ x: 22.5 + t * 6 + (phase % 2) * 0.6, y: 9.5 - t * 5.5, isPopping: phase === 6 }]
  })
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
// Rosa Duschhaube mit Rüschen.
const SHOWER_CAP: Piece[] = [{ text: '▗▄▆▆▆▄▖', color: 'error' }]
// Was Clawd beim Herlaufen trägt: das Handy oder ein Handtuch.
const CARRIED: Record<Role, Piece> = {
  tap: { text: '▮', color: 'suggestion' },
  shower: { text: '▬', color: 'error' },
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
  const head: Cell[] = [...cellsOf(SHOWER_CAP), { ch: '┳', color: 'inactive' }, { ch: '┓', color: 'inactive' }]
  const top = cellsOf(CLAWD)
  const low = cellsOf(LEGS)
  top[8] = { ch: '┃', color: 'inactive' }
  low[8] = { ch: '┃', color: 'inactive' }
  falling(water, strength, tick, [top, low], 7)
  if (water !== null && water.isSplash) low[7] = { ch: ',', color: 'suggestion' }
  const steam = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => ({ ch: (i + tick) % 3 === 0 ? '▒' : '░', color: 'inactive', dim: true }) satisfies Cell)
  const rights = [steam(level - 3), steam(level)]
  if (water !== null) put(rights[0] ?? [], 1 + (tick % 2), { ch: tick % 4 < 2 ? '♪' : '♫', color: 'warning' })
  // Im Leerlauf steigen rechts neben dem Rohr Seifenblasen auf.
  for (const bubble of bubblesAt(scene.idle)) {
    put(rights[0] ?? [], Math.round((bubble.x - 22.5) / 3), { ch: bubble.isPopping ? '˙' : bubble.y > 6 ? 'o' : '°', color: 'suggestion' })
  }

  return { head, slots: [top, low], rights }
}

const partsOf = (scene: Scene): Parts => (scene.role === 'tap' ? tapParts(scene) : showerParts(scene))

export type TerminalScene = {
  // Die Zeile in der Leiste und die Zeile, wenn nur eine Platz hat
  head: Piece[]
  flat: Piece[]
  // Zeilen darunter: links Platz für die Anfahrt, Clawds Spalten, rechts die Szene
  rows: { left: Piece[]; slot: Piece[]; right: Piece[] }[]
}

// `room` ist der Platz links für die Anfahrt, `reach` die Breite rechts bis unter das Ende des Zählers.
export function terminalScene(scene: Scene, room: number, reach: number): TerminalScene {
  const { role, arrival } = scene
  const parts = partsOf(scene)
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
// Ein engerer Ausschnitt ginge nicht: Sonnenschirm, Dampf und Noten reichen bis an den Rand.
export const appScene = (scale: number) => ({ width: SCENE_VIEW.width * scale, height: Math.ceil(SCENE_VIEW.height * scale) })
export const APP_SCENE = appScene(1.5)
export const APP_SCENE_FLAT = appScene(1)
// `isLight`: auf hellem Grund bekommen Weißes (Dampf, Becken) Kontur und Ton.
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
// kneift unter der Dusche die Augen zu.
const CAP_PINK = '#F2A7C3'
const TOWEL = '#F4F1EA'
// Ein Pixelrechteck der Szene: x, y, Breite, Höhe, Farbe. Svg und die Box-Pixel für VS Code
// zeichnen aus denselben Listen.
type Shape = [number, number, number, number, string]
const pxOf = (shapes: Shape[]) => shapes.map(([x, y, w, h, c]) => px(x, y, w, h, c)).join('')
// `isSinging` kneift die Augen zu, so blinzelt er auch.
function clawdShapes(role: Role, step: number, isSinging = false): Shape[] {
  const legs = [8, 12, 18, 22]
  const parts: Shape[] = [
    [4, 15, 4, 4, INK.clay],
    [8, 12, 16, 10, INK.clay],
    [24, 15, 4, 4, INK.clay],
    ...(isSinging
      ? ([[10, 15, 2, 1, INK.ink], [20, 15, 2, 1, INK.ink]] satisfies Shape[])
      : ([[10, 14, 2, 2, INK.ink], [20, 14, 2, 2, INK.ink]] satisfies Shape[])),
    ...legs.map((x, i): Shape => [x, 22 - (step % 2 === 1 && i % 2 === 1 ? 1 : 0), 2, 4, INK.clay]),
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
  }

  return parts
}
const clawdPx = (role: Role, step: number, isSinging = false) => crisp(pxOf(clawdShapes(role, step, isSinging)))
// Was Clawd unter die Dusche mitbringt: ein Handtuch über der Schulter.
const towelPx = crisp(px(5, 11.5, 6, 1.2, TOWEL) + px(5, 12.7, 2, 6, TOWEL) + px(5, 16, 2, 0.6, INK.red))

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
function idlerShapes(comfort: number, step: number, isBlink = false): Shape[] {
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
    ...(isBlink
      ? ([[11, 15.6, 2, 0.5, INK.ink], [19, 15.6, 2, 0.5, INK.ink]] satisfies Shape[])
      : ([[11, 15, 2, 1.2, INK.ink], [19, 15, 2, 1.2, INK.ink]] satisfies Shape[])),
    ...legs,
    // Das Handy: dunkle Hülle, das Display leuchtet.
    [25.6, 12, 2.8, 4.6, INK.boot],
    [26, 12.5, 2, 3.6, SCREEN],
  ]
}
function idlerPx(comfort: number, step: number, tick: number, isBlink = false): string {
  // Eine Zeile scrollt über das Display.
  const shape = pxOf(idlerShapes(comfort, step, isBlink)) + px(26, 12.6 + (tick % 4) * 0.8, 2, 0.4, '#FFFFFF', ' fill-opacity="0.8"')
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

  // Im Leerlauf: Seifenblasen mit Glanzpunkt, die oben zerplatzen.
  const rim = colors.isLight === true ? INK.glassEdge : '#FFFFFF'
  const bubbles = isHere
    ? bubblesAt(scene.idle)
        .map(({ x, y, isPopping }) =>
          isPopping
            ? [[-1.2, -0.6], [1.2, -0.4], [0, -1.4]].map(([dx, dy]) => `<circle cx="${(x + (dx ?? 0)).toFixed(1)}" cy="${(y + (dy ?? 0)).toFixed(1)}" r="0.35" fill="${rim}" fill-opacity="0.7"/>`).join('')
            : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.5" fill="${colors.suggestion}" fill-opacity="0.15" stroke="${rim}" stroke-opacity="0.75" stroke-width="0.35"/><circle cx="${(x - 0.4).toFixed(1)}" cy="${(y - 0.4).toFixed(1)}" r="0.35" fill="${rim}"/>`,
        )
        .join('')
    : ''

  return rain + notes + steam + bubbles
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
  } else {
    back.push(showerBackSvg(colors))
    front.push(showerSvg(scene, colors, isHere))
  }

  // Die Anfahrt: Clawd läuft von links herein und trägt, was er braucht.
  let clawd = ''
  if (arrival >= 0) {
    const walked = Math.min(1, arrival / ARRIVE.in)
    const step = walked < 1 ? arrival : 0
    const walker = role === 'tap' ? idlerPx(0, step, tick) : clawdPx(role, step) + (walked < 1 ? towelPx : '')
    clawd = `<g transform="translate(${(-32 * (1 - walked)).toFixed(1)} 0)">${walker}</g>`
  } else if (role === 'tap') {
    clawd = idlerPx(comfortOf(level), 0, tick, isBlinking(scene.idle))
  } else {
    clawd = clawdPx(role, 0, isOn || isBlinking(scene.idle))
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
      p.shapes(idlerShapes(0, 0, isBlinking(scene.idle)))
    } else if (comfort === 1) {
      p.within(moved(0, 2), () => p.shapes(idlerShapes(1, 0, isBlinking(scene.idle))))
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
      p.within(times(moved(3, 3), turned(-24, 16, 22)), () => p.shapes(idlerShapes(2, 0, isBlinking(scene.idle))))
    }
  } else {
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
      p.shapes(clawdShapes('shower', 0, isOn || isBlinking(scene.idle)))
      // Seifenblasen: je ein Pixel, beim Platzen nur noch ein Hauch.
      for (const { x, y, isPopping } of bubblesAt(scene.idle)) p.rect(x - 1, y - 1, 2, 2, withAlpha(isLight ? INK.glassEdge : '#FFFFFF', isPopping ? 0.3 : 0.8), 3)
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
  }

  return p.grid
}

export function sceneAlt(scene: Scene): string {
  const { role, water, arrival, level } = scene
  if (arrival >= 0) {
    const arriving: Record<Role, string> = {
      tap: 'Clawd walking in, eyes on the phone',
      shower: 'Clawd walking in with a towel',
    }
    return arriving[role]
  }
  const isOn = water !== null
  if (role === 'tap') {
    const where = ['next to the sink', 'on a stool', 'in a deck chair', 'in a deck chair under a parasol'][comfortOf(level)]
    if (isOn) return `Clawd on the phone ${where}, the tap ${scene.strength >= 2 ? 'runs' : 'drips'} into the drain`
    return `Clawd on the phone ${where}`
  }
  const steam = level >= 6 ? ' in thick steam' : ''

  return isOn ? `Clawd singing in the shower${steam}` : `Clawd in a shower cap under the shower${steam}`
}
