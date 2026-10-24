// Clawd neben dem Preis. Pro Sitzung wird eine Rolle ausgelost; in jeder steht das Tempo
// für die Tokens pro Sekunde (nur solange gestreamt wird) und die Größe für die Tokens der
// Sitzung. Zu Beginn und nach einer langen Pause kommt er erst an.
//   Stausee: Feuerwehr-Clawd füllt ein Becken hinter einer Staumauer, der Strahl schlägt Wellen.
//   Feuer:   Feuerwehr-Clawd löscht ein Feuer, das in den Pausen wieder auflodert.
//   Garten:  Gärtner-Clawd gießt ein Blumenbeet, das mit den Tokens wächst.
//   Regen:   Clawd steht unter dem Schirm, die Wolke wächst mit den Tokens, es regnet im Tempo.
//   Angler:  die Pose wackelt im Tempo, bei viel Tempo beißt einer an; der Eimer füllt sich mit Fischen.
//   Bäcker:  der Ofen glüht im Tempo und dampft; der Brotstapel wächst mit den Tokens.
//   Astronaut: Clawd tankt die Rakete, der Strahl im Tempo, die Tankanzeige mit den Tokens;
//            ganz voll hebt sie beim Tanken kurz ab.

export type Color = 'claude' | 'error' | 'warning' | 'suggestion' | 'inactive' | 'success'
export type Piece = { text: string; color?: Color; dim?: boolean }

export const ROLES = ['reservoir', 'fire', 'garden', 'rain', 'angler', 'baker', 'astronaut'] as const
export type Role = (typeof ROLES)[number]
// Für /clawd: englisch wie die Leiste, die deutschen Wörter gehen auch.
export const ROLE_WORDS: Record<Role, string[]> = {
  reservoir: ['reservoir', 'stausee', 'dam'],
  fire: ['fire', 'feuer'],
  garden: ['garden', 'garten', 'gärtner', 'gaertner'],
  rain: ['rain', 'regen', 'schirm', 'umbrella'],
  angler: ['angler', 'angeln', 'fishing', 'fisher'],
  baker: ['baker', 'bäcker', 'baecker', 'backen'],
  astronaut: ['astronaut', 'rakete', 'rocket', 'space'],
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

// Ab diesen Tokens der Sitzung eine Stufe größer (Pfütze, Stausee, Beet, Wolke), bis Stufe 10.
const SIZE_AT = [1, 50_000, 250_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000]
export const sizeLevel = (n: number) => SIZE_AT.filter(at => n >= at).length

// Das Feuer: 100 brennt voll, 0 ist Glut. Je Takt beim Streamen so viel weniger, je Stärke.
export const HEAT_FULL = 100
export const EXTINGUISH = [0.6, 1.2, 2.5, 4.5]
export const stageOf = (heat: number) => (heat <= 0 ? 0 : Math.min(4, Math.ceil(heat / 25)))

// Die Anfahrt in Takten: hinfahren, halten (Clawd steigt aus), wegfahren. Zu Fuß ohne Wegfahren,
// dafür zieht in den Haltetakten die Wolke auf.
export const ARRIVE = { in: 10, hold: 4, out: 10 }
export const arrivalLength = (role: Role) => ARRIVE.in + ARRIVE.hold + (role === 'rain' ? 0 : ARRIVE.out)
// Wo das Fahrzeug steht: -1 ganz draußen links, 0 an Clawds Platz, 1 rechts hinaus. Es bremst beim
// Ankommen ab und fährt beim Wegfahren langsam an, statt mit gleicher Geschwindigkeit hart zu halten
// und loszuschießen. Terminal und Apps nehmen dieselbe Kurve, damit beide gleich fahren.
export function arrivalShift(arrival: number): number {
  if (arrival < ARRIVE.in) return -((1 - arrival / ARRIVE.in) ** 2)
  if (arrival < ARRIVE.in + ARRIVE.hold) return 0

  return ((arrival - ARRIVE.in - ARRIVE.hold + 1) / ARRIVE.out) ** 2
}
// Räder, Ruder und Kurbel drehen sich nur, solange das Fahrzeug fährt; im Halt stehen sie still.
const rollOf = (arrival: number) => (arrival >= ARRIVE.in && arrival < ARRIVE.in + ARRIVE.hold ? ARRIVE.in : arrival)

export type Scene = {
  role: Role
  // null zugedreht, sonst das Bild aus FLOWS
  water: Flow | null
  // Stärke 0 bis 3 wie FLOWS
  strength: number
  tick: number
  level: number
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

// Alle Kopfbedeckungen sitzen mittig über Clawd (Spalten 0 bis 6, Mitte 3,5), die Krone über
// den Spalten 2 bis 4; nur Krempe, Rute oder Werkzeug reichen in die Spalten 7 und 8.
// Feuerwehrhelm: lange Krempe hinten, vorn das gelbe Abzeichen.
export const HELMET: Piece[] = [{ text: '▂▄▆█', color: 'error' }, { text: '█', color: 'warning' }, { text: '▆▖  ', color: 'error' }]
export const BODY: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '━', color: 'error' }, { text: '╾', color: 'warning' }]
// Die Beine wie im Clawd-Logo: vorne links, hinten rechts angesetzt, also mittig unter ihm.
export const LEGS: Piece[] = [{ text: ' ▘▘ ▝▝   ', color: 'claude' }]
// Im Raumanzug sind die Beine weiß.
const SUIT_LEGS: Piece[] = [{ text: ' ▘▘ ▝▝   ' }]
// Strohhut: flache Krone, breite Krempe; so unterscheidet er sich vom runden Anglerhut.
const STRAW_HAT: Piece[] = [{ text: '▁▂▅▅▅▂▁▁ ', color: 'warning' }]
const GARDENER: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '▆╸', color: 'success' }]
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
// Anglerhut, die Rute aus Holz geht von der Schere schräg nach oben.
const ANGLER_HAT: Piece[] = [{ text: '▃▅███▅▃', color: 'success' }, { text: ' ' }, { text: '╱', color: 'warning' }]
const ANGLER: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '╱', color: 'warning' }, { text: ' ' }]
// Kochmütze: oben gebauscht und breiter als der Bund.
const TOQUE: Piece[] = [{ text: '▝▜███▛▘  ' }]
const BAKER: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '━▬', color: 'warning' }]
// Raumhelm: weiße Kuppel, unten das blaue Visier direkt über den Augen.
const SPACE_HELMET: Piece[] = [{ text: '▗▆' }, { text: '▄▄▄', color: 'suggestion' }, { text: '▆▖  ' }]
const ASTRONAUT: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '═╸', color: 'inactive' }]
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
// Lastenrad vom Bäcker: Hinterrad und Sattel, die Kurbel dreht sich, vorn die Kiste voller Brote.
const cargoBike = (t: number): [Piece[], Piece[]] => [
  [{ text: ' ▬╮ ┃', color: 'inactive' }, { text: '▃▆▃', color: 'warning' }, { text: ' ' }],
  [
    { text: '(●)', color: 'inactive' },
    { text: t % 2 === 0 ? '┼' : '╳', color: 'inactive' },
    { text: '┻', color: 'inactive' },
    { text: '███', color: 'claude' },
    { text: '●', color: 'inactive' },
  ],
]
// Landekapsel: schwebt am roten Schirm heran, steht gelandet als Kegel mit Fenster da
// und startet mit flackerndem Feuerstrahl wieder.
const capsule = (t: number): [Piece[], Piece[]] =>
  t < ARRIVE.in
    ? [
        [{ text: ' ▗▆███▆▖ ', color: 'error' }],
        [{ text: '  ╲', color: 'inactive' }, { text: '▟' }, { text: '▀', color: 'suggestion' }, { text: '▙' }, { text: '╱  ', color: 'inactive' }],
      ]
    : [
        [{ text: '  ▗▟█▙▖  ' }],
        [
          { text: t >= ARRIVE.in + ARRIVE.hold ? (t % 2 === 0 ? '▓' : '▒') : ' ', color: t % 2 === 0 ? 'warning' : 'claude' },
          { text: '▟██' },
          { text: '▀', color: 'suggestion' },
          { text: '██▙ ' },
        ],
      ]
