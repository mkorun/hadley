/**
 * The colour matrices a theme draws its cover styles with: a token `--cover-<style>` in the :root of its stylesheet,
 * 20 numbers as SVG's feColorMatrix takes them (docs/themes.md, "Covers"). A template writes the matrix of its page's
 * cover style into its filter, and an og image makes the cover through it, so that the numbers stand in one place.
 */
import { readCssTokensStartingWith } from './read-css-tokens.ts'

export type CoverMatrices = Record<string, number[]>

/** The matrices by cover style; one that is not 20 numbers stops the build, with every such token named. */
export async function readCoverMatrices(siteDir: string): Promise<CoverMatrices> {
  const matrices: CoverMatrices = {}
  const wrong: string[] = []
  for (const [style, value] of Object.entries(await readCssTokensStartingWith(siteDir, '--cover-'))) {
    const numbers = value.split(/[\s,]+/).map(Number)
    if (numbers.length === 20 && numbers.every(Number.isFinite)) matrices[style] = numbers
    else wrong.push(`--cover-${style}`)
  }
  if (wrong.length > 0)
    throw new Error(
      `${wrong.join(', ')} in theme/assets/css/style.css must be 20 numbers, a colour matrix as feColorMatrix takes it`,
    )
  return matrices
}
