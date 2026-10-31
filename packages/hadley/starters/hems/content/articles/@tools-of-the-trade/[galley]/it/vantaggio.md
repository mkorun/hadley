---
publishFrom: 2026-07-22
author: $(persons/odile)
category: Strumenti
description: Seconda parte: il vantaggio, la bozza e il telaio, e lo strumento che costruisce questo sito e porta il loro nome.
noindex: true   # Contenuto di esempio: cancella questa riga quando la pagina sarà tua
---
# Il vantaggio

**Seconda parte di una piccola serie sugli strumenti della composizione a mano: dove le righe aspettavano di diventare una pagina.**

Dal compositoio le righe passavano sul vantaggio, in inglese *galley*: una tavoletta di ottone o di legno dai bordi
bassi, aperta da un lato, su cui le righe stavano insieme in colonna. Sul vantaggio la colonna veniva legata con lo
spago, inchiostrata e premuta su una striscia di carta. Quella prima prova di stampa era la *bozza in colonna*, e su di
essa il correttore segnava in rosso ciò che era sbagliato.

<m data-style=ink>![Una lunga tavoletta di caratteri composti, legati con lo spago, e accanto una bozza](galley.png)</m>

## Dal vantaggio alla pagina

Corretta, la colonna veniva divisa in pagine, e le pagine venivano serrate in una pesante cornice di ferro, il
*telaio*, in inglese *chase*, con cunei e marginature, finché niente poteva più muoversi. Solo allora la pagina andava
in macchina.

## Nomi che sono rimasti

Questo sito lo costruisce hadley, un generatore di siti statici le cui parti prendono il nome da questa bottega. I nomi
non sono decorazione; ognuno dice che cosa fa la sua parte:

| In bottega | Che cos'era | In hadley |
| :--- | :--- | :--- |
| case, la cassa | il mobile a scomparti per i caratteri | `case`, che legge i contenuti |
| galley, il vantaggio | la tavoletta su cui le righe diventano colonna | galley, il linguaggio dei template |
| chase, il telaio | la cornice che serra una pagina | `.chase`, il template di una pagina intera |
| sort, il tipo | un singolo carattere mobile | `.sort`, un partial, un pezzo di template |
| quad, il quadratino | lo spazio che riempie una riga | quad, che mette in ordine l'HTML |

## Comporre questo sito

Il compositore regolava la giustezza prima di prendere la prima lettera. Un sito dice che cos'è prima che nasca la
prima pagina, nel suo `config.lima`. Ecco una parte della configurazione di questo sito:

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

Il resto è lavoro di mano, oggi come allora: una riga dopo l'altra.