// Traktor: großes Hinterrad mit Nabe, lange Haube mit Auspuff, kleines Vorderrad.
const TRACTOR: [Piece[], Piece[]] = [
  [{ text: '▟▀▙', color: 'inactive' }, { text: '▄▄', color: 'success' }, { text: '╻', color: 'inactive' }, { text: '▄▖', color: 'success' }, { text: ' ' }],
  [{ text: '▜▄▛', color: 'inactive' }, { text: '▀▀▀▀', color: 'success' }, { text: '●', color: 'inactive' }, { text: ' ' }],
]

// Rechts im Bogen nach vorn: Feuerwehr spritzt mit Strichen, die Gießkanne mit Tropfen.
const spray = (water: Flow | null): Cell[] =>
  water === null ? [] : cellsOf([{ text: water.cell, color: 'suggestion' }])
function sprinkle(water: Flow | null): Cell[] {
  if (water === null) return []
  if (water.jet === 0) return cellsOf([{ text: water.cell, color: 'suggestion' }])
  const n = water.cell.length

  return Array.from({ length: n }, (_, i) => ({
    ch: i === n - 1 ? ':' : (i + (water.isSplash ? 1 : 0)) % 2 === 0 ? '·' : '˙',
    color: 'suggestion' as const,
  }))
}
const splashAt = (water: Flow | null) => (water !== null && water.isSplash ? water.land : null)

// Die Pfütze beginnt am Strahlrohr und wächst nach rechts, zur Mitte hin tiefer (ab Stufe 3
// und 6 je eine Stufe). Wo das Wasser aufschlägt, hebt sie sich; neben der Pfütze spritzt es nur.
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

// Der Stausee: zwölf Spalten Becken, dahinter die Mauer. Der Pegel steigt mit den Tokens,
// ganz voll läuft er über. Wo der Strahl auftrifft, schlägt er Wellen.
export const BASIN = 12
const BLOCKS = '▁▂▃▄▅▆▇█'
const POOL_HEIGHT = [0, 1, 1, 2, 3, 4, 5, 6, 7, 7, 7]
export function reservoir(level: number, hit: number | null, tick: number): Cell[] {
  const height = POOL_HEIGHT[Math.min(level, 10)] ?? 0
  const cells: Cell[] = Array.from({ length: BASIN }, () =>
    height === 0 ? { ch: '▁', color: 'inactive' as const, dim: true } : { ch: BLOCKS[height - 1] ?? '▁', color: 'suggestion' as const, dim: true },
  )
  if (hit !== null && hit < BASIN) {
    const wave = (at: number) => {
      if (at < 0 || at >= BASIN) return
      cells[at] = height === 0 ? { ch: ',', color: 'suggestion' } : { ch: BLOCKS[Math.min(height, 7)] ?? '█', color: 'suggestion' }
    }
    wave(hit)
    wave(hit + (tick % 2 === 0 ? 2 : -2))
  }
  cells.push({ ch: '█', color: 'inactive' })
  if (level >= 10) cells.push({ ch: '▁', color: 'suggestion', dim: true }, { ch: tick % 2 === 0 ? ',' : '▁', color: 'suggestion' })

  return cells
}

// Das Feuer in den Spalten 1 bis 5: innen gelb, außen rot, es flackert. Aus ist es Glut,
// darüber Rauch. Trifft der Strahl in die Flammen, ducken sie sich.
const FLAMES: string[][][] = [
  [],
  [['▁', '▂'], ['▂', '▁']],
  [['▃', '▅', '▂'], ['▂', '▅', '▃']],
  [['▂', '▅', '▆', '▃'], ['▃', '▆', '▅', '▂']],
  [['▂', '▅', '█', '▆', '▃'], ['▃', '▆', '█', '▅', '▂']],
]
const FIRE_AT = 1
export function fire(stage: number, flicker: number, hit: number | null): { ground: Cell[]; smoke: Cell[] } {
  if (stage === 0) {
    return {
      ground: [BLANK, { ch: '▁', color: 'error', dim: true }, { ch: '▁', color: 'claude', dim: true }],
      smoke: [...blank(FIRE_AT + (flicker % 2)), { ch: '~', color: 'inactive', dim: true }],
    }
  }
  const shape = FLAMES[stage]?.[flicker % 2] ?? []
  const middle = (shape.length - 1) / 2
  const flames = shape.map((ch, i): Cell => {
    const away = Math.abs(i - middle)
    const ducked = hit === FIRE_AT + i ? (BLOCKS[Math.max(0, BLOCKS.indexOf(ch) - 2)] ?? '▁') : ch

    return { ch: ducked, color: away < 1 ? 'warning' : away < 2 ? 'claude' : 'error' }
  })
  const ground = [...blank(FIRE_AT), ...flames]
  if (hit !== null && (hit < FIRE_AT || hit >= FIRE_AT + shape.length)) {
    while (ground.length <= hit) ground.push(BLANK)
    ground[hit] = { ch: ',', color: 'suggestion' }
  }

  return { ground, smoke: [] }
}

// Das Beet: so breit wie die Pfütze, Blumen und Gras im Wechsel; die ersten Stufen sind Keimlinge.
const BLOOMS: Color[] = ['error', 'warning', 'suggestion', 'claude']
export function bed(level: number, hit: number | null): Cell[] {
  const width = level === 0 ? 0 : 2 * level - 1
  const cells: Cell[] = Array.from({ length: width }, (_, i) =>
    i % 2 === 1
      ? { ch: ',', color: 'success', dim: true }
      : level < 2
        ? { ch: 'ı', color: 'success' }
        : { ch: '✿', color: BLOOMS[(i / 2) % BLOOMS.length] },
  )
  if (hit !== null) {
    while (cells.length <= hit) cells.push(BLANK)
    const was = cells[hit]
    cells[hit] = was === undefined || was.ch === ' ' || was.ch === ',' ? { ch: ',', color: 'suggestion' } : { ...was, dim: false }
  }

  return cells
}

// Die Wolke steht rechtsbündig über dem Schirm und wird mit den Tokens breiter. Innen
// wechseln hohe und niedrige Bäusche, damit sie nach Wolke aussieht und nicht nach Hügel.
const CLOUD_WIDTH = [3, 3, 4, 5, 5, 6, 6, 7, 8, 8, 9]
const PUFFS = '▆█▅▇▆█▅'
export function cloud(level: number, share = 1): Piece[] {
  const full = CLOUD_WIDTH[Math.min(level, 10)] ?? 3
  const width = share <= 0 ? 0 : Math.max(1, Math.round(full * Math.min(1, share)))
  const puffs = width < 3 ? '▄▃'.slice(0, width) : `▃${PUFFS.slice(0, width - 2)}▃`

  return [{ text: ' '.repeat(SLOT - width) }, { text: puffs, color: 'inactive' }]
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
  }

  return [top, low]
}

