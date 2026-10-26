# Burn – Clawd-Leiste für Claude Code

Ein Mod für Claude Code: eine dezente Leiste über dem Eingabefeld mit deinen Nutzungslimits wie in `/usage` (Session, Woche, Kontext), per Klick durchschaltbar, rechts ein Live-Tokenzähler mit Kosten. Der Zähler schreibt die Tokens seit 0.19.0 immer aus, mit Punkten gegliedert („1.725.034.112 tokens“).

Daneben steht Clawd. KI verschwendet Wasser: Rechenzentren verdunsten Kühlwasser, jede Antwort kostet ein paar Schlucke. Clawd spielt das pro Sitzung in einer von zwei ausgelosten Rollen nach, und Wasser fließt nur, solange Tokens fließen:

| Rolle | Tempo (Tokens pro Sekunde) | Größe (Tokens der Sitzung) |
|---|---|---|
| Hahn | Clawd dreht auf und scrollt am Handy, das Wasser läuft ungenutzt in den Abfluss; nur solange Tokens fließen | Je mehr Liter, desto bequemer: Hocker ab 1 L, Liegestuhl ab 5 L, Sonnenschirm mit Drink ab 20 L |
| Dusche | Clawd singt mit Duschhaube unter der Dauerdusche, der Strahl prasselt | Der Dampf wird dichter, bis man ihn kaum noch sieht |

Streamt gerade nichts, läuft eine ruhige Schleife von 15 Sekunden: Clawd blinzelt ab und zu. Am Hahn scrollt er weiter am Handy, und der Hahn ist nie ganz zu, einmal je Schleife tropft er ins Becken. Unter der Dusche shampooniert er sich, Seifenblasen steigen auf und zerplatzen. Pool, Wanne und See gab es bis 0.18.0.

Neben jeder Szene steht, wie viel Wasser verschwendet wurde, für den Zeitraum, den der Tokenzähler gerade zeigt. Gerechnet wird nach Mistrals Ökobilanz (2025) mit 45 ml pro 400 ausgegebenen Tokens; für 24h, 7d und 30d zählt der Mod ab Version 0.14.0 selbst mit, „all time“ kommt aus `/stats`.

Beim Start und nach 30 Minuten Pause kommt Clawd erst an, zu Fuß mit Handy oder Handtuch.

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
- `/clawd` wechselt Clawds Rolle; `/clawd hahn` oder `/clawd dusche` wählen eine bestimmte.

Unter 80 Spalten Terminalbreite tritt Clawd beiseite, damit die Zahlen Platz haben.

In der Desktop-App und in VS Code steht alles in einer ruhigen Zeile, der Text mittig neben Clawd. Klickbar ist dort nur der Zeitraum (`session ›`), damit die Apps keinen großen Knopf zeichnen. Die Breiten sind geschätzt und großzügig gerechnet; liegt die Schätzung doch daneben, kürzen die Limits links ihr Ende mit „…“, statt umzubrechen oder über den Rand zu laufen. Clawd, Zähler und Knöpfe bleiben ganz.

In der Desktop-App ist Clawd doppelt so groß wie seine Pixelvorlage (120 × 54 px, auf Retina gestochen scharf). Wird das Fenster schmaler (unter rund 115 Zeichen), steht er anderthalbmal so groß (90 × 41 px); unter rund 110 Zeichen rückt der Zähler mit ihm unter die Limits, unter rund 51 tritt er beiseite. Die Schwellen gelten bis 999.999.999 Tokens „all time“; darüber braucht der ausgeschriebene Zähler zwei Zeichen mehr. Ein breiteres Fenster zeigt ihn nie kleiner als ein schmaleres.

VS Code zeichnet keine Svg-Bilder in der Leiste (es zeigt nur deren Beschreibung) und Text nur in seiner Chat-Schrift. Dort ist der Balken deshalb ein flacher Streifen, und Clawd steht mit seiner Szene aus farbigen Kästchen da, so groß wie in der Desktop-App: ab rund 115 Zeichen in voller Größe, schmaler kleiner, unter rund 111 Zeichen mit dem Zähler unter den Limits, unter rund 52 so klein wie seine Pixelvorlage (seit 0.21.0, damit er im schmalen Seitenpanel nicht verschwindet), unter rund 47 gar nicht. Heatmap, Diagramm und Tabellen in `/tokenstats` sind dort ebenfalls aus Kästchen und festen Spalten gebaut.

Seit 0.18.0 bleiben die Liter in den Apps stehen, solange Clawd Platz hat: Wird es eng, wird erst Clawd kleiner und rückt mit dem Zähler unter die Limits, dann geht der Preis und erst ganz zuletzt gehen die Liter. Seit 0.19.0 stehen die Liter in voller Farbe statt gedimmt da, damit man sie auch in VS Code lesen kann. In einer Zeile steht die Leiste nur, wenn Liter und Preis mit hineinpassen.

`/tokenstats` liest für die Statistik Claude Codes `/stats`-Zwischenspeicher. Den schreibt Claude Code aber nur neu, wenn `/stats` im Terminal läuft; wer in der Desktop-App oder in VS Code arbeitet, sah dort alte Zahlen. Seit 0.19.0 führt Burn deshalb ein eigenes Tagebuch je Unterhaltung und zählt alle Tage nach dem letzten Rechentag des Zwischenspeichers selbst: Tokens je Modell, Messages, Tool-Calls, Sitzungen und Startstunden. Messages zählt Burn wie die Zeilen im Transkript (Prompts, Antwortblöcke, Tool-Ergebnisse); Anhänge und Systemzeilen, die `/stats` mitzählt, sieht der Mod nicht, deshalb liegt der Wert etwas darunter. Tokens, die Burn vor 0.19.0 nur im Stundenbuch gezählt hat, stehen ohne Modell als „Untracked“.

Seit 0.16.0 merkt sich der Mod die Tokens jeder Unterhaltung: Setzt du eine Sitzung fort, passen Preis und Tokens zusammen. Seit 0.17.1 zählen auch die Tokens eines `/compact` mit, dessen Preis schon immer drin war.

## Entwickeln

Tests: `claude plugin test .` im Repo-Ordner.
