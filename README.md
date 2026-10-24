# Nutzung – Clawd-Leiste für Claude Code

Ein Mod für Claude Code: eine dezente Leiste über dem Eingabefeld mit deinen Nutzungslimits wie in `/usage` (Session, Woche, Kontext), per Klick durchschaltbar, rechts ein Live-Tokenzähler mit Kosten.

Daneben steht Clawd. Pro Sitzung wird eine Rolle ausgelost:

| Rolle | Tempo (Tokens pro Sekunde) | Größe (Tokens der Sitzung) |
|---|---|---|
| Stausee | Feuerwehrschlauch tropft bis spritzt | Pegel hinter der Staumauer steigt |
| Feuer | Clawd löscht, in Pausen lodert es auf | – |
| Garten | Gießkanne tröpfelt bis sprüht | Blumenbeet wächst |
| Regen | Es regnet auf den Schirm | Wolke wird größer |
| Angler | Die Pose wippt, bei viel Tempo beißt einer an | Fische im Eimer |
| Bäcker | Ofen glüht und dampft | Brotstapel wächst |
| Astronaut | Treibstoff fließt in die Rakete | Tankanzeige füllt sich |

Beim Start und nach 30 Minuten Pause kommt Clawd erst angefahren (Feuerwehrauto, Traktor, Ruderboot, Lastenrad, Landekapsel oder zu Fuß).

## Installieren

```bash
claude plugin marketplace add llouiis/claude-nutzung
```

```bash
claude plugin install nutzung@claude-nutzung
```

Danach Claude Code neu starten.

## Updates holen

```bash
claude plugin marketplace update claude-nutzung
```

```bash
claude plugin update nutzung@claude-nutzung
```

Danach Claude Code neu starten.

## Befehle

- `/tokens` blendet die Leiste aus und ein.
- `/tokenstats` öffnet Usage, Stats und Context im Stil von `/usage`.
- `/clawd` wechselt Clawds Rolle; `/clawd garten`, `/clawd feuer`, `/clawd angler` usw. wählen eine bestimmte.

Unter 80 Spalten Terminalbreite tritt Clawd beiseite, damit die Zahlen Platz haben.

## Entwickeln

Tests: `claude plugin test .` im Repo-Ordner.