// Angler: Schnur an Spalte 0, darunter die Pose auf dem Wasser, dahinter der Eimer mit Fischen.
// Je mehr Tempo, desto öfter taucht sie ab; beim stärksten beißt einer an.
function angling(scene: Scene): [Cell[], Cell[]] {
  const { water, strength, tick, level } = scene
  const isOn = water !== null
  const top: Cell[] = [{ ch: '│', color: 'inactive' }]
  const pond: Cell[] = Array.from({ length: 7 }, () => ({ ch: '≈', color: 'suggestion' as const, dim: true }))
  const isDipped = isOn && (strength === 0 ? tick % 4 === 0 : strength === 1 ? tick % 2 === 0 : strength === 2 ? tick % 2 === 0 : true)
  pond[0] = { ch: isDipped ? '◦' : '●', color: 'error' }
  if (isOn && strength >= 2) {
    pond[1] = { ch: '˜', color: 'suggestion' }
    if (strength === 3 && tick % 4 < 2) top.push(BLANK, { ch: '!', color: 'warning' })
  }
  const fish = level === 0 ? [] : cellsOf([{ text: '><>', color: 'warning' }, { text: level > 1 ? `×${level}` : '', color: 'inactive' }])

  return [top, [...pond, BLANK, ...fish]]
}

// Bäcker: gemauerter Ofen in den Spalten 0 bis 4, innen glüht es im Tempo, daneben Dampf;
// dahinter der Brotstapel. Je zwei Spalten ein Laib: unten drei, darüber zwei in den Lücken.
// Jede zweite Stufe ist der nächste Laib erst ein Teigling.
const GLOW = ['▒▒▒', '▒▓▒', '▓█▓', '███']
const LOAF_AT: [row: number, col: number][] = [[1, 0], [1, 2], [1, 4], [0, 1], [0, 3]]
function baking(scene: Scene): [Cell[], Cell[]] {
  const { water, strength, tick, level } = scene
  const isOn = water !== null
  const brick = { color: 'error' as const, dim: true }
  const top: Cell[] = [...cellsOf([{ text: '▗▄▄▄▖', ...brick }]), BLANK, BLANK]
  if (isOn) top[5 + (tick % 2)] = { ch: tick % 2 === 0 ? '˜' : '~', color: 'inactive' }
  const glow = isOn
    ? { text: GLOW[strength] ?? '▒▒▒', color: tick % 2 === 0 ? ('claude' as const) : ('warning' as const) }
    : { text: '░░░', color: 'inactive' as const, dim: true }
  const low = [...cellsOf([{ text: '▐', ...brick }, glow, { text: '▌', ...brick }]), BLANK, BLANK]
  const stack: Cell[][] = [[], []]
  const loaves = Math.min(LOAF_AT.length * 2, level)
  LOAF_AT.forEach(([row, col], i) => {
    const left = loaves - i * 2
    if (left <= 0) return
    const cells: Cell[] = left >= 2 ? cellsOf([{ text: '▟▙', color: 'warning' }]) : cellsOf([{ text: '▗▖' }])
    const line = stack[row] ?? []
    while (line.length < col) line.push(BLANK)
    line.splice(col, 2, ...cells)
  })

  return [[...top, ...(stack[0] ?? [])], [...low, ...(stack[1] ?? [])]]
}

