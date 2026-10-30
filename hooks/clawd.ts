// Clawd neben dem Preis. Pro Sitzung wird eine von zwei Rollen ausgelost; in jeder steht das Tempo
// für die Tokens pro Sekunde (nur solange gestreamt wird) und die Größe für die Sitzung. Zu
// Beginn und nach einer langen Pause kommt er erst an. Das Thema: KI verschwendet Wasser, jede
// Antwort kostet ein paar Schlucke; unter jeder Szene stehen die Liter.
//   Hahn:    in den Apps ein Wasserspender: ein Schlauch führt zu Clawds Laptop, der beim
//            Tippen dampft; der Ballon leert sich mit den Litern, leere liegen daneben. Im
//            Terminal noch der Hahn, das Wasser läuft auf den Boden in eine Pfütze.
//   Dusche:  Clawd tippt unter der Dauerdusche, der Dampf wird mit der Sitzung dichter.
// Clawd sieht aus wie im Logo von Claude Code und tippt, solange Claude arbeitet.
// Am Wasserspender blendet er von vorn ein, zwinkert, holt den Laptop hinter dem Rücken hervor,
// stellt ihn links ab und tippt von der Seite, so schnell wie die Tokens pro Sekunde kommen;
// danach packt er ihn wieder weg und ruht von vorn (siehe DESK).
// Pool, Wanne und See gab es bis 0.18.0.

export type Color = 'claude' | 'error' | 'warning' | 'suggestion' | 'inactive' | 'success'
export type Piece = { text: string; color?: Color; dim?: boolean }

export const ROLES = ['tap', 'shower'] as const
export type Role = (typeof ROLES)[number]
// Für /clawd: englisch wie die Leiste, die deutschen Wörter gehen auch.
export const ROLE_WORDS: Record<Role, string[]> = {
  tap: ['tap', 'hahn', 'wasserhahn', 'spender', 'wasserspender', 'cooler', 'abfluss', 'drain', 'handy', 'phone'],
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
// Am Hahn statt der Anfahrt: bis Takt `closed` liegt der Deckel zu, bis `open` geht er auf,
// danach tippt Clawd; in den Haltetakten dreht er nebenbei den Hahn auf.
export const LID = { closed: 2, open: 7 }
// Wie weit der Deckel offen ist, 0 bis 1; angekommen ist er offen.
export const lidOf = (arrival: number) =>
  arrival < 0 ? 1 : Math.max(0, Math.min(1, (arrival - LID.closed) / (LID.open - LID.closed)))
// Kommt Clawd zu Fuß? Am Hahn steht er schon da.
export const isWalking = (role: Role, arrival: number) => arrival >= 0 && role !== 'tap'

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
  // Milliliter pro Sekunde, solange gestreamt wird: so dick ist der Strahl am Hahn
  mlPerSecond?: number
  // Anschläge auf der Tastatur, im Tempo der Tokens pro Sekunde; fehlt er, tippt er im Takt des Wassers
  keys?: number
  // Am Wasserspender die Milliliter der Sitzung: so weit ist der Ballon leer, so viele liegen daneben
  ml?: number
  // Am Wasserspender in den Apps: das Bild aus dem Ablauf DESK; fehlt es, folgt es der Arbeit
  desk?: number
}
// Der Strahl am Hahn wächst stufenlos mit den Litern pro Sekunde: 4,5 ml/s (40 Tokens/s) sind
// knapp 1 Einheit, 22,5 ml/s (200) rund 2, ab gut 40 ml/s 3,5. Ohne Messung wie die Stärke.
export const jetWidth = (scene: Scene) =>
  scene.mlPerSecond === undefined || scene.mlPerSecond <= 0
    ? scene.strength === 3
      ? 2
      : 1.1
    : Math.max(0.7, Math.min(3.5, 0.5 + scene.mlPerSecond * 0.07))

// Der Leerlauf: steht Clawd da und es streamt nichts, läuft eine ruhige Schleife von 15 s im
// Halbsekundentakt. Er blinzelt zweimal; am Hahn scrollt er weiter, und der Hahn ist nie ganz zu:
// einmal je Schleife tropft er in die Pfütze. Unter der Dusche shampooniert er sich, Seifenblasen
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

    return [{ x: 32 + t * 5 + (phase % 2) * 0.6, y: 12 - t * 6.5, isPopping: phase === 6 }]
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
// Am Hahn zählt die Größe in Litern der Sitzung: 1 sobald etwas lief, dann je eine Stufe mehr
// Pfütze ab 1, 5 und 20 L.
const COMFORT_AT = [1_000, 5_000, 20_000]
export const tapLevel = (ml: number) => (ml < 0.5 ? 0 : 1 + COMFORT_AT.filter(at => ml >= at).length)

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
// Was Clawd beim Herlaufen trägt: das Handy oder ein Handtuch.
const CARRIED: Record<Role, Piece> = {
  tap: { text: '▮', color: 'suggestion' },
  shower: { text: '▬', color: 'error' },
}

