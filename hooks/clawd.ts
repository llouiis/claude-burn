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

export const HELMET: Piece[] = [{ text: '▂▄▆██', color: 'error' }, { text: '█', color: 'warning' }, { text: '▆▖ ', color: 'error' }]
export const BODY: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '━', color: 'error' }, { text: '╾', color: 'warning' }]
export const LEGS: Piece[] = [{ text: ' ▘▘ ▘▘   ', color: 'claude' }]
const STRAW_HAT: Piece[] = [{ text: '▁▂▅', color: 'warning' }, { text: '███', color: 'warning' }, { text: '▅▂▁', color: 'warning' }]
const GARDENER: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '▆╸', color: 'success' }]
const CANOPY: Piece[] = [{ text: '▄▆███▆▄', color: 'warning' }, { text: '  ' }]
const UNDER: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '  ' }]
// Die Fahrzeuge, je neun Spalten in zwei Zeilen; das Blaulicht blinkt.
const truck = (t: number): [Piece[], Piece[]] => [
  [{ text: '▄▄▄▄▄▄', color: 'error' }, { text: '▐', color: t % 2 === 0 ? 'suggestion' : 'inactive' }, { text: '█▙', color: 'error' }],
  [
    { text: '▀', color: 'error' },
    { text: '●', color: 'inactive' },
    { text: '▀▀▀▀', color: 'error' },
    { text: '●', color: 'inactive' },
    { text: '▀▀', color: 'error' },
  ],
]
const ANGLER_HAT: Piece[] = [{ text: '▃▅███▅▃', color: 'success' }, { text: ' ' }, { text: '╱', color: 'inactive' }]
const ANGLER: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '╱', color: 'inactive' }, { text: ' ' }]
const TOQUE: Piece[] = [{ text: ' ▗▆███▆▖ ' }]
const BAKER: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '━▬', color: 'warning' }]
const SPACE_HELMET: Piece[] = [{ text: ' ▗▆' }, { text: '▀▀▀', color: 'suggestion' }, { text: '▆▖ ' }]
const ASTRONAUT: Piece[] = [{ text: '▐▛███▜▌', color: 'claude' }, { text: '═╸', color: 'inactive' }]
const ROWBOAT: [Piece[], Piece[]] = [
  [{ text: ' ╲', color: 'inactive' }, { text: '▁▁▁▁▁▁', color: 'claude' }, { text: ' ' }],
  [{ text: ' ' }, { text: '▀█████▀', color: 'claude' }, { text: ' ' }],
]
const CARGO_BIKE: [Piece[], Piece[]] = [
  [{ text: ' ' }, { text: '▄▄▄', color: 'warning' }, { text: '═══╗', color: 'inactive' }, { text: ' ' }],
  [{ text: '(●)───(●)', color: 'inactive' }],
]
const capsule = (t: number): [Piece[], Piece[]] => [
  [{ text: '  ▗▆' }, { text: '▀', color: 'suggestion' }, { text: '▆▖  ' }],
  [{ text: '  ▜███▛', color: undefined }, { text: '▾', color: t % 2 === 0 ? 'claude' : 'warning' }, { text: ' ' }],
]
const TRACTOR: [Piece[], Piece[]] = [
  [{ text: ' ▄▄▄▄', color: 'success' }, { text: '╷', color: 'inactive' }, { text: '▄▄▖', color: 'success' }],
  [{ text: ' ' }, { text: '██', color: 'inactive' }, { text: '▀▀▀▀', color: 'success' }, { text: '●', color: 'inactive' }, { text: ' ' }],
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

// Die Wolke steht rechtsbündig über dem Schirm und wird mit den Tokens breiter.
const CLOUD_WIDTH = [3, 3, 4, 5, 5, 6, 6, 7, 8, 8, 9]
export function cloud(level: number, share = 1): Piece[] {
  const full = CLOUD_WIDTH[Math.min(level, 10)] ?? 3
  const width = share <= 0 ? 0 : Math.max(1, Math.round(full * Math.min(1, share)))
  const puffs = Array.from({ length: width }, (_, i) => '▂▄▆█'[Math.min(3, i, width - 1 - i)] ?? '▂').join('')

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

// Bäcker: Ofen in den Spalten 0 bis 4, innen glüht es im Tempo, daneben Dampf; dahinter der Brotstapel.
const GLOW = ['▒▒▒', '▒▓▒', '▓█▓', '███']
function baking(scene: Scene): [Cell[], Cell[]] {
  const { water, strength, tick, level } = scene
  const isOn = water !== null
  const loaves = Math.min(level, 12)
  const top: Cell[] = [...cellsOf([{ text: '▗▄▄▄▖', color: 'inactive' }]), BLANK, BLANK]
  if (isOn) top[5 + (tick % 2)] = { ch: tick % 2 === 0 ? '˜' : '~', color: 'inactive' }
  const glow = isOn
    ? { text: GLOW[strength] ?? '▒▒▒', color: tick % 2 === 0 ? ('claude' as const) : ('warning' as const) }
    : { text: '░░░', color: 'error' as const, dim: true }
  const low = [...cellsOf([{ text: '▐', color: 'inactive' }, glow, { text: '▌', color: 'inactive' }]), BLANK, BLANK]
  const bread = (n: number): Cell[] => Array.from({ length: n }, () => ({ ch: '▆', color: 'warning' as const }))

  return [[...top, ...bread(Math.max(0, loaves - 6))], [...low, ...bread(Math.min(6, loaves))]]
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
  const nose = cellsOf([{ text: '▗█▖' }])
  const body = cellsOf([{ text: '▟' }, { text: '█', color: 'error' }, { text: '▙' }])
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
  const lower = role === 'rain' ? UNDER : LEGS
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
            ? ROWBOAT
            : role === 'baker'
              ? CARGO_BIKE
              : role === 'astronaut'
                ? capsule(arrival)
                : truck(arrival)
      const at =
        arrival < ARRIVE.in
          ? Math.round(-(room + SLOT) * (1 - arrival / ARRIVE.in))
          : arrival < ARRIVE.in + ARRIVE.hold
            ? 0
            : Math.round(((arrival - ARRIVE.in - ARRIVE.hold + 1) / ARRIVE.out) * (SLOT + reach))
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
}
const GROUND = 27.5
const px = (x: number, y: number, w: number, h: number, c: string, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"${extra}/>`
const crisp = (inner: string) => `<g shape-rendering="crispEdges">${inner}</g>`

// Clawd selbst, im Kostüm seiner Rolle; `step` hebt beim Gehen jedes zweite Bein.
function clawdPx(role: Role, step: number): string {
  const legs = [8, 12, 18, 22]
  const boot = role === 'garden' ? INK.soil : INK.boot
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
    parts.push(
      // Aufgespannter Schirm, Stiel bis auf den Kopf; darüber bleibt Platz für den Regen.
      px(15, 6, 2, 2, INK.umbrellaDark),
      px(11, 8, 10, 1, INK.umbrella),
      px(7, 9, 18, 1, INK.umbrella),
      px(4, 10, 24, 1, INK.umbrella),
      ...[4, 10, 16, 22].map(x => px(x, 11, 5, 1, INK.umbrellaDark)),
    )
  }

  return crisp(parts.join(''))
}

function truckPx(t: number): string {
  return crisp(
    [
      px(0, 15, 24, 10, INK.red),
      px(24, 13, 10, 12, INK.red),
      px(27, 15, 6, 4, INK.glass),
      px(1, 13, 21, 0.6, INK.silver),
      px(1, 14.4, 21, 0.6, INK.silver),
      ...[3, 7, 11, 15, 19].map(x => px(x, 13, 0.6, 2, INK.silver)),
      px(0, 21, 34, 1, INK.gold),
      px(28, 11, 3, 2, t % 2 === 0 ? INK.siren : INK.sirenOff),
      px(33, 22, 2, 2, INK.concrete),
    ].join(''),
  ) + [7, 28].map(x => `<circle cx="${x}" cy="25.5" r="2.6" fill="${INK.boot}"/><circle cx="${x}" cy="25.5" r="1" fill="${INK.concrete}"/>`).join('')
}

function tractorPx(t: number, colors: SceneColors): string {
  return (
    crisp(
      [
        px(4, 18, 16, 5, INK.leaf),
        px(14, 16, 9, 5, INK.can),
        px(6, 15, 4, 3, INK.boot),
        px(12, 14, 1, 4, INK.boot),
        px(11, 14, 3, 1, INK.boot),
        px(19, 12, 1, 4, INK.concrete),
      ].join(''),
    ) +
    `<circle cx="19.5" cy="${10.5 - (t % 3)}" r="1.2" fill="${colors.gray}" fill-opacity="0.5"/>` +
    `<circle cx="8" cy="24" r="3.6" fill="${INK.boot}"/><circle cx="8" cy="24" r="1.4" fill="${INK.gold}"/>` +
    `<circle cx="21" cy="25.5" r="2" fill="${INK.boot}"/><circle cx="21" cy="25.5" r="0.8" fill="${INK.gold}"/>`
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
  const spill =
    scene.level >= 10
      ? `<path d="M57 16.2 Q 58.8 17 59 ${GROUND}" fill="none" stroke="${colors.suggestion}" stroke-opacity="0.7" stroke-width="1"/>`
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
function rowboatPx(t: number): string {
  const oar = t % 2 === 0 ? 'M8 14 L2 26' : 'M10 14 L5 27'
  return (
    crisp([px(2, 20, 28, 3, INK.wood), px(4, 23, 24, 2, INK.soil), px(1, 19, 30, 1, INK.crust)].join('')) +
    `<path d="${oar}" stroke="${INK.crust}" stroke-width="1.2"/>`
  )
}
function bikePx(): string {
  return (
    `<path d="M7 25 L13 25 L10 18 L21 18 L13 25" fill="none" stroke="${INK.concrete}" stroke-width="1"/>` +
    crisp([px(8, 17, 4, 1, INK.boot), px(21, 14, 1, 5, INK.concrete), px(20, 14, 3, 1, INK.boot), px(22, 18, 9, 5, INK.crust), px(22, 18, 9, 1, INK.wood)].join('')) +
    [7, 26].map(x => `<circle cx="${x}" cy="25" r="2.8" fill="none" stroke="${INK.boot}" stroke-width="1.2"/>`).join('')
  )
}
function capsulePx(t: number, isFalling: boolean): string {
  const chute = isFalling
    ? `<path d="M2 2 Q 16 -9 30 2 Z" fill="${INK.shine}"/><path d="M2 2 L12 13 M30 2 L20 13 M16 -3 L16 13" stroke="${INK.silver}" stroke-width="0.4"/>`
    : `<rect x="13" y="26" width="6" height="${2 + (t % 2)}" fill="${INK.orange}"/>`
  return chute + `<path d="M10 13 L22 13 L27 26 L5 26 Z" fill="${INK.flour}"/>` + crisp(px(13, 17, 6, 4, INK.visor) + px(5, 25, 22, 1, INK.concrete))
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
  const fish = Array.from({ length: Math.min(6, level) }, (_, i) =>
    px(30.5 + (i % 3) * 1.6, 19 - Math.floor(i / 3) * 1.4, 1, 2.5, INK.fish),
  ).join('')
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

// Astronaut: Rakete rechts mit Tankanzeige im Rumpf; der Treibstoff fließt im Tempo, ganz voll hebt sie ab.
function rocketSvg(scene: Scene, colors: SceneColors): string {
  const { water, strength, tick, level } = scene
  const isOn = water !== null
  const lift = isOn && level >= 10 ? (tick % 6) * 0.8 : 0
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
    const x =
      arrival < ARRIVE.in
        ? -40 * (1 - arrival / ARRIVE.in)
        : arrival < ARRIVE.in + ARRIVE.hold
          ? 0
          : 64 * ((arrival - ARRIVE.in - ARRIVE.hold + 1) / ARRIVE.out)
    if (role === 'astronaut') {
      // Die Kapsel schwebt am Fallschirm herab und startet wieder nach oben.
      const y = arrival < ARRIVE.in ? -32 * (1 - arrival / ARRIVE.in) : arrival < ARRIVE.in + ARRIVE.hold ? 0 : -40 * ((arrival - ARRIVE.in - ARRIVE.hold + 1) / ARRIVE.out)
      parts.push(`<g transform="translate(0 ${y.toFixed(1)})">${capsulePx(arrival, arrival < ARRIVE.in)}</g>`)
    } else {
      const vehicle =
        role === 'garden' ? tractorPx(arrival, colors) : role === 'angler' ? rowboatPx(arrival) : role === 'baker' ? bikePx() : truckPx(arrival)
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
      baker: 'cargo bike arriving',
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