// Astronaut: Treibstoff von der Düse in die Rakete (Spalten 4 bis 6), dahinter die Tankanzeige
// aus fünf Feldern. Ganz voll hebt sie beim Tanken ab und speit Feuer.
function fueling(scene: Scene): [Cell[], Cell[]] {
  const { water, strength, tick, level } = scene
  const isOn = water !== null
  const line: Cell[] = blank(4)
  if (isOn) {
    for (let i = 0; i < 4; i += 1) {
      const ch =
        strength === 3 ? '━' : strength === 2 ? ((i + tick) % 2 === 0 ? '╍' : '┄') : (i + tick) % (strength === 1 ? 2 : 4) === 0 ? '·' : ' '
      line[i] = { ch, color: 'suggestion' }
    }
  }
  const gauge: Cell[] = Array.from({ length: 5 }, (_, i) => {
    const filled = level / 2 - i
    return filled >= 1 ? { ch: '█', color: 'suggestion' } : filled > 0 ? { ch: '▌', color: 'suggestion' } : { ch: '░', color: 'inactive', dim: true }
  })
  const isLifting = isOn && level >= 10 && tick % 4 < 2
  // Wie in den Apps: rote Spitze, weißer Rumpf, rote Flossen.
  const nose = cellsOf([{ text: '▗█▖', color: 'error' }])
  const body = cellsOf([{ text: '▟', color: 'error' }, { text: '█' }, { text: '▙', color: 'error' }])
  const flame: Cell[] = [BLANK, { ch: tick % 2 === 0 ? '▓' : '▒', color: 'claude' }, BLANK]

  return [
    [...line, ...(isLifting ? body : nose)],
    [...blank(4), ...(isLifting ? flame : body), BLANK, ...gauge],
  ]
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
  const { role, water, level, tick, arrival } = scene
  const isFirefighter = role === 'reservoir' || role === 'fire'
  const head = isFirefighter
    ? HELMET
    : role === 'garden'
      ? STRAW_HAT
      : role === 'angler'
        ? ANGLER_HAT
        : role === 'baker'
          ? TOQUE
          : role === 'astronaut'
            ? SPACE_HELMET
            : cloud(level)
  const upper = isFirefighter
    ? BODY
    : role === 'garden'
      ? GARDENER
      : role === 'angler'
        ? ANGLER
        : role === 'baker'
          ? BAKER
          : role === 'astronaut'
            ? ASTRONAUT
            : CANOPY
  const lower = role === 'rain' ? UNDER : role === 'astronaut' ? SUIT_LEGS : LEGS
  let slots = [cellsOf(upper), cellsOf(lower)]
  let headCells = cellsOf(head)
  let rights: Cell[][] = [[], []]

  if (role === 'rain') {
    const isRaining = water !== null
    if (isRaining) {
      const [top, low] = rain(scene.strength, tick)
      slots = slots.map((slot, r) => slot.map((cell, i) => ((r === 0 ? top : low)[i]?.ch !== ' ' ? ((r === 0 ? top : low)[i] ?? cell) : cell)))
    }
    rights = [[], cellsOf([{ text: puddle(level, isRaining && water.isSplash ? 0 : null), color: 'suggestion', dim: true }])]
  } else if (role === 'garden') {
    rights = [sprinkle(water), bed(level, splashAt(water))]
  } else if (role === 'angler') {
    rights = angling(scene)
  } else if (role === 'baker') {
    rights = baking(scene)
  } else if (role === 'astronaut') {
    rights = fueling(scene)
  } else if (role === 'fire') {
    const flames = fire(scene.stage, scene.flicker, splashAt(water))
    rights = [water === null ? flames.smoke : spray(water), flames.ground]
  } else {
    rights = [spray(water), reservoir(level, splashAt(water), tick)]
  }

  let lefts: Cell[][] = [blank(room), blank(room)]
  if (arrival >= 0) {
    const hidden = blank(SLOT)
    if (role === 'rain') {
      // Zu Fuß: Clawd mit Schirm läuft von links an seinen Platz, dann zieht die Wolke auf.
      const walked = Math.min(1, arrival / ARRIVE.in)
      const at = Math.round(-(room + SLOT) * (1 - walked))
      const rowsAt = slots.map((slot, r) => {
        const row = [...blank(room), ...blank(SLOT), ...[...(rights[r] ?? []), ...blank(reach)].slice(0, reach)]
        slot.forEach((cell, i) => {
          const x = room + at + i
          if (x >= 0 && x < row.length) row[x] = cell
        })

        return row
      })
      lefts = rowsAt.map(row => row.slice(0, room))
      slots = rowsAt.map(row => row.slice(room, room + SLOT))
      rights = rowsAt.map(row => row.slice(room + SLOT))
      const share = arrival < ARRIVE.in ? 0 : (arrival - ARRIVE.in + 1) / ARRIVE.hold
      headCells = cellsOf(cloud(level, share))
    } else {
      // Mit dem Fahrzeug: von links bis vor Clawds Platz, kurz halten, dann nach rechts weg.
      // Ab dem zweiten Haltetakt ist Clawd ausgestiegen und sein Kopf schaut über das Dach.
      const vehicle =
        role === 'garden'
          ? TRACTOR
          : role === 'angler'
            ? rowboat(rollOf(arrival))
            : role === 'baker'
              ? cargoBike(rollOf(arrival))
              : role === 'astronaut'
                ? capsule(arrival)
                : truck(arrival)
      const shift = arrivalShift(arrival)
      const at = Math.round(shift * (shift < 0 ? room + SLOT : SLOT + reach))
      const isOut = arrival > ARRIVE.in
      const rowsAt = (isOut ? slots : [hidden, hidden]).map((slot, r) => {
        const row = [...blank(room), ...slot, ...(rights[r] ?? []), ...blank(reach)].slice(0, room + SLOT + reach)
        cellsOf(vehicle[r] ?? []).forEach((cell, i) => {
          const x = room + at + i
          if (x >= 0 && x < row.length) row[x] = cell
        })

        return row
      })
      lefts = rowsAt.map(row => row.slice(0, room))
      slots = rowsAt.map(row => row.slice(room, room + SLOT))
      rights = rowsAt.map(row => row.slice(room + SLOT))
      if (!isOut) headCells = hidden
    }
  }

  const fit = (cells: Cell[]) => [...cells, ...blank(reach)].slice(0, reach)

  return {
    head: runsOf(headCells),
    flat: role === 'rain' ? [...UNDER] : [...upper],
    rows: [0, 1].map(r => ({
      left: runsOf(lefts[r] ?? []),
      slot: runsOf(slots[r] ?? []),
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
  can: '#5BA36B',
  canDark: '#3F7F4E',
  denim: '#4A6FA5',
  soil: '#7A5A3A',
  concrete: '#8D8B85',
  concreteTop: '#A9A7A0',
  orange: '#E8743B',
  glass: '#BFD9F2',
  siren: '#4A7DFF',
  sirenOff: '#22397A',
  umbrella: '#F5C542',
  umbrellaDark: '#C99A1E',
  pink: '#E58FB5',
  olive: '#6B7F3A',
  oliveDark: '#4F5E2A',
  khaki: '#B5A36A',
  flour: '#F4F1EA',
  flourDark: '#D8D2C4',
  wood: '#B07A45',
  brick: '#9A4A35',
  brickDark: '#7A3626',
  crust: '#C98A4B',
  visor: '#2E3A6E',
  visorShine: '#8FA4E8',
  fish: '#9DB8C9',
  sole: '#5E5550',
}
const GROUND = 27.5
const px = (x: number, y: number, w: number, h: number, c: string, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"${extra}/>`
const crisp = (inner: string) => `<g shape-rendering="crispEdges">${inner}</g>`

// Stiefel je Rolle, hell genug für dunkle und helle Hintergründe: Gummistiefel, Gartenstiefel,
// Wathose, weiße Raumstiefel.
const BOOTS: Record<Role, string> = {
  reservoir: INK.sole,
  fire: INK.sole,
  garden: INK.soil,
  rain: INK.clay,
  angler: INK.oliveDark,
  baker: INK.sole,
  astronaut: INK.flourDark,
}
// Clawd selbst, im Kostüm seiner Rolle; `step` hebt beim Gehen jedes zweite Bein.
function clawdPx(role: Role, step: number): string {
  const legs = [8, 12, 18, 22]
  const boot = BOOTS[role]
  const parts = [
    px(4, 15, 4, 4, INK.clay),
    px(8, 12, 16, 10, INK.clay),
    px(24, 15, 4, 4, INK.clay),
    px(10, 14, 2, 2, INK.ink),
    px(20, 14, 2, 2, INK.ink),
    ...legs.flatMap((x, i) => {
      const lift = step % 2 === 1 && i % 2 === 1 ? 1 : 0
      return role === 'rain'
        ? [px(x, 22 - lift, 2, 4, INK.clay)]
        : [px(x, 22 - lift, 2, 2, INK.clay), px(x, 24 - lift, 2, 2, boot)]
    }),
  ]
  if (role === 'reservoir' || role === 'fire') {
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
  } else if (role === 'garden') {
    parts.push(
      // Latzhose, Strohhut mit grünem Band
      px(11, 17, 10, 2, INK.denim),
      px(8, 19, 16, 3, INK.denim),
      px(11, 6, 10, 1, INK.straw),
      px(10, 7, 12, 3, INK.straw),
      px(10, 9, 12, 1, INK.leaf),
      px(4, 10, 24, 1, INK.strawDark),
      px(5, 11, 22, 1, INK.straw),
      // Gießkanne in der vorderen Schere
      px(27, 14, 6, 1, INK.canDark),
      px(27, 15, 6, 5, INK.can),
      px(29, 12, 3, 1, INK.canDark),
      px(29, 13, 1, 1, INK.canDark),
      px(31, 13, 1, 1, INK.canDark),
      px(33, 15, 1, 1, INK.can),
      px(34, 14, 1, 1, INK.can),
      px(35, 13, 1, 1, INK.can),
      px(36, 12, 2, 2, INK.canDark),
    )
  } else if (role === 'angler') {
    parts.push(
      // Anglerhut und Weste, die Rute schräg nach vorn oben
      px(11, 7, 10, 3, INK.olive),
      px(6, 10, 20, 1, INK.oliveDark),
      px(8, 11, 16, 1, INK.olive),
      px(8, 16, 4, 6, INK.khaki),
      px(20, 16, 4, 6, INK.khaki),
      px(9, 18, 2, 1, INK.oliveDark),
      px(21, 18, 2, 1, INK.oliveDark),
    )
  } else if (role === 'baker') {
    parts.push(
      // Hohe Kochmütze, Schürze, Brotschieber aus Holz
      px(10, 2, 5, 3, INK.flour),
      px(14, 1, 5, 4, INK.flour),
      px(18, 2, 4, 3, INK.flour),
      px(11, 5, 10, 4, INK.flour),
      px(11, 9, 10, 2, INK.flourDark),
      px(10, 17, 12, 5, INK.flour),
      px(28, 17, 8, 1, INK.wood),
      px(36, 15.5, 5, 3, INK.wood),
    )
  } else if (role === 'astronaut') {
    parts.push(
      // Helm mit Visier, weißer Anzug unten, Tankdüse in der Schere
      px(9, 3, 14, 1, INK.flour),
      px(8, 4, 16, 8, INK.flour),
      px(10, 5, 12, 5, INK.visor),
      px(11, 6, 3, 1, INK.visorShine),
      px(8, 18, 16, 4, INK.flour),
      px(14, 18, 4, 2, INK.clay),
      px(28, 16, 4, 2, INK.concrete),
      px(32, 16.5, 1.5, 1, INK.boot),
    )
  } else {
    // Aufgespannter Schirm aus fünf Bahnen, gelb und rot im Wechsel wie im Terminal, unten
    // gewellt; Spitze oben, darüber bleibt Platz für den Regen.
    const panels: [number, number, boolean][] = [[4, 10, false], [10, 14, true], [14, 18, false], [18, 22, true], [22, 28, false]]
    const rows: [number, number, number][] = [[8, 11, 21], [9, 7, 25], [10, 4, 28]]
    parts.push(px(15, 6, 2, 2, INK.umbrellaDark))
    for (const [y, from, to] of rows) {
      for (const [a, b, isRed] of panels) {
        const left = Math.max(a, from)
        const right = Math.min(b, to)
        if (right > left) parts.push(px(left, y, right - left, 1, isRed ? INK.shine : INK.umbrella))
      }
    }
    parts.push(...panels.map(([a, b, isRed]) => px(a + 0.5, 11, b - a - 1, 1, isRed ? INK.brim : INK.umbrellaDark)))
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

// Traktor: großes Hinterrad unter der Kabine mit Dach und Scheibe, lange grüne Haube mit
// Kühlergrill, aus dem Auspuff steigt Rauch, vorn das kleine Rad.
function tractorPx(t: number, roll: number, colors: SceneColors): string {
  return (
    crisp(
      [
        px(4, 10, 11, 1.5, INK.canDark),
        px(5, 11.5, 1, 6, INK.canDark),
        px(13, 11.5, 1, 6, INK.canDark),
        px(6, 12, 7, 5, INK.glass),
        px(4, 17, 11, 4, INK.leaf),
        px(14, 16, 13, 6, INK.can),
        px(14, 16, 13, 1, INK.leaf),
        px(27, 16.5, 1.5, 5, INK.concrete),
        ...[17.5, 19, 20.5].map(y => px(27, y, 1.5, 0.4, INK.boot)),
        px(12, 22, 14, 1.5, INK.boot),
        px(20, 11, 1, 5, INK.concrete),
        px(19.6, 10.5, 1.8, 0.8, INK.boot),
      ].join(''),
    ) +
    `<circle cx="20.5" cy="${8.5 - (t % 3)}" r="1.2" fill="${colors.gray}" fill-opacity="0.5"/>` +
    wheelPx(9, 23, 4.5, INK.gold, roll) +
    wheelPx(25, 25, 2.5, INK.gold, roll)
  )
}

// Wo das Wasser je Stärke auf den Boden trifft: Tropfen direkt am Rohr, Strahlen weiter vorn.
const NOZZLE = { x: 34, y: 17 }
const SPOUT = { x: 37, y: 13 }
const LAND = {
  reservoir: { drop: 35, jet: 44, strong: 50 },
  fire: { drop: 35, jet: 46, strong: 50 },
  garden: { drop: 38, jet: 43, strong: 48 },
}
const landOf = (role: 'reservoir' | 'fire' | 'garden', water: Flow) =>
  water.jet === 0 ? LAND[role].drop : water.jet > 2 ? LAND[role].strong : LAND[role].jet

function hoseSvg(role: 'reservoir' | 'fire', water: Flow | null, tick: number, landY: number, colors: SceneColors): string {
  const hose = `<path d="M0 ${GROUND - 0.5} Q 3 ${GROUND - 0.5} 4.5 23 T 6 18" fill="none" stroke="${INK.hose}" stroke-width="2" stroke-linecap="round"/>`
  if (water === null) return hose
  const wet = `fill="${colors.suggestion}"`
  const landX = landOf(role, water)
  const drop =
    water.drop === null ? '' : `<circle cx="${LAND[role].drop}" cy="${19 + water.drop * 2.5}" r="1.2" ${wet} fill-opacity="0.85"/>`
  // Der Bogen: je stärker, desto höher und weiter; die Striche wandern mit dem Takt nach vorn.
  const arc =
    water.jet === 0
      ? ''
      : `<path d="M${NOZZLE.x} ${NOZZLE.y} Q ${(NOZZLE.x + landX) / 2 + 2} ${water.jet > 2 ? 9 : 13} ${landX} ${landY}" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.8" stroke-width="${water.jet}" stroke-linecap="round" stroke-dasharray="${water.jet > 2 ? '4 1.5' : '2.5 1.5'}" stroke-dashoffset="${-(tick % 4) * 1.4}"/>`

  return hose + arc + drop
}

const splashSvg = (x: number, y: number, colors: SceneColors) =>
  `<ellipse cx="${x}" cy="${y}" rx="2.5" ry="0.9" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.6" stroke-width="0.7"/><circle cx="${x - 1.5}" cy="${y - 2}" r="0.6" fill="${colors.suggestion}" fill-opacity="0.7"/><circle cx="${x + 1.5}" cy="${y - 2.5}" r="0.6" fill="${colors.suggestion}" fill-opacity="0.7"/>`

// Stausee: Becken von 35 bis 53, Mauer bis 57. Der Pegel steigt mit den Tokens bis knapp unter
// die Mauerkrone, ganz voll läuft er über. Trifft der Strahl, wellt sich die Oberfläche.
function reservoirSvg(scene: Scene, colors: SceneColors): { back: string; landY: number } {
  const height = scene.level === 0 ? 0 : 1 + scene.level * 0.95
  const surface = GROUND - height
  const floor = px(35, GROUND - 0.3, 18, 0.8, colors.gray, ' fill-opacity="0.4"')
  const dam = crisp(px(53, 16, 4, 12, INK.concrete) + px(52.5, 15.5, 5, 1, INK.concreteTop) + px(54, 19, 2, 0.5, INK.concreteTop) + px(54, 23, 2, 0.5, INK.concreteTop))
  const isHit = scene.water !== null && (scene.water.isSplash || scene.water.jet > 0)
  let pool = ''
  if (height > 0) {
    const bumps = Array.from({ length: 9 }, (_, i) => {
      const x = 35 + i * 2
      const up = isHit && (i + scene.tick) % 2 === 0 ? -0.6 : 0
      return `${i === 0 ? 'M' : 'L'}${x} ${surface + up}`
    }).join(' ')
    pool = `<path d="${bumps} L53 ${surface} L53 ${GROUND} L35 ${GROUND} Z" fill="${colors.suggestion}" fill-opacity="0.45"/>`
  }
  // Ganz voll rinnt es über die Mauer; solange Wasser kommt, läuft ein Tropfen im Takt des Terminals hinab.
  const spill =
    scene.level >= 10
      ? `<path d="M57 16.2 Q 58.8 17 59 ${GROUND}" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.7" stroke-width="1"/>` +
        (scene.water === null ? '' : `<circle cx="58.8" cy="${scene.tick % 2 === 0 ? 19.5 : 24}" r="0.8" fill="${colors.suggestion}"/>`)
      : ''

  return { back: floor + pool + dam + spill, landY: height === 0 ? GROUND - 0.5 : surface }
}

// Feuer um x 49: Säulen innen gelb, dann orange, außen rot, es flackert. Aus ist es Glut mit Rauch.
const FLAME_HEIGHTS = [
  [3, 5, 8, 6, 10, 7, 9, 5, 4, 2],
  [2, 6, 7, 9, 8, 10, 6, 7, 3, 3],
]
function fireSvg(scene: Scene, colors: SceneColors): string {
  const logs = crisp(px(44, 26.5, 10, 1.5, INK.soil) + px(45, 25.5, 8, 1, INK.brim))
  if (scene.stage === 0) {
    const rise = scene.flicker % 3
    return (
      logs +
      crisp(px(46, 25, 1, 1, INK.red) + px(50, 25, 1, 1, INK.orange)) +
      `<circle cx="48" cy="${22 - rise}" r="1.6" fill="${colors.gray}" fill-opacity="0.45"/><circle cx="50" cy="${18 - rise}" r="2" fill="${colors.gray}" fill-opacity="0.3"/>`
    )
  }
  const size = scene.stage / 4
  const heights = FLAME_HEIGHTS[scene.flicker % 2] ?? []
  const columns = heights.map((h, i) => {
    const tall = Math.max(1, Math.round(h * size))
    const x = 44 + i
    const base = GROUND - 1.5
    return [
      px(x, base - tall, 1, tall, INK.red),
      px(x, base - Math.round(tall * 0.65), 1, Math.round(tall * 0.65), INK.orange),
      px(x, base - Math.round(tall * 0.35), 1, Math.round(tall * 0.35), INK.gold),
    ].join('')
  })
  // Wo der Strahl in die Flammen fährt, steigt Dampf auf.
  const steam =
    scene.water !== null && scene.water.jet > 0
      ? `<circle cx="${landOf('fire', scene.water) - 1}" cy="${GROUND - 11}" r="1.4" fill="${INK.silver}" fill-opacity="0.5"/><circle cx="${landOf('fire', scene.water) + 1.5}" cy="${GROUND - 13 - (scene.tick % 2)}" r="1" fill="${INK.silver}" fill-opacity="0.4"/>`
      : ''

  return logs + crisp(columns.join('')) + steam
}

// Beet von 36 bis 57 auf brauner Erde, je Stufe eine Blume mehr, die Stiele wachsen mit.
const FLOWER_COLORS = [INK.shine, INK.gold, '#B1B9F9', INK.pink]
function bedSvg(scene: Scene): string {
  const soil = `<ellipse cx="46.5" cy="${GROUND}" rx="11" ry="1" fill="${INK.soil}" fill-opacity="0.8"/>`
  const flowers = Array.from({ length: Math.min(10, scene.level) }, (_, i) => {
    const x = 37 + i * 2
    const stem = 2 + Math.min(4, Math.floor(scene.level / 2)) + (i % 2)
    const top = GROUND - 0.5 - stem
    return px(x, top, 1, stem, INK.leaf) + (scene.level < 2 ? '' : px(x - 0.5, top - 2, 2, 2, FLOWER_COLORS[i % FLOWER_COLORS.length] ?? INK.gold))
  })

  return soil + crisp(flowers.join(''))
}
function canWaterSvg(water: Flow | null, tick: number, colors: SceneColors): string {
  if (water === null) return ''
  const wet = `fill="${colors.suggestion}"`
  if (water.jet === 0) {
    const drop = water.drop === null ? '' : `<circle cx="${LAND.garden.drop}" cy="${15 + water.drop * 3.5}" r="1" ${wet} fill-opacity="0.85"/>`
    return drop + (water.isSplash ? splashSvg(LAND.garden.drop, GROUND - 1, colors) : '')
  }
  // Brause: drei oder fünf gepunktete Bögen, die Punkte wandern.
  const reach = landOf('garden', water)
  const streams = water.jet > 2 ? 5 : 3

  return Array.from({ length: streams }, (_, i) => {
    const end = reach - (streams - 1) + i * 2
    return `<path d="M${SPOUT.x + 0.5} ${SPOUT.y} Q ${(SPOUT.x + end) / 2 + 1} ${SPOUT.y - 2 + i * 0.4} ${end} ${GROUND - 3}" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.85" stroke-width="0.9" stroke-linecap="round" stroke-dasharray="0.1 1.8" stroke-dashoffset="${-(tick % 3) * 0.6}"/>`
  }).join('')
}

// Die Wolke links oben bis weit nach rechts, flach über dem Schirm, je Stufe breiter; beim Regen dunkler.
const cloudWidth = (level: number) => 14 + level * 4.2
function cloudSvg(level: number, share: number, isDark: boolean, colors: SceneColors): string {
  if (share <= 0) return ''
  const width = cloudWidth(level) * Math.min(1, share)
  const puffs = Math.max(3, Math.round(width / 4))
  const fill = `fill="${isDark ? '#80838F' : colors.gray}" fill-opacity="${0.9 * Math.min(1, share + 0.2)}"`
  const circles = Array.from({ length: puffs }, (_, i) => {
    const cx = 2 + ((i + 0.5) * width) / puffs
    return `<circle cx="${cx.toFixed(1)}" cy="${i % 2 === 0 ? 4.3 : 4.8}" r="${i % 2 === 0 ? 1.9 : 1.6}" ${fill}/>`
  }).join('')

  return circles + `<rect x="2" y="4.4" width="${width.toFixed(1)}" height="1.6" rx="0.8" ${fill}/>`
}
// Regenstriche unter der Wolke; auf dem Schirm springen die Tropfen ab. Je stärker, desto dichter.
function rainSvg(level: number, strength: number, tick: number, colors: SceneColors): string {
  const width = cloudWidth(level)
  const gap = [5, 3.5, 2.5, 1.8][strength] ?? 5
  const length = [1.2, 2, 3, 4][strength] ?? 1.2
  const drops: string[] = []
  for (let x = 3, k = 0; x <= 2 + width; x += gap, k += 1) {
    const isOver = x >= 4 && x <= 28
    const stop = isOver ? 8 + Math.abs(x - 16) * 0.17 : GROUND - 0.5
    const y = 6.5 + ((tick * 3 + k * 7) % (isOver ? 5 : 21))
    if (y < stop) {
      drops.push(`<line x1="${x.toFixed(1)}" y1="${y}" x2="${(x - 0.4).toFixed(1)}" y2="${Math.min(y + length, stop).toFixed(1)}" stroke="${colors.suggestion}" stroke-opacity="0.8" stroke-width="0.6" stroke-linecap="round"/>`)
    } else if (isOver) {
      drops.push(`<circle cx="${(x + (k % 2 === 0 ? 0.6 : -0.6)).toFixed(1)}" cy="${(stop - 0.8).toFixed(1)}" r="0.4" fill="${colors.suggestion}" fill-opacity="0.8"/>`)
    }
  }

  return drops.join('')
}

// Ruderboot, Lastenrad und Landekapsel für die Anfahrt der neuen Rollen.
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
// Lastenrad vom Bäcker: großes Hinterrad, Sattel und Lenker, die Kurbel dreht sich,
// vorn über dem kleinen Rad die Holzkiste voller Brote.
function bikePx(t: number): string {
  const turn = ((t % 4) * Math.PI) / 2
  const pedal = { x: 12 + 2.2 * Math.cos(turn), y: 24 + 2.2 * Math.sin(turn) }
  const spoke = (cx: number, cy: number, r: number) => {
    const a = ((t % 4) * Math.PI) / 4
    const dx = r * Math.cos(a)
    const dy = r * Math.sin(a)
    return `<path d="M${(cx - dx).toFixed(2)} ${(cy - dy).toFixed(2)} L${(cx + dx).toFixed(2)} ${(cy + dy).toFixed(2)}" stroke="${INK.concrete}" stroke-width="0.4"/>`
  }
  const loaves = [23, 26, 29]
    .map((x, i) => `<ellipse cx="${x}" cy="${17.6 - (i % 2) * 0.4}" rx="1.5" ry="1" fill="${INK.crust}"/><rect x="${x - 0.6}" y="${16.9 - (i % 2) * 0.4}" width="1.2" height="0.3" fill="${INK.straw}"/>`)
    .join('')
  return (
    `<path d="M6 24 L12 24 L10 16.5 M10.5 17.5 L18 17.5 M12 24 L29 24 M18 15 L18 24" fill="none" stroke="${INK.concrete}" stroke-width="0.9"/>` +
    loaves +
    crisp(
      [
        px(8.5, 15.5, 3.5, 1, INK.boot),
        px(16.5, 14.5, 3, 1, INK.boot),
        px(21, 18, 10, 6, INK.wood),
        px(21, 18, 10, 0.8, INK.soil),
        px(25.5, 19.5, 1, 3, INK.soil),
      ].join(''),
    ) +
    `<path d="M12 24 L${pedal.x.toFixed(2)} ${pedal.y.toFixed(2)}" stroke="${INK.boot}" stroke-width="0.7"/>` +
    px(pedal.x - 0.8, pedal.y - 0.3, 1.6, 0.6, INK.boot) +
    [
      [6, 24.3, 3.2],
      [29, 25.3, 2.2],
    ]
      .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK.boot}" stroke-width="1.1"/>` + spoke(cx ?? 0, cy ?? 0, (r ?? 1) - 0.5))
      .join('')
  )
}
// Landekapsel: im Anflug am rot-weißen Schirm, gelandet steht sie auf dem dunklen Hitzeschild,
// beim Start faucht unten der Feuerstrahl.
function capsulePx(t: number, phase: 'falling' | 'landed' | 'rising'): string {
  const chute =
    phase === 'falling'
      ? `<path d="M3 9 Q 16 -1 29 9 Q 22.5 7.5 16 9 Q 9.5 7.5 3 9 Z" fill="${INK.shine}"/>` +
        `<path d="M12 4.3 Q 16 3.5 20 4.3 L18.5 8.3 Q 16 7.8 13.5 8.3 Z" fill="${INK.flour}"/>` +
        `<path d="M3 9 L11 13 M16 9 L16 13 M29 9 L21 13" stroke="${INK.silver}" stroke-width="0.4"/>`
      : ''
  const flame =
    phase === 'rising'
      ? `<path d="M9 26 L23 26 L16 ${31 + (t % 2) * 2} Z" fill="${INK.orange}"/><path d="M12 26 L20 26 L16 ${29 + (t % 2)} Z" fill="${INK.gold}"/>`
      : ''
  return (
    chute +
    flame +
    `<path d="M11 13 L21 13 L26 24 L6 24 Z" fill="${INK.flour}"/>` +
    crisp(px(12, 11.5, 8, 1.5, INK.concrete) + px(8.5, 20, 15, 0.5, INK.flourDark) + px(5, 24, 22, 2, INK.brickDark)) +
    `<circle cx="16" cy="17" r="2.2" fill="${INK.visor}"/><circle cx="15.2" cy="16.2" r="0.6" fill="${INK.visorShine}"/>`
  )
}

// Angler: Teich rechts, Rute aus der Schere, die Pose wippt im Tempo; links unten der Eimer mit Fischen.
function pondSvg(scene: Scene, colors: SceneColors, hasRod: boolean): string {
  const { water, strength, tick, level } = scene
  const isOn = water !== null
  const dip = !isOn ? 0 : strength === 0 ? (tick % 4 === 0 ? 1 : 0) : strength === 3 ? 1.5 : tick % 2 === 0 ? 1 : -0.3
  const bobY = 23.2 + dip
  const pond = `<ellipse cx="49" cy="24.8" rx="10" ry="2.6" fill="${colors.suggestion}" fill-opacity="0.45"/>`
  const ripples =
    isOn && strength >= 2
      ? `<ellipse cx="48" cy="24.5" rx="${2 + (tick % 2)}" ry="0.7" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.7" stroke-width="0.5"/>`
      : ''
  const bite = isOn && strength === 3 && tick % 4 < 2 ? `<text x="50" y="16" font-size="6" font-family="Helvetica" font-weight="bold" fill="${INK.gold}">!</text>` : ''
  // Aus dem Eimer schauen Fischschwänze: Schwanzflosse oben, darunter der Leib.
  const fish = Array.from({ length: Math.min(6, level) }, (_, i) => {
    const x = 30.6 + (i % 3) * 1.6
    const y = 19.5 - Math.floor(i / 3) * 1.3
    return px(x, y, 1, 1.5, INK.fish) + px(x - 0.4, y - 0.8, 0.7, 0.8, INK.fish) + px(x + 0.7, y - 0.8, 0.7, 0.8, INK.fish)
  }).join('')
  const bucket = crisp(fish + px(30, 21, 5, 6, INK.concrete) + px(29.5, 20.5, 6, 1, INK.concreteTop))

  return (
    pond +
    ripples +
    (!hasRod
      ? ''
      : `<path d="M27 17 L46 5" stroke="${INK.wood}" stroke-width="0.8"/><path d="M46 5 Q 48 12 48 ${bobY}" fill="none" stroke="${colors.gray}" stroke-width="0.3"/>` +
    `<circle cx="48" cy="${bobY}" r="1" fill="${INK.shine}"/><rect x="47" y="${bobY}" width="2" height="0.8" fill="${INK.silver}"/>`) +
    bucket +
    bite
  )
}

// Bäcker: Steinofen rechts, die Öffnung glüht im Tempo, aus dem Schornstein Rauch; davor der Brotstapel.
function ovenSvg(scene: Scene, colors: SceneColors): string {
  const { water, strength, tick, level } = scene
  const isOn = water !== null
  const glow = isOn ? 0.55 + strength * 0.15 - (tick % 2) * 0.1 : 0.25
  const oven = crisp(
    [
      px(42, 16, 16, 12, INK.brick),
      px(44, 14, 12, 2, INK.brick),
      px(46, 13, 8, 1, INK.brickDark),
      px(45, 21, 10, 6, INK.ink),
      px(45, 21, 10, 6, INK.orange, ` fill-opacity="${glow.toFixed(2)}"`),
      px(46, 24, 8, 3, INK.gold, ` fill-opacity="${(glow * 0.7).toFixed(2)}"`),
      px(52, 9, 3, 4, INK.brickDark),
      ...[17, 20, 23, 26].map(y => px(42, y, 16, 0.4, INK.brickDark)),
    ].join(''),
  )
  const smoke = isOn
    ? Array.from({ length: 1 + strength }, (_, i) => `<circle cx="${53.5 + (i % 2)}" cy="${7 - i * 1.6 - (tick % 2) * 0.6}" r="${1 + i * 0.3}" fill="${colors.gray}" fill-opacity="${0.5 - i * 0.08}"/>`).join('')
    : ''
  // Pyramide aus Broten: unten vier, dann drei, zwei, eins.
  const spots: [number, number][] = []
  for (let row = 0, n = 4; n > 0; row += 1, n -= 1) for (let i = 0; i < n; i += 1) spots.push([30.5 + row * 1.4 + i * 2.8, GROUND - 1 - row * 1.9])
  const bread = spots
    .slice(0, Math.min(10, level))
    .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.4" ry="0.95" fill="${INK.crust}"/><rect x="${x - 0.6}" y="${y - 0.6}" width="1.2" height="0.3" fill="${INK.straw}"/>`)
    .join('')

  return oven + smoke + bread
}

const LIFT = [1.6, 2.4, 0.8, 0]
// Astronaut: Rakete rechts mit Tankanzeige im Rumpf; der Treibstoff fließt im Tempo, ganz voll hebt sie ab.
function rocketSvg(scene: Scene, colors: SceneColors): string {
  const { water, strength, tick, level } = scene
  const isOn = water !== null
  // Steigt und sinkt im Takt des Terminals (oben in den Takten 0 und 1 von 4), statt nach
  // dem höchsten Punkt auf den Boden zurückzuspringen.
  const lift = isOn && level >= 10 ? (LIFT[tick % LIFT.length] ?? 0) : 0
  const fill = Math.min(1, level / 10) * 12
  const rocket =
    `<g transform="translate(0 ${-lift})">` +
    `<path d="M50 4 L54 9 L46 9 Z" fill="${INK.red}"/>` +
    crisp(
      [
        px(46, 9, 8, 15, INK.flour),
        px(48, 11, 4, 12, INK.ink, ' fill-opacity="0.35"'),
        px(48, 23 - fill, 4, fill, colors.suggestion),
        px(43, 19, 3, 6, INK.red),
        px(54, 19, 3, 6, INK.red),
        px(47, 24, 6, 2, INK.concrete),
      ].join(''),
    ) +
    (lift > 0 ? `<rect x="48" y="26" width="4" height="${1.5 + (tick % 2)}" fill="${INK.orange}"/>` : '') +
    `</g>`
  const pad = crisp(px(40, 26.5, 20, 1.5, INK.concrete))
  const stream = isOn
    ? `<path d="M33.5 17 Q 40 14 46 18" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.85" stroke-width="${[0.5, 0.8, 1.2, 1.8][strength] ?? 0.5}" stroke-linecap="round" stroke-dasharray="${strength >= 2 ? '2 1' : '0.1 1.6'}" stroke-dashoffset="${-(tick % 3) * 0.7}"/>`
    : ''

  return pad + rocket + stream
}

export function sceneSvg(scene: Scene, colors: SceneColors): string {
  const { role, water, tick, level, arrival } = scene
  const parts: string[] = []
  let landY = GROUND - 0.5

  // Hinten die Szene
  if (role === 'reservoir') {
    const pool = reservoirSvg(scene, colors)
    parts.push(pool.back)
    landY = pool.landY
  } else if (role === 'fire') {
    parts.push(fireSvg(scene, colors))
  } else if (role === 'garden') {
    parts.push(bedSvg(scene))
  } else if (role === 'angler' || role === 'baker' || role === 'astronaut') {
    // Diese Szenen zeichnen sich nach Clawd, weil Rute, Brote und Strahl vor ihm liegen.
  } else {
    const rx = 1.5 + level * 2
    if (level > 0) parts.push(`<ellipse cx="42" cy="${GROUND}" rx="${rx}" ry="${0.9 + level * 0.18}" fill="${colors.suggestion}" fill-opacity="0.35"/>`)
  }

  // Die Anfahrt: das Fahrzeug fährt hinter Clawds Platz, er springt heraus, es fährt weiter.
  let clawd = ''
  const isHere = arrival < 0
  if (arrival >= 0 && role !== 'rain') {
    const shift = arrivalShift(arrival)
    const x = shift * (shift < 0 ? 40 : 64)
    const roll = rollOf(arrival)
    if (role === 'astronaut') {
      // Die Kapsel schwebt am Fallschirm herab, setzt sanft auf und startet wieder nach oben.
      const y = shift * (shift < 0 ? 32 : -40)
      const phase = arrival < ARRIVE.in ? 'falling' : arrival < ARRIVE.in + ARRIVE.hold ? 'landed' : 'rising'
      parts.push(`<g transform="translate(0 ${y.toFixed(1)})">${capsulePx(arrival, phase)}</g>`)
    } else {
      const vehicle =
        role === 'garden'
          ? tractorPx(arrival, roll, colors)
          : role === 'angler'
            ? rowboatPx(roll, colors)
            : role === 'baker'
              ? bikePx(roll)
              : truckPx(arrival, roll)
      parts.push(`<g transform="translate(${x.toFixed(1)} 0)">${vehicle}</g>`)
    }
    if (arrival > ARRIVE.in) {
      const hop = arrival === ARRIVE.in + 1 ? -3 : arrival === ARRIVE.in + 2 ? -1 : 0
      clawd = `<g transform="translate(0 ${hop})">${clawdPx(role, 0)}</g>`
    }
  } else if (arrival >= 0) {
    const walked = Math.min(1, arrival / ARRIVE.in)
    clawd = `<g transform="translate(${(-32 * (1 - walked)).toFixed(1)} 0)">${clawdPx(role, walked < 1 ? arrival : 0)}</g>`
  } else {
    clawd = clawdPx(role, 0)
  }
  if (isHere && (role === 'reservoir' || role === 'fire')) parts.push(hoseSvg(role, water, tick, role === 'fire' ? GROUND - 6 : landY, colors))
  parts.push(clawd)

  // Vorn das Wasser
  if (isHere && (role === 'reservoir' || role === 'fire') && water !== null && water.isSplash) {
    parts.push(splashSvg(landOf(role, water), role === 'fire' ? GROUND - 1 : landY, colors))
  }
  if (isHere && role === 'garden') parts.push(canWaterSvg(water, tick, colors))
  if (role === 'angler') parts.push(pondSvg({ ...scene, water: isHere ? water : null }, colors, isHere))
  if (role === 'baker') parts.push(ovenSvg({ ...scene, water: isHere ? water : null }, colors))
  if (role === 'astronaut') parts.push(rocketSvg({ ...scene, water: isHere ? water : null }, colors))
  if (role === 'rain') {
    const share = arrival < 0 ? 1 : arrival < ARRIVE.in ? 0 : (arrival - ARRIVE.in + 1) / ARRIVE.hold
    if (isHere && water !== null) parts.push(rainSvg(level, scene.strength, tick, colors))
    parts.push(cloudSvg(level, share, isHere && water !== null && scene.strength >= 2, colors))
  }
  const { x, y, width, height } = SCENE_VIEW

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}">${parts.join('')}</svg>`
}

export function sceneAlt(scene: Scene): string {
  const { role, water, arrival, stage } = scene
  if (arrival >= 0) {
    const arriving: Record<Role, string> = {
      reservoir: 'fire truck arriving',
      fire: 'fire truck arriving',
      garden: 'garden tractor arriving',
      rain: 'Clawd walking in under an umbrella',
      angler: 'rowboat arriving',
      baker: 'cargo bike with bread arriving',
      astronaut: 'landing capsule arriving',
    }
    return arriving[role]
  }
  const isOn = water !== null
  if (role === 'reservoir') return isOn ? 'firefighter Clawd filling the reservoir' : 'firefighter Clawd at the reservoir, hose closed'
  if (role === 'fire') {
    if (stage === 0) return isOn ? 'firefighter Clawd hosing down the embers' : 'firefighter Clawd, fire out'
    return isOn ? 'firefighter Clawd fighting the fire' : 'firefighter Clawd, fire burning'
  }
  if (role === 'garden') return isOn ? 'gardener Clawd watering the flowers' : 'gardener Clawd, watering can resting'
  if (role === 'angler') return isOn ? 'angler Clawd, the float is bobbing' : 'angler Clawd waiting for a bite'
  if (role === 'baker') return isOn ? 'baker Clawd, the oven is glowing' : 'baker Clawd next to the oven'
  if (role === 'astronaut') return isOn ? 'astronaut Clawd fueling the rocket' : 'astronaut Clawd next to the rocket'

  return isOn ? 'Clawd under an umbrella in the rain' : 'Clawd under an umbrella, cloudy'
}
