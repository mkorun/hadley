/** Run a build without its terminal log, restoring both streams even when it fails. */
export async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const write = process.stdout.write.bind(process.stdout)
  const error = process.stderr.write.bind(process.stderr)
  process.stdout.write = () => true
  process.stderr.write = () => true
  try {
    return await run()
  } finally {
    process.stdout.write = write
    process.stderr.write = error
  }
}