// Was eine Rolle zeichnet: den Kopf in der Leiste, Clawds zwei Zeilen und rechts die Szene.
type Parts = { head: Cell[]; slots: Cell[][]; rights: Cell[][] }

// Hahn: der Hahn hängt in der Leiste (Spalten 7 bis 9), das Wasser fällt in Spalte 8 auf den
// Boden, wo eine Pfütze steht, sobald etwas lief. Clawd steht am Laptop in Spalte 7; beim
// Ankommen klappt er ihn auf, dann tippt er, statt es sich bequem zu machen.
export const isTapOpen = (arrival: number) => arrival < 0 || arrival > ARRIVE.in
// Der Laptop im Terminal, wie weit er aufgeklappt ist: zu liegt er flach, offen leuchtet er.
const LID_CELLS = ['▁', '▂', '▄', '▆', '▮']
// Beim Tippen schnellt abwechselnd ein Ärmchen hoch.
const TYPING_CLAWD = ['▗▛███▜▌', '▐▛███▜▖']
function tapParts(scene: Scene): Parts {
  const { water, strength, level, arrival } = scene
  const head = [...blank(7), ...cellsOf(isTapOpen(arrival) ? TAP_OPEN : TAP_SHUT), ...cellsOf(TAP)]
  const typing = typingOf(scene)
  const lid = lidOf(arrival)
  const screen: Cell =
    lid < 1
      ? { ch: LID_CELLS[Math.floor(lid * (LID_CELLS.length - 1))] ?? '▁', color: 'inactive' }
      : { ch: '▮', color: 'suggestion', dim: typing < 0 }
  const top: Cell[] = [...cellsOf([{ text: TYPING_CLAWD[typing] ?? '▐▛███▜▌', color: 'claude' }]), screen, BLANK]
  const { tick } = scene
  const low: Cell[] = cellsOf(LEGS).slice(0, 7)
  const right: Cell[] = []
  const puddle: Cell = level === 0 && water === null ? BLANK : { ch: '▁', color: 'suggestion', dim: true }
  let drain = puddle
  if (water !== null) {
    if (strength <= 1) {
      if (water.drop !== null) top[8] = { ch: water.cell, color: 'suggestion' }
      if (water.isSplash) drain = { ch: ',', color: 'suggestion' }
    } else {
      // Läuft und sprudelt: ein Strahl, dessen Striche wandern; in der Pfütze strudelt es.
      top[8] = { ch: strength === 3 ? (tick % 2 === 0 ? '┃' : '╏') : tick % 2 === 0 ? '│' : '╎', color: 'suggestion' }
      drain = { ch: tick % 2 === 0 ? '◌' : '○', color: 'suggestion' }
      if (strength === 3) put(right, 1, { ch: tick % 2 === 0 ? '˙' : '·', color: 'suggestion' })
    }
  }
  low.push(puddle, drain)

  return { head, slots: [top, low], rights: [right, [puddle]] }
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

// Dusche: neben Clawd der Brausekopf am Rohr (Spalten 7 und 8); das Wasser prasselt in Spalte 7
// neben ihm herab.
// Der Dampf wächst mit der Sitzung, erst unten, dann auch oben.
function showerParts(scene: Scene): Parts {
  const { water, strength, tick, level } = scene
  const head: Cell[] = [...blank(7), { ch: '┳', color: 'inactive' }, { ch: '┓', color: 'inactive' }]
  const top = cellsOf(CLAWD)
  const low = cellsOf(LEGS)
  top[8] = { ch: '┃', color: 'inactive' }
  low[8] = { ch: '┃', color: 'inactive' }
  falling(water, strength, tick, [top, low], 7)
  if (water !== null && water.isSplash) low[7] = { ch: ',', color: 'suggestion' }
  const steam = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => ({ ch: (i + tick) % 3 === 0 ? '▒' : '░', color: 'inactive', dim: true }) satisfies Cell)
  const rights = [steam(level - 3), steam(level)]
  // Im Leerlauf steigen rechts neben dem Rohr Seifenblasen auf.
  for (const bubble of bubblesAt(scene.idle)) {
    put(rights[0] ?? [], Math.round((bubble.x - 32) / 3), { ch: bubble.isPopping ? '˙' : bubble.y > 6 ? 'o' : '°', color: 'suggestion' })
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

  if (isWalking(role, arrival)) {
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
// In der Leiste der Apps steht die Szene 2-fach (120 × 54): auf Retina vier Gerätepixel je
// Szenenpixel, also scharf, und groß genug, dass man Clawd gut erkennt. Wird es eng, steht er
// 1,5-fach (90 × 41; die halbe Zeile zu 41 bleibt unten frei, preserveAspectRatio oben bündig),
// gestapelt 1,5-fach, damit die Leiste flach bleibt; im ganz schmalen Panel 1-fach (60 × 27).
// Ein engerer Ausschnitt ginge nicht: Dampf und Pfütze reichen bis an den Rand.
export const appScene = (scale: number) => ({ width: SCENE_VIEW.width * scale, height: Math.ceil(SCENE_VIEW.height * scale) })
export const APP_LARGE = 2
export const APP_SMALL = 1.5
export const APP_TINY = 1
export const APP_SCENE = appScene(APP_LARGE)
export const APP_SCENE_FLAT = appScene(APP_SMALL)
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

// Clawd wie im Logo von Claude Code (▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝), quadratisch gerastert:
// 16 × 10 Pixel zu je 2 Einheiten, die Füße auf y 26. Breiter Körper, hohe schmale Augen,
// die Ärmchen seitlich, vier dünne Beine.
const TOWEL = '#F4F1EA'
// Ein Pixelrechteck der Szene: x, y, Breite, Höhe, Farbe. Svg und die Box-Pixel für VS Code
// zeichnen aus denselben Listen.
type Shape = [number, number, number, number, string]
const pxOf = (shapes: Shape[]) => shapes.map(([x, y, w, h, c]) => px(x, y, w, h, c)).join('')
// `step` hebt beim Gehen jedes zweite Bein; `typing` 0 oder 1 hebt beim Tippen abwechselnd ein
// Ärmchen (-1 ruht); `isLit`: das Display leuchtet, die Oberkante des Deckels glimmt.
type Pose = { step?: number; isBlink?: boolean; typing?: number; isLit?: boolean }
function clawdShapes({ step = 0, isBlink = false, typing = -1 }: Pose): Shape[] {
  const lift = (i: number) => (step % 2 === 1 && i % 2 === 1 ? 2 : 0)
  const eyes: Shape[] = isBlink
    ? [[10, 12, 2, 2, INK.ink], [24, 12, 2, 2, INK.ink]]
    : [[10, 10, 2, 4, INK.ink], [24, 10, 2, 4, INK.ink]]

  return [
    [6, 6, 24, 16, INK.clay],
    [2, typing === 0 ? 11 : 14, 4, 4, INK.clay],
    [30, typing === 1 ? 11 : 14, 4, 4, INK.clay],
    ...eyes,
    ...[8, 12, 22, 26].map((x, i): Shape => [x, 22, 2, 4 - lift(i), INK.clay]),
  ]
}
// Der Laptop, aufgeklappt vor ihm: von vorn sieht man den Deckel, darunter die Tastatur.
const SCREEN = '#9FD8FF'
function laptopOf({ isLit = false }: Pose): Shape[] {
  const shapes: Shape[] = [[10, 15.6, 16, 4.4, '#C9C7C0'], [8, 20, 20, 1.4, '#8D8B85']]

  return isLit ? [...shapes, [10, 15.6, 16, 0.8, SCREEN]] : shapes
}
const LAPTOP = laptopOf({})
const clawdPx = (pose: Pose) => crisp(pxOf([...clawdShapes(pose), ...laptopOf(pose)]))

// Am Wasserspender spielt Clawd einen festen Ablauf, Bild für Bild aus der Vorlage abgetastet:
// je 2 Einheiten ein Pixel, 16 breit und 16 hoch, x 0 ist seine linke Körperkante, y 0 sein Kopf.
// Grau ist der Laptop, links neben ihm am Boden; die Bilder stehen im Takt von 90 ms.
const CLAY_SIDE = '#B5583C'
const shapeIn = (color: string) => (x: number, y: number, w: number, h: number): Shape => [x, y, w, h, color]
const clay = shapeIn(INK.clay)
const shade = shapeIn(CLAY_SIDE)
const dark = shapeIn(INK.ink)
const metal = shapeIn(INK.concreteTop)
const frontLegs = [0, 4, 10, 14].map(x => clay(x, 12, 2, 4))
const frontBody = [clay(0, 0, 16, 12), ...frontLegs]
const frontEyes = (y: number) => [dark(2, y, 2, 2), dark(12, y, 2, 2)]
// Von vorn: die Ärmchen seitlich, beim Blinzeln nur noch ein Strich.
const frontOf = (isBlink: boolean) => [...frontBody, clay(-4, 4, 4, 4), clay(16, 4, 4, 4), ...(isBlink ? [dark(2, 3, 2, 1), dark(12, 3, 2, 1)] : frontEyes(2))]
// Halb gedreht: das rechte Ärmchen oben, das linke unten; beim Zwinkern das rechte Auge ein Strich.
const turnedOf = (isWink: boolean, armAt = -3) => [
  ...frontBody,
  clay(16, 2, 4, 4),
  clay(armAt, 7, -armAt, 4),
  dark(2, 3.5, 2, 2.5),
  isWink ? dark(11, 4.5, 3, 1) : dark(12, 3.5, 2, 2.5),
]
// Der abgestellte Laptop: Deckel schräg nach links oben, Unterteil am Boden.
const laptopAt = (dy = 0) => [
  metal(-13, 10 + dy, 1, 1),
  metal(-13, 11 + dy, 2, 1),
  metal(-12, 12 + dy, 2, 1),
  metal(-11, 13 + dy, 2, 1),
  metal(-10, 14 + dy, 2, 1),
  metal(-9, 15 + dy, 6, 1),
]
// Von der Seite: die rechte Seite im Schatten, die Beine im Schritt versetzt.
const sideLegs = [-2, 2, 8, 12].flatMap((x, i) => {
  const leg = i === 3 ? shade : clay

  return [leg(x, 13, 2, 1), leg(x, 14, 3, 1), leg(x + 1, 15, 2, 1)]
})
const sideBody = [clay(-2, 2, 12, 11), shade(10, 2, 4, 11), dark(-2, 4.5, 2, 2.5), dark(5, 4.5, 2, 2.5), ...sideLegs]
// Beim Tippen drei Bilder: das vordere Ärmchen und das hintere (im Schatten) wechseln sich ab,
// beim ersten wippt der Laptop ein Stück hoch.
const TYPING: Shape[][] = [
  [...laptopAt(-1), ...sideBody, clay(-5, 7, 3, 1), clay(-6, 8, 4, 4)],
  [...laptopAt(), ...sideBody, clay(-5, 7, 3, 4), shade(-6, 12, 4, 3)],
  [...laptopAt(), ...sideBody, shade(-6, 7, 4, 2.5), clay(-6, 9.5, 4, 3.5)],
]
const FRONT = frontOf(false)
const WINK = turnedOf(true)
const SWING = [
  metal(-12, 3, 2, 1),
  metal(-13, 4, 4, 1),
  metal(-13, 5, 5, 1),
  metal(-12, 6, 4, 1),
  metal(-11, 7, 9, 1),
  metal(-9, 8, 5, 1),
  ...frontBody,
  clay(16, 4, 4, 4),
  clay(-3, 5, 3, 3),
  clay(-4, 8, 4, 4),
  ...frontEyes(3),
]
// Der ganze Ablauf: einblenden, zwinkern, Laptop hervorholen, abstellen, drehen, tippen (dort
// hält er), wegpacken, von vorn ruhen. Beim Tippen zeigt TYPING das Bild.
const DESK_FRAMES: Shape[][] = [
  FRONT,
  FRONT,
  FRONT,
  WINK,
  WINK,
  WINK,
  WINK,
  WINK,
  // Der Laptop kommt hinter dem Rücken hervor, über die Schulter und im Bogen nach unten.
  [metal(-3, -3, 2, 1), metal(-5, -2, 4, 1), metal(-8, -1, 5, 1), metal(-8, 0, 3, 1), metal(-8, 1, 7, 1), ...frontBody, clay(16, 5, 4, 4), clay(-4, 2, 4, 3), clay(-3, 5, 3, 1), clay(-2, 6, 2, 1), ...frontEyes(2)],
  [metal(-7, -7, 1, 6), metal(-7, -2, 6, 1), ...frontBody, clay(16, 5, 4, 4), clay(-4, -1, 2.5, 3), clay(-4, 0, 4, 2), ...frontEyes(2)],
  SWING,
  SWING,
  [...laptopAt(), ...frontBody, clay(16, 5, 4, 4), clay(-4, 9, 4, 4), ...frontEyes(3)],
  // Er rutscht flach auf, dann reißt Clawd die Ärmchen hoch und dreht sich zur Seite.
  [metal(-14, 12, 2, 1), metal(-12, 13, 2, 1), metal(-10, 14, 2, 1), metal(-9, 15, 6, 1), ...frontBody, clay(16, 3, 4, 4), clay(-4, 4, 4, 4), ...frontEyes(3)],
  [...laptopAt(), clay(-2, -4, 4, 4), clay(8, -4, 4, 4), clay(-3, -1, 16, 3), shade(13, -1, 2, 3), clay(-1, 2, 14, 10), shade(13, 2, 2, 10), dark(-1, 3, 2, 2), dark(9, 3, 2, 2), ...[-1, 3, 9, 13].map(x => clay(x, 12, 2, 4))],
  [...laptopAt(), clay(-2, 1, 12, 12), shade(10, 1, 4, 12), clay(-6, 3, 4, 4), dark(-3, 4, 2, 2), dark(5, 4, 2, 2), clay(-6, 10, 4, 4), ...sideLegs],
  TYPING[0] ?? [],
  // Wegpacken: der Deckel klappt zu, der Laptop verschwindet unter dem Ärmchen.
  [metal(-12, 6, 1, 1), metal(-12, 7, 2, 1), metal(-11, 8, 2, 1), metal(-10, 9, 2, 1), metal(-9, 10, 2, 1), metal(-8, 11, 2, 1), clay(-1, 1, 12, 12), shade(11, 1, 4, 12), clay(-5, 3, 4, 4), dark(-1, 4, 2, 2), dark(6, 4, 2, 2), clay(-6, 10, 6, 4), ...sideLegs],
  [metal(-4, 5, 1, 1), metal(-5, 6, 1, 1), metal(-7, 7, 2, 1), metal(-8, 8, 2, 2), metal(-8, 10, 6, 1), clay(0, 0, 14, 12), shade(14, 0, 2, 12), clay(16, 5, 3, 4), clay(-4, 8, 4, 3), dark(0, 3, 2, 2), dark(9, 3, 2, 2), ...frontLegs.slice(0, 3), shade(14, 12, 2, 4)],
  turnedOf(false),
  turnedOf(false),
  turnedOf(false, -2),
  FRONT,
]
// Die Marken im Ablauf: `wink` ist der Einstieg, wenn er schon dasteht; beim Tippen hält der Takt.
export const DESK = { wink: 3, typing: 16, tuck: 17, rest: DESK_FRAMES.length - 1 }
const DESK_FADE = [0.25, 0.55, 0.85]
export const deskOf = (scene: Scene) => scene.desk ?? (typingOf(scene) >= 0 ? DESK.typing : DESK.rest)
// Clawds Formen in der Szene: die Füße auf y 26, der Laptop reicht bis x 3.
function deskShapes(scene: Scene): Shape[] {
  const desk = deskOf(scene)
  const isBlink = desk === DESK.rest && isBlinking(scene.idle)
  const shapes = desk === DESK.typing ? TYPING[(scene.keys ?? scene.tick) % TYPING.length] : isBlink ? frontOf(true) : DESK_FRAMES[desk]

  return (shapes ?? FRONT).map(([x, y, w, h, c]): Shape => [x + 16, y + 10, w, h, c])
}
const deskOpacity = (scene: Scene) => DESK_FADE[deskOf(scene)] ?? 1
// Was Clawd unter die Dusche mitbringt: ein Handtuch über der Schulter.
const TOWEL_SHAPES: Shape[] = [[4, 6, 8, 1.2, TOWEL], [4, 7.2, 2, 7, TOWEL], [4, 11, 2, 0.6, INK.red]]
const towelPx = crisp(pxOf(TOWEL_SHAPES))
// Arbeitet Claude, tippt er, abwechselnd links und rechts (0 oder 1), sonst -1; im Leerlauf
// (idle ab 0) ruht er, auch wenn der Hahn tropft. Im Terminal legt er am Hahn los, sobald der
// Deckel offen ist.
export function typingOf(scene: Scene): number {
  const { arrival } = scene
  if (arrival >= 0) return scene.role === 'tap' && arrival > LID.open ? arrival % 2 : -1
  const isWorking = scene.water !== null && (scene.idle ?? -1) < 0

  return isWorking ? (scene.keys ?? scene.tick) % 2 : -1
}
const poseOf = (scene: Scene): Pose => {
  const typing = typingOf(scene)

  return { isBlink: typing < 0 && isBlinking(scene.idle), typing, isLit: typing >= 0 }
}

const splashSvg = (x: number, y: number, colors: SceneColors) =>
  `<ellipse cx="${x}" cy="${y}" rx="2.5" ry="0.9" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.6" stroke-width="0.7"/><circle cx="${x - 1.5}" cy="${y - 2}" r="0.6" fill="${colors.suggestion}" fill-opacity="0.7"/><circle cx="${x + 1.5}" cy="${y - 2.5}" r="0.6" fill="${colors.suggestion}" fill-opacity="0.7"/>`

// Wasserspender (die Rolle heißt intern weiter `tap`): rechts steht ein Spender mit einem
// Ballon zu JUG_ML, ein Schlauch führt am Boden zu Clawds Laptop. Solange Claude arbeitet,
// fließt das Wasser durch den Schlauch, im Ballon steigen Blasen auf, und über dem Laptop
// verdampft es wie im Rechenzentrum. Der Ballon leert sich mit den Litern der Sitzung; ist er
// leer, kommt ein voller, und der leere liegt daneben (höchstens drei).
export const JUG_ML = 1_000
export const jugOf = (ml: number) => ({ fill: 1 - (Math.max(0, ml) % JUG_ML) / JUG_ML, empties: Math.min(3, Math.floor(Math.max(0, ml) / JUG_ML)) })
const JUG = { x: 46, y: 4, width: 8, height: 12 }
const standOf = (isLight: boolean): Shape[] => [
  [45, 17, 10, 9, isLight ? INK.concreteTop : INK.silver],
  [45, 17, 10, 1, INK.concrete],
  [44, 25.4, 12, 0.6, INK.concrete],
  [48.5, 16, 3, 1, INK.concrete],
  [46.5, 19.5, 1.6, 1.2, INK.denim],
  [51.9, 19.5, 1.6, 1.2, INK.red],
]
// Leere Ballons liegen rechts vom Spender übereinander, der Hals zeigt nach außen.
const emptiesOf = (n: number): Shape[] =>
  Array.from({ length: n }, (_, i): Shape[] => [[55.6, 23.6 - i * 2.2, 3.4, 2, INK.glassEdge], [59, 24.1 - i * 2.2, 0.8, 1, INK.glassEdge]]).flat()
// Der Schlauch: vom Spender schräg hinab, vor Clawds Füßen am Boden entlang und von hinten in
// den Laptop. Durchsichtig bläulich, damit er sich vom grauen Unterteil abhebt.
const HOSE: [number, number][] = [[45, 22.5], [42, 26.6], [14, 26.6], [13, 25.6]]
const HOSE_COLOR = INK.glassEdge
const hosePath = HOSE.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
// So dick fließt es im Schlauch, mit den Litern pro Sekunde.
export const hoseWidth = (scene: Scene) => Math.round((0.3 + jetWidth(scene) * 0.3) * 100) / 100
// Die Blasen im Ballon: je Stärke eine mehr; sie steigen bis an den Wasserspiegel.
function jugBubbles(scene: Scene, top: number): { x: number; y: number }[] {
  const isFlowing = scene.water !== null && (scene.idle ?? -1) < 0
  const idle = scene.idle ?? -1
  const list = isFlowing
    ? Array.from({ length: scene.strength + 1 }, (_, k) => ({ x: 48 + (k % 3) * 1.8, y: 15.4 - ((scene.tick + k * 3) % 8) * 1.4 }))
    : idle >= 12 && idle <= 15
      ? [{ x: 50, y: 15.4 - (idle - 12) * 2 }]
      : []

  return list.filter(b => b.y > top + 0.6)
}
// Der Dampf über dem Laptop: je Stärke eine Schwade mehr, sie steigen auf.
// Durch den Schlauch fließt es nur, wenn der Laptop steht und Clawd tippt.
const isFlowingIn = (scene: Scene) => scene.water !== null && (scene.idle ?? -1) < 0 && deskOf(scene) === DESK.typing
const VAPOR: [number, number, number][] = [[6, 17, 1.4], [4.5, 13.5, 2], [7, 10, 2.4], [4.4, 7.4, 2.6]]
const vaporOf = (scene: Scene) =>
  isFlowingIn(scene) ? VAPOR.slice(0, scene.strength + 1).map(([x, y, r]): [number, number, number] => [x, y - (scene.tick % 3) * 0.7, r]) : []

function coolerSvg(scene: Scene, colors: SceneColors): { back: string; front: string } {
  const isLight = colors.isLight === true
  const { fill, empties } = jugOf(scene.ml ?? 0)
  const top = JUG.y + JUG.height * (1 - fill)
  const hose = `<path d="${hosePath}" fill="none" stroke="${HOSE_COLOR}" stroke-width="1.1" stroke-linejoin="round"/>`
  const flow = isFlowingIn(scene)
    ? `<path d="${hosePath}" fill="none" stroke="${colors.suggestion}" stroke-width="${hoseWidth(scene)}" stroke-dasharray="1.4 0.8" stroke-dashoffset="${(-(scene.tick % 4) * 0.55).toFixed(2)}"/>`
    : ''
  const jug =
    crisp(pxOf([...standOf(isLight), ...emptiesOf(empties)])) +
    `<rect x="${JUG.x}" y="${JUG.y}" width="${JUG.width}" height="${JUG.height}" rx="1.5" fill="${INK.glass}" fill-opacity="0.3"/>` +
    (fill > 0 ? `<rect x="${JUG.x}" y="${Math.round(top * 100) / 100}" width="${JUG.width}" height="${Math.round((JUG.y + JUG.height - top) * 100) / 100}" fill="${colors.suggestion}" fill-opacity="0.85"/>` : '') +
    `<rect x="${JUG.x}" y="${JUG.y}" width="${JUG.width}" height="${JUG.height}" rx="1.5" fill="none" stroke="${INK.glassEdge}" stroke-width="0.4"/>` +
    jugBubbles(scene, top).map(({ x, y }) => `<circle cx="${x}" cy="${y.toFixed(1)}" r="0.55" fill="none" stroke="#FFFFFF" stroke-width="0.3"/>`).join('')
  const puff = isLight ? INK.concrete : '#FFFFFF'
  const vapor = vaporOf(scene)
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y.toFixed(1)}" r="${r}" fill="${puff}" fill-opacity="0.4"/>`)
    .join('')

  return { back: hose + flow + jug, front: vapor }
}

// Dusche: hinten das Rohr mit rotem Drehknopf, oben der Brausekopf über Clawd, unten die
// Duschwanne. Das Wasser prasselt auf seinen Kopf und rinnt an ihm herab; er tippt weiter.
// Der Dampf wird mit der Sitzung dichter, bis Clawd fast verschwindet.
// Der Brausekopf hängt oben am Rand (y 3 bis 4,2), mit Luft bis zu Clawds Kopf (y 6).
const BRAUSE = { left: 11, right: 25, y: 4.2 }
function showerBackSvg(colors: SceneColors): string {
  return (
    crisp(
      [
        px(36, 3, 1.6, GROUND - 3, INK.concrete),
        px(18, 3, 19.6, 1.2, INK.concreteTop),
        px(17.4, 3, 1.2, 1.6, INK.concreteTop),
        px(0.5, GROUND - 1, 38, 1, colors.isLight === true ? INK.concrete : TOWEL),
      ].join(''),
    ) +
    `<path d="M${BRAUSE.left} ${BRAUSE.y} L${BRAUSE.right} ${BRAUSE.y} L${BRAUSE.right - 1.5} ${BRAUSE.y - 1.2} L${BRAUSE.left + 1.5} ${BRAUSE.y - 1.2} Z" fill="${INK.concreteTop}"/>` +
    `<circle cx="36.8" cy="16" r="1.3" fill="${INK.red}"/>`
  )
}
// Die Dampfschwaden ziehen um Clawd herum; sein Gesicht (x 8 bis 28, y 8 bis 16) bleibt frei.
const STEAM_PUFFS: [number, number, number][] = [[3, 24, 3], [33, 22, 3.5], [2, 8, 2.6], [34, 9, 3], [18, 27, 3], [1, 16, 2.4], [42, 14, 4], [28, 26, 3], [16, 3, 2.5], [44, 5, 4]]
function showerSvg(scene: Scene, colors: SceneColors, isHere: boolean): string {
  const { water, strength, tick, level } = scene
  const wet = `fill="${colors.suggestion}"`
  let rain = ''
  if (isHere && water !== null) {
    const drop = water.drop
    if (drop !== null) {
      // Tropfen: laufen ihm abwechselnd links und rechts herab.
      rain = [4.5, 31.5]
        .filter((_, i) => i % 2 === tick % 2)
        .map(x => `<ellipse cx="${x}" cy="${(7 + drop * 7).toFixed(1)}" rx="0.5" ry="0.8" ${wet} fill-opacity="0.9"/>`)
        .join('')
    } else if (water.jet > 0) {
      const width = strength === 3 ? 0.8 : 0.5
      rain = [13, 16, 19, 22]
        .map(x => `<path d="M${x} ${BRAUSE.y} L${x} 6.5" stroke="${colors.suggestion}" stroke-width="${width}"/>`)
        .join('')
      // Es prasselt auf seinen Kopf und rinnt an beiden Seiten herab bis in die Duschwanne.
      rain += [4.5, 31.5]
        .map(x => `<path d="M${x} 6 L${x} ${GROUND - 1}" stroke="${colors.suggestion}" stroke-opacity="0.7" stroke-width="${width}" stroke-dasharray="1.6 1" stroke-dashoffset="${-(tick % 3) * 0.8}"/>`)
        .join('')
      if (strength === 3) rain += [[9, 5.5], [27, 5], [7, 7]].map(([x, y]) => `<circle cx="${x}" cy="${(y ?? 0) - (tick % 2) * 0.6}" r="0.45" ${wet}/>`).join('')
    } else if (water.isSplash) {
      rain = splashSvg(18, 6, colors)
    }
  }
  // Dampfschwaden: mit jeder Stufe einer mehr und alle dichter, sein Gesicht bleibt frei.
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

  return rain + steam + bubbles
}

export function sceneSvg(scene: Scene, colors: SceneColors): string {
  const { role, water, arrival } = scene
  const isHere = arrival < 0
  const back: string[] = []
  const front: string[] = []

  // Hinten und vorn die Szene, dazwischen Clawd.
  if (role === 'tap') {
    const cooler = coolerSvg({ ...scene, water: isHere ? water : null }, colors)
    back.push(cooler.back)
    front.push(cooler.front)
  } else {
    back.push(showerBackSvg(colors))
    front.push(showerSvg(scene, colors, isHere))
  }

  // Die Anfahrt: Clawd läuft mit dem Laptop von links herein, zur Dusche mit Handtuch.
  let clawd = ''
  const isWalkingIn = isWalking(role, arrival)
  if (isWalkingIn) {
    const walked = Math.min(1, arrival / ARRIVE.in)
    const step = walked < 1 ? arrival : 0
    const walker = clawdPx({ step }) + (role === 'shower' && walked < 1 ? towelPx : '')
    clawd = `<g transform="translate(${(-32 * (1 - walked)).toFixed(1)} 0)">${walker}</g>`
  } else {
    const opacity = role === 'tap' ? deskOpacity(scene) : 1
    const drawn = role === 'tap' ? crisp(pxOf(deskShapes(scene))) : clawdPx(poseOf(scene))
    clawd = opacity < 1 ? `<g opacity="${opacity}">${drawn}</g>` : drawn
  }
  const { x, y, width, height } = SCENE_VIEW
  // Was hereinkommt, blendet am linken Rand weich ein, statt dort hart abgeschnitten zu sein; bis
  // x 2, wo Clawds Ärmchen beginnt, damit er angekommen nicht verblasst.
  const fade =
    isWalkingIn
      ? `<defs><linearGradient id="burn-rand" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="2" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#FFF"/></linearGradient><mask id="burn-einfahrt" maskUnits="userSpaceOnUse" x="-60" y="0" width="180" height="40"><rect x="-60" y="0" width="180" height="40" fill="url(#burn-rand)"/></mask></defs>`
      : ''
  const soft = (inner: string) => (isWalkingIn && inner !== '' ? `<g mask="url(#burn-einfahrt)">${inner}</g>` : inner)

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
  const { role, water, tick, level, arrival } = scene
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

  if (role === 'tap') {
    // Schlauch, Spender mit Ballon und leere Ballons; wie in der Svg.
    const seen = { ...scene, water: isHere ? water : null }
    const { fill, empties } = jugOf(scene.ml ?? 0)
    const top = JUG.y + JUG.height * (1 - fill)
    HOSE.slice(1).forEach(([x, y], i) => {
      const [fx, fy] = HOSE[i] ?? [x, y]
      p.line(fx, fy, x, y, 1.1, HOSE_COLOR)
    })
    if (isFlowingIn(seen)) for (let x = 18 + (tick % 3); x < 42; x += 3) p.rect(x, 25.8, 1.6, 1.6, wet, 2)
    p.shapes([...standOf(isLight), ...emptiesOf(empties)], 3)
    p.rect(JUG.x, JUG.y, JUG.width, JUG.height, withAlpha(INK.glass, 0.35), 3)
    if (fill > 0) p.rect(JUG.x, top, JUG.width, JUG.y + JUG.height - top, wet, 3)
    for (const { x, y } of jugBubbles(seen, top)) p.rect(x - 0.8, y - 0.8, 1.6, 1.6, withAlpha('#FFFFFF', 0.8), 3)
    // Clawd im selben Ablauf wie im Svg; beim Einblenden mit Deckkraft.
    const opacity = deskOpacity(scene)
    p.shapes(deskShapes(scene).map(([x, y, w, h, c]): Shape => [x, y, w, h, opacity < 1 ? withAlpha(c, opacity) : c]), 3)
    for (const [x, y, r] of vaporOf(seen)) p.oval(x, y, r, r, withAlpha(isLight ? INK.concrete : '#FFFFFF', 0.3))
  } else {
    // Rohr, Brausekopf, Duschwanne; der Dampf zieht hinter Clawd, das Gesicht bleibt frei.
    p.rect(36, 3, 1.6, GROUND - 3, INK.concrete, 3)
    p.rect(18, 3, 19.6, 1.2, INK.concreteTop, 3)
    p.rect(BRAUSE.left, BRAUSE.y - 1.2, BRAUSE.right - BRAUSE.left, 1.2, INK.concreteTop, 3)
    p.rect(0.5, GROUND - 1, 38, 1, isLight ? INK.concrete : TOWEL, 3)
    p.oval(36.8, 16, 1.3, 1.3, INK.red, 2)
    const puff = isLight ? INK.concrete : '#FFFFFF'
    for (const [x, y, r] of STEAM_PUFFS.slice(0, Math.min(10, level))) {
      p.oval(x, y, r, r, withAlpha(puff, 0.1 + Math.min(10, level) * 0.03))
    }
    if (!isHere) {
      walkIn(() => {
        p.shapes([...clawdShapes({ step }), ...LAPTOP])
        if (walked < 1) p.shapes(TOWEL_SHAPES, 3)
      })
    } else {
      p.shapes([...clawdShapes(poseOf(scene)), ...laptopOf(poseOf(scene))])
      // Seifenblasen: je ein Pixel, beim Platzen nur noch ein Hauch.
      for (const { x, y, isPopping } of bubblesAt(scene.idle)) p.rect(x - 1, y - 1, 2, 2, withAlpha(isLight ? INK.glassEdge : '#FFFFFF', isPopping ? 0.3 : 0.8), 3)
    }
    if (isOn && water !== null) {
      if (water.drop !== null) {
        for (const x of [4.5, 31.5].filter((_, i) => i % 2 === tick % 2)) p.rect(x - 1, 7 + water.drop * 7, 2, 2, wet, 3)
      } else if (water.jet > 0) {
        for (const x of [13, 17, 21]) p.rect(x - 0.6, 5, 1.2, 1, wet, 2)
        for (let y = 6; y < GROUND - 1; y += 2) if ((y / 2 + tick) % 3 !== 0) for (const x of [4.5, 31.5]) p.rect(x - 0.6, y, 1.2, 2, wet, 2)
      }
    }
  }

  return p.grid
}

export function sceneAlt(scene: Scene): string {
  const { role, arrival, level } = scene
  const isWorking = typingOf(scene) >= 0
  if (role === 'tap') {
    const desk = deskOf(scene)
    if (desk === DESK.typing) return isWorking ? 'Clawd typing fast on his laptop, which drinks from the water cooler and steams' : 'Clawd typing on his laptop next to the water cooler'
    if (desk === DESK.rest) return 'Clawd standing next to the water cooler'
    return desk < DESK.typing ? 'Clawd getting out his laptop' : 'Clawd putting his laptop away'
  }
  if (arrival >= 0) return 'Clawd walking in with his laptop and a towel'
  const steam = level >= 6 ? ' in thick steam' : ''

  return isWorking ? `Clawd typing fast on his laptop under the running shower${steam}` : `Clawd with his laptop under the shower${steam}`
}
