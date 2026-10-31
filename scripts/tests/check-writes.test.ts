import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFindings } from '../check-writes.ts'

describe('writeFindings', () => {
  it('reports the calls that write to the file system', () => {
    const text = [
      "await writeFile(path, 'x')",
      'await fs.copyFile(a, b)',
      'mkdirSync(dir, { recursive: true })',
      'await sharp(src).resize(4).toFile(dest)',
      'await rm(dir, { force: true })',
      'await Bun.write(path, text)',
      'const out = createWriteStream(path)',
      "await index.writeFiles({ outputPath: 'pagefind' })",
    ].join('\n')
    assert.deepEqual(
      writeFindings(text),
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${n}: writes to the file system`),
    )
  })

  it('leaves out reading, a name that only ends like a write, and comments', () => {
    const text = [
      "const text = await readFile(path, 'utf8')",
      'const ok = confirm(x) && transform(y)',
      '// await writeFile(path, text)',
      ' * then writeFile(cachePath, json)',
    ].join('\n')
    assert.deepEqual(writeFindings(text), [])
  })
})
