# Burn – Clawd-Leiste für Claude Code

Ein Mod für Claude Code: eine dezente Leiste über dem Eingabefeld mit deinen Nutzungslimits wie in `/usage` (Session, Woche, Kontext), per Klick durchschaltbar, rechts ein Live-Tokenzähler mit Kosten. Der Zähler schreibt die Tokens seit 0.19.0 immer aus, mit Punkten gegliedert („1.725.034.112 tokens“).

Daneben steht Clawd. KI verschwendet Wasser: Rechenzentren verdunsten Kühlwasser, jede Antwort kostet ein paar Schlucke. Clawd spielt das pro Sitzung in einer von zwei ausgelosten Rollen nach, und Wasser fließt nur, solange Tokens fließen:

| Rolle | Tempo (Tokens pro Sekunde) | Größe (Tokens der Sitzung) |
|---|---|---|
| Wasserspender | Clawds Laptop trinkt: Solange Tokens fließen, strömt Wasser durch einen Schlauch vom Spender zum Laptop, im Ballon steigen Blasen auf und über dem Laptop verdampft es wie im Rechenzentrum; je mehr Tokens pro Sekunde, desto schneller, dicker und dampfiger | Der Ballon (1 L) leert sich mit den Litern der Sitzung; ist er leer, kommt ein voller, und der leere liegt daneben (bis zu drei). Im Terminal steht noch der Hahn mit der Pfütze |
| Dusche | Clawd tippt unter der Dauerdusche am Laptop, der Strahl prasselt auf ihn | Der Dampf wird dichter, bis man ihn kaum noch sieht |

Streamt gerade nichts, läuft eine ruhige Schleife von 15 Sekunden: Clawd blinzelt ab und zu. Am Hahn ruht er am Laptop, und der Hahn ist nie ganz zu, einmal je Schleife tropft er in die Pfütze. Unter der Dusche steigen Seifenblasen auf und zerplatzen. Pool, Wanne und See gab es bis 0.18.0.

Neben jeder Szene steht, wie viel Wasser verschwendet wurde, für den Zeitraum, den der Tokenzähler gerade zeigt. Gerechnet wird nach Mistrals Ökobilanz (2025) mit 45 ml pro 400 ausgegebenen Tokens; für 24h, 7d und 30d zählt der Mod ab Version 0.14.0 selbst mit, „all time“ kommt aus `/stats`.

Beim Start und nach 30 Minuten Pause kommt Clawd erst an. Am Hahn steht er schon da, halb von der Seite wie im Startbild von Claude Code, und klappt den Laptop vor sich auf dem Boden auf, dann haut er in die Tasten und dreht nebenbei den Hahn auf; zur Dusche kommt er zu Fuß mit Laptop und Handtuch.

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
- `/clawd` wechselt Clawds Rolle; `/clawd spender` (oder `hahn`) und `/clawd dusche` wählen eine bestimmte.

Unter 80 Spalten Terminalbreite tritt Clawd beiseite, damit die Zahlen Platz haben.

In der Desktop-App und in VS Code steht alles in einer ruhigen Zeile, der Text mittig neben Clawd. Klickbar ist dort nur der Zeitraum (`session ›`), damit die Apps keinen großen Knopf zeichnen. Die Breiten sind geschätzt und großzügig gerechnet; liegt die Schätzung doch daneben, kürzen die Limits links ihr Ende mit „…“, statt umzubrechen oder über den Rand zu laufen. Clawd, Zähler und Knöpfe bleiben ganz.

In der Desktop-App ist Clawd doppelt so groß wie seine Pixelvorlage (120 × 54 px, auf Retina gestochen scharf). Wird das Fenster schmaler (unter rund 115 Zeichen), steht er anderthalbmal so groß (90 × 41 px); unter rund 110 Zeichen rückt der Zähler mit ihm unter die Limits, unter rund 51 tritt er beiseite. Die Schwellen gelten bis 999.999.999 Tokens „all time“; darüber braucht der ausgeschriebene Zähler zwei Zeichen mehr. Ein breiteres Fenster zeigt ihn nie kleiner als ein schmaleres.

VS Code zeichnet keine Svg-Bilder in der Leiste (es zeigt nur deren Beschreibung) und Text nur in seiner Chat-Schrift. Dort ist der Balken deshalb ein flacher Streifen, und Clawd steht mit seiner Szene aus farbigen Kästchen da, so groß wie in der Desktop-App: ab rund 115 Zeichen in voller Größe, schmaler kleiner, unter rund 111 Zeichen mit dem Zähler unter den Limits, darunter schrumpft er je Zeichen um ein Zehntel bis auf die Größe seiner Pixelvorlage (seit 0.21.0, damit er im schmalen Seitenpanel nicht verschwindet), unter rund 47 gar nicht. Heatmap, Diagramm und Tabellen in `/tokenstats` sind dort ebenfalls aus Kästchen und festen Spalten gebaut.

