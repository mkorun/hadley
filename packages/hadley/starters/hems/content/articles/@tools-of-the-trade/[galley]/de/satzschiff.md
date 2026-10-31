---
publishFrom: 2026-07-22
author: $(persons/odile)
category: Werkzeuge
description: Teil zwei: das Satzschiff, die Fahne und der Schließrahmen, und das Werkzeug, das diese Site baut und nach ihnen benannt ist.
noindex: true   # Beispielinhalt: diese Zeile löschen, sobald die Seite deine ist
---
# Das Satzschiff

**Teil zwei einer kleinen Serie über die Werkzeuge des Handsatzes: wo die Zeilen warteten, bis sie eine Seite wurden.**

Vom Winkelhaken kamen die Zeilen auf das Satzschiff, englisch *galley*: ein flaches Brett aus Messing oder Holz, an
einer Seite offen, auf dem die Zeilen als Spalte zusammenstanden. Auf dem Satzschiff wurde die Spalte mit einer Schnur
umbunden, eingefärbt und auf einen Papierstreifen abgezogen. Dieser erste Abzug war die *Fahne*, und auf ihr
markierte der Korrektor in Rot, was falsch war.

<m data-style=ink>![Ein langes Brett mit gesetzten Lettern, mit Schnur umbunden, daneben ein Abzug](galley.png)</m>

## Vom Satzschiff zur Seite

Korrigiert wurde die Spalte in Seiten geteilt, und die Seiten wurden in einen schweren eisernen Rahmen geschlossen,
den *Schließrahmen*, englisch *chase*, mit Keilen und Blindmaterial, bis sich nichts mehr bewegte. Erst dann ging die
Seite in die Presse.

## Namen, die blieben

Diese Site baut hadley, ein Generator für statische Websites, dessen Teile nach dieser Werkstatt benannt sind. Die
Namen sind keine Dekoration; jeder sagt, was der Teil tut:

| In der Werkstatt | Was es war | In hadley |
| :--- | :--- | :--- |
| case, der Setzkasten | das Fächerbrett für die Lettern | `case`, das den Inhalt liest |
| galley, das Satzschiff | das Brett, auf dem Zeilen zur Spalte werden | galley, die Template-Sprache |
| chase, der Schließrahmen | der Rahmen, der eine Seite festhält | `.chase`, das Template einer ganzen Seite |
| sort, die Letter | ein einzelnes Stück Schrift | `.sort`, ein Partial, ein Stück eines Templates |
| quad, das Geviert | der Zwischenraum, der eine Zeile füllt | quad, das das HTML aufräumt |

## Diese Site setzen

Ein Setzer stellte die Satzbreite ein, bevor er die erste Letter griff. Eine Site sagt, was sie ist, bevor die erste
Seite entsteht, in ihrer `config.lima`. Das ist ein Teil der Konfiguration dieser Site:

```lima
site:
  origin: https://example.org
  default:
    language: en
    title: Feather Cat

navigations:
  main: [about]
  footer: [about, imprint, feed]

theme:
  colorToggle: true
```

Der Rest ist Handarbeit, damals wie heute: eine Zeile nach der anderen.
