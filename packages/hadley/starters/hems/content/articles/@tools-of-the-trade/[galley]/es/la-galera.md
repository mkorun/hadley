---
publishFrom: 2026-07-22
author: $(persons/odile)
category: Herramientas
description: Segunda parte: la galera, la galerada y la rama, y la herramienta que construye este sitio y lleva sus nombres.
noindex: true   # Contenido de ejemplo: borra esta línea cuando la página sea tuya
---
# La galera

**Segunda parte de una pequeña serie sobre las herramientas de la composición a mano: donde las líneas esperaban hasta convertirse en página.**

Del componedor, las líneas pasaban a la galera, en inglés *galley*: una bandeja poco profunda de latón o de madera,
abierta por un extremo, donde las líneas se juntaban en una columna. Sobre la galera, la columna se ataba con un
cordel, se entintaba y se estampaba en una tira de papel. Esa primera prueba era la *galerada*, y en ella el corrector
marcaba en rojo lo que estaba mal.

<m data-style=ink>![Una larga bandeja de tipos compuestos, atada con un cordel, y una prueba al lado](galley.png)</m>

## De la galera a la página

Una vez corregida, la columna se cortaba en páginas, y las páginas se encerraban en un pesado marco de hierro, la
*rama*, en inglés *chase*, con cuñas y material de relleno hasta que nada pudiera moverse. Solo entonces iba la página
a la prensa.

## Nombres que se quedaron

Este sitio lo construye hadley, un generador de sitios estáticos cuyas piezas llevan el nombre de este taller. Los
nombres no son decoración; cada uno dice lo que hace su pieza:

| En el taller | Qué era | En hadley |
| :--- | :--- | :--- |
| case, la caja | la bandeja de cajetines para los tipos | `case`, que lee el contenido |
| galley, la galera | la bandeja donde las líneas se vuelven columna | galley, el lenguaje de plantillas |
| chase, la rama | el marco que sujeta una página | `.chase`, la plantilla de una página entera |
| sort, el tipo | una sola letra de metal | `.sort`, una plantilla parcial, una pieza de una plantilla |
| quad, el cuadratín | el espacio que rellena una línea | quad, que pone en orden el HTML |

## Componer este sitio

El cajista fijaba la medida antes de tomar la primera letra. Un sitio dice lo que es antes de la primera página, en su
`config.lima`. Esta es una parte de la configuración de este sitio:

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

El resto es trabajo de la mano, ahora como entonces: una línea tras otra.