Seit 0.18.0 bleiben die Liter in den Apps stehen, solange Clawd Platz hat: Wird es eng, wird erst Clawd kleiner und rückt mit dem Zähler unter die Limits, dann geht der Preis und erst ganz zuletzt gehen die Liter. Seit 0.19.0 stehen die Liter in voller Farbe statt gedimmt da, damit man sie auch in VS Code lesen kann. Seit 0.23.1 stehen sie in einem eigenen kräftigen Wasserblau und halbfett da. In einer Zeile steht die Leiste nur, wenn Liter und Preis mit hineinpassen. Seit 0.22.0 stehen die Liter in der gestapelten Leiste über dem Zähler rechts neben Clawd; so kosten sie keine Breite und bleiben, solange Clawd dasteht.

Seit 0.23.0 gibt es am Hahn kein Waschbecken mehr: Ein Rohr kommt von oben, das Wasser läuft auf den Boden, und dort wächst die Pfütze mit den verschwendeten Litern. Clawd steht dort 1,2-fach so groß wie gezeichnet. Wie schnell das Wasser läuft, folgt den Tokens pro Sekunde: bei 100 ein Bild alle 150 ms, bei 200 doppelt so schnell, höchstens dreifach, mindestens halb so schnell.

Seit 0.24.0 sieht Clawd in den Apps aus wie im Logo von Claude Code: breiter Körper, hohe schmale Augen, Ärmchen seitlich, vier dünne Beine. Er hält einen Laptop vor sich und tippt, solange Claude arbeitet, mit abwechselnd hochschnellenden Ärmchen und im Tempo der Tokens pro Sekunde; das Display glimmt dabei. Hocker, Liegestuhl, Sonnenschirm, Duschhaube und Singen gibt es nicht mehr: er arbeitet, während das Wasser läuft. Der Strahl am Hahn ist stufenlos so dick wie die Liter pro Sekunde (45 ml je 400 Tokens). Im Terminal bleibt Clawd Text wie bisher, nur ohne Möbel und Haube.

Seit 0.24.1 hängt der Brausekopf ganz oben, ein Stück über Clawds Kopf; dazwischen sieht man den Strahl.

Seit 0.25.0 tippt Clawd in eigenem Takt, so schnell wie die Tokens kommen: je 10 Tokens pro Sekunde ein Anschlag, mindestens 4 und höchstens 20 je Sekunde. Am Hahn steht er in den Apps wie im Startbild von Claude Code: nach links gewandt, die rechte Seite im Schatten, das Ärmchen vorgestreckt; beim Ankommen schwingt der Deckel des Laptops auf dem Boden schräg nach hinten auf, beim Tippen schnellt das Ärmchen auf und ab. Im Terminal schnellen dabei abwechselnd seine Ärmchen hoch, und der Laptop wächst beim Aufklappen von ▁ bis ▮.

Seit 0.26.0 steht in den Apps statt des Wasserhahns ein Wasserspender neben Clawd, der jetzt nach links zu seinem Laptop schaut; der Hahn stand hinter seinem Rücken. Der Spender zeigt den Verbrauch direkter: Der Laptop trinkt aus dem Ballon, das Wasser verdampft, und die leeren Ballons zählen die Liter.

`/tokenstats` liest für die Statistik Claude Codes `/stats`-Zwischenspeicher. Den schreibt Claude Code aber nur neu, wenn `/stats` im Terminal läuft; wer in der Desktop-App oder in VS Code arbeitet, sah dort alte Zahlen. Seit 0.19.0 führt Burn deshalb ein eigenes Tagebuch je Unterhaltung und zählt alle Tage nach dem letzten Rechentag des Zwischenspeichers selbst: Tokens je Modell, Messages, Tool-Calls, Sitzungen und Startstunden. Messages zählt Burn wie die Zeilen im Transkript (Prompts, Antwortblöcke, Tool-Ergebnisse); Anhänge und Systemzeilen, die `/stats` mitzählt, sieht der Mod nicht, deshalb liegt der Wert etwas darunter. Tokens, die Burn vor 0.19.0 nur im Stundenbuch gezählt hat, stehen ohne Modell als „Untracked“.

Seit 0.16.0 merkt sich der Mod die Tokens jeder Unterhaltung: Setzt du eine Sitzung fort, passen Preis und Tokens zusammen. Seit 0.17.1 zählen auch die Tokens eines `/compact` mit, dessen Preis schon immer drin war.

## Entwickeln

Tests: `claude plugin test .` im Repo-Ordner.
