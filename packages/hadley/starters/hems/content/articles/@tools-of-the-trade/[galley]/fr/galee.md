---
publishFrom: 2026-07-22
author: $(persons/odile)
category: Outils
description: Seconde partie : la galée, l'épreuve et le châssis, et l'outil qui construit ce site et leur doit son nom.
noindex: true   # Exemple de contenu : supprimez cette ligne dès que la page est la vôtre
---
# La galée

**Seconde partie d'une petite série sur les outils de la composition à la main : là où les lignes attendaient de devenir une page.**

Du composteur, les lignes passaient sur la galée, *galley* en anglais : un plateau peu profond, de laiton ou de bois,
ouvert d'un côté, où les lignes se tenaient serrées en colonne. Sur la galée, on liait la colonne d'une ficelle, on
l'encrait et on la pressait sur une bande de papier. Ce premier tirage était l'*épreuve en placard*, et le correcteur y
marquait en rouge ce qui n'allait pas.

<m data-style=ink>![Un long plateau de caractères composés, liés d'une ficelle, une épreuve à côté](galley.png)</m>

## De la galée à la page

Une fois corrigée, la colonne était coupée en pages, et les pages étaient serrées dans un lourd cadre de fer, le
*châssis*, *chase* en anglais, avec des coins et de la garniture, jusqu'à ce que plus rien ne puisse bouger. Alors
seulement la page passait sous la presse.

## Des noms qui sont restés

Ce site est construit par hadley, un générateur de sites statiques dont les parties portent les noms de cet atelier. Ces
noms ne sont pas de la décoration ; chacun dit ce que fait la partie :

| Dans l'atelier | Ce que c'était | Dans hadley |
| :--- | :--- | :--- |
| case, la casse | le casier à cassetins pour les caractères | `case`, qui lit le contenu |
| galley, la galée | le plateau où les lignes deviennent une colonne | galley, le langage de gabarits |
| chase, le châssis | le cadre qui serre une page | `.chase`, le gabarit d'une page entière |
| sort, la sorte | un caractère isolé de la fonte | `.sort`, un partial, un morceau de gabarit |
| quad, le cadrat | le blanc qui remplit une ligne | quad, qui met de l'ordre dans le HTML |

## Composer ce site

Le typographe réglait la justification avant de prendre la première lettre. Un site dit ce qu'il est avant que naisse la
première page, dans son `config.lima`. Voici un extrait de celui de ce site :

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

Le reste est affaire de main, aujourd'hui comme autrefois : une ligne après l'autre.
