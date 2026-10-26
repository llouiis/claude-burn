# Burn – Clawd-Leiste für Claude Code

Ein Mod für Claude Code: eine dezente Leiste über dem Eingabefeld mit deinen Nutzungslimits wie in `/usage` (Session, Woche, Kontext), per Klick durchschaltbar, rechts ein Live-Tokenzähler mit Kosten.

Daneben steht Clawd. KI verschwendet Wasser: Rechenzentren verdunsten Kühlwasser, jede Antwort kostet ein paar Schlucke. Clawd spielt das pro Sitzung in einer ausgelosten Rolle nach, und Wasser fließt nur, solange Tokens fließen:

| Rolle | Tempo (Tokens pro Sekunde) | Größe (Tokens der Sitzung) |
|---|---|---|
| Hahn | Clawd dreht auf und scrollt am Handy, das Wasser läuft ungenutzt in den Abfluss; nur solange Tokens fließen | Je mehr Liter, desto bequemer: Hocker ab 1 L, Liegestuhl ab 5 L, Sonnenschirm mit Drink ab 20 L |
| Dusche | Clawd singt mit Duschhaube unter der Dauerdusche, der Strahl prasselt | Der Dampf wird dichter, bis man ihn kaum noch sieht |
| Pool | Clawd spritzt mit Sonnenbrille und Gartenschlauch in den Pool, je schneller, desto weiter | Der Pool füllt sich, eine Ente schwimmt, am Ende läuft er über |
| Wanne | Der Hahn läuft in die Badewanne, in der Clawd sitzt | Der Schaum türmt sich bis auf seinen Kopf, am Ende schwappt es über |
| See | Clawd schlürft mit dem Strohhalm, es blubbert | Der See trocknet aus, am Ende zappelt ein Fisch |

Neben jeder Szene steht, wie viel Wasser verschwendet wurde, für den Zeitraum, den der Tokenzähler gerade zeigt. Gerechnet wird nach Mistrals Ökobilanz (2025) mit 45 ml pro 400 ausgegebenen Tokens; für 24h, 7d und 30d zählt der Mod ab Version 0.14.0 selbst mit, „all time“ kommt aus `/stats`.

Beim Start und nach 30 Minuten Pause kommt Clawd erst an (zu Fuß mit Handy, Handtuch oder Gartenschlauch, zum See im Ruderboot).

## Installieren

```bash
claude plugin marketplace add llouiis/claude-burn
```

```bash
claude plugin install burn@claude-burn
```

Danach Claude Code neu starten.

## Updates holen

```bash
claude plugin marketplace update claude-burn
```

```bash
claude plugin update burn@claude-burn
```

Danach Claude Code neu starten.

## Befehle

- `/tokens` blendet die Leiste aus und ein.
- `/tokenstats` öffnet Usage, Stats und Context im Stil von `/usage`.
- `/clawd` wechselt Clawds Rolle; `/clawd hahn`, `/clawd dusche`, `/clawd pool`, `/clawd wanne` oder `/clawd see` wählen eine bestimmte.

Unter 80 Spalten Terminalbreite tritt Clawd beiseite, damit die Zahlen Platz haben.

In der Desktop-App und in VS Code steht alles in einer ruhigen Zeile, der Text mittig neben Clawd. Klickbar ist dort nur der Zeitraum (`session ›`), damit die Apps keinen großen Knopf zeichnen. Die Breiten sind geschätzt und großzügig gerechnet; liegt die Schätzung doch daneben, kürzen die Limits links ihr Ende mit „…“, statt umzubrechen oder über den Rand zu laufen. Clawd, Zähler und Knöpfe bleiben ganz.

In der Desktop-App ist Clawd anderthalbmal so groß wie seine Pixelvorlage (90 × 41 px, auf Retina gestochen scharf). Wird das Fenster schmaler (unter rund 105 Zeichen), steht er in Originalgröße (60 × 27 px); unter rund 101 Zeichen rückt der Zähler mit ihm unter die Limits, unter rund 42 tritt er beiseite. Ein breiteres Fenster zeigt ihn nie kleiner als ein schmaleres.

VS Code zeichnet keine Svg-Bilder in der Leiste (es zeigt nur deren Beschreibung) und Text nur in seiner Chat-Schrift. Dort ist der Balken deshalb ein flacher Streifen, und Clawd steht mit seiner Szene aus farbigen Kästchen da, so groß wie in der Desktop-App: ab rund 106 Zeichen in voller Größe, schmaler kleiner, unter rund 101 Zeichen mit dem Zähler unter den Limits, unter rund 42 gar nicht. Heatmap, Diagramm und Tabellen in `/tokenstats` sind dort ebenfalls aus Kästchen und festen Spalten gebaut.

Seit 0.18.0 bleiben die Liter in den Apps stehen, solange Clawd Platz hat: Wird es eng, wird erst Clawd kleiner und rückt mit dem Zähler unter die Limits, dann geht der Preis und erst ganz zuletzt (unter rund 59 Zeichen) gehen die Liter. In einer Zeile steht die Leiste nur, wenn Liter und Preis mit hineinpassen.

Seit 0.16.0 merkt sich der Mod die Tokens jeder Unterhaltung: Setzt du eine Sitzung fort, passen Preis und Tokens zusammen. Seit 0.17.1 zählen auch die Tokens eines `/compact` mit, dessen Preis schon immer drin war.

## Entwickeln

Tests: `claude plugin test .` im Repo-Ordner.
