# Burn – Clawd-Leiste für Claude Code

Ein Mod für Claude Code: eine dezente Leiste über dem Eingabefeld mit deinen Nutzungslimits wie in `/usage` (Session, Woche, Kontext), per Klick durchschaltbar, rechts ein Live-Tokenzähler mit Kosten.

Daneben steht Clawd. KI trinkt Wasser: Rechenzentren verdunsten Kühlwasser, jede Antwort kostet ein paar Schlucke. Clawd weiß das und spielt es pro Sitzung in einer ausgelosten Rolle nach:

| Rolle | Tempo (Tokens pro Sekunde) | Größe (Tokens der Sitzung) |
|---|---|---|
| Hahn | Clawd dreht auf und scrollt am Handy, das Wasser läuft ungenutzt in den Abfluss; nur solange Tokens fließen | Je mehr Liter, desto bequemer: Hocker ab 1 L, Liegestuhl ab 5 L, Sonnenschirm mit Drink ab 20 L |
| Cloud | Es regnet auf den Schirm, die Server in der Wolke blinken, bei Vollgas blitzt es | Wolke wird größer |
| Kühlturm | Der Serverschrank wird heiß, Clawd kühlt ihn mit dem Schlauch, es dampft | Kühlwassertank leert sich |
| Durst | Clawd gluckert aus der Flasche | Leere Flaschen stapeln sich |
| See | Clawd schlürft mit dem Strohhalm, es blubbert | Der See trocknet aus, am Ende zappelt ein Fisch |

Am Hahn steht neben dem Becken, wie viel Wasser verschwendet wurde, für den Zeitraum, den der Tokenzähler gerade zeigt. Gerechnet wird nach Mistrals Ökobilanz (2025) mit 45 ml pro 400 ausgegebenen Tokens; für 24h, 7d und 30d zählt der Mod ab Version 0.14.0 selbst mit, „all time“ kommt aus `/stats`.

Beim Start und nach 30 Minuten Pause kommt Clawd erst an (zu Fuß mit Handy oder Schirm, im Feuerwehrauto, auf dem Lastenrad mit Wasserkiste oder im Ruderboot).

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
- `/clawd` wechselt Clawds Rolle; `/clawd hahn`, `/clawd wolke`, `/clawd kühlturm`, `/clawd durst` oder `/clawd see` wählen eine bestimmte.

Unter 80 Spalten Terminalbreite tritt Clawd beiseite, damit die Zahlen Platz haben.

## Entwickeln

Tests: `claude plugin test .` im Repo-Ordner.
