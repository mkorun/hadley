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

/** Run a build and give what it wrote to each stream, restoring both even when it fails. */
export async function logOf(run: () => Promise<unknown>): Promise<{ stdout: string; stderr: string }> {
  const log = { stdout: '', stderr: '' }
  const write = process.stdout.write.bind(process.stdout)
  const error = process.stderr.write.bind(process.stderr)
  process.stdout.write = (text) => {
    log.stdout += String(text)
    return true
  }
  process.stderr.write = (text) => {
    log.stderr += String(text)
    return true
  }
  try {
    await run()
    return log
  } finally {
    process.stdout.write = write
    process.stderr.write = error
  }
}
