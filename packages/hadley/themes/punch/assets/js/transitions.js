// punch: the picture of a card grows into the cover of its post when the page changes, and back again (View
// Transitions, style.css "page changes"). The card that links the page the browser goes to, or comes back from, is
// named for the moment; the post's cover always is. Loaded before the page renders, as pagereveal asks.
const pictureOf = (url) =>
  [...document.querySelectorAll('.card')]
    .find((card) => card.querySelector('.entry-title a')?.href === url)
    ?.querySelector('.card-image')

const name = (picture, transition) => {
  picture.style.viewTransitionName = 'cover'
  transition.finished.finally(() => picture.style.removeProperty('view-transition-name'))
}

window.addEventListener('pageswap', (event) => {
  const picture = event.viewTransition && event.activation?.entry?.url && pictureOf(event.activation.entry.url)
  if (picture) name(picture, event.viewTransition)
})

window.addEventListener('pagereveal', (event) => {
  const from = window.navigation?.activation?.from?.url
  if (!event.viewTransition || !from) return
  // the cards are there: the home page renders once its footer is read (head.sort, rel=expect)
  const picture = pictureOf(from)
  if (picture) name(picture, event.viewTransition)
})
