/**
 * The certificate `hadley dev --https` serves with (docs/dev-server.md): the files the user configuration names
 * (`dev.https`), else one mkcert made for localhost, made once into the user configuration's `certs/` when mkcert
 * is on the PATH. Without either, it stops and says how to get one. hadley installs no certificate authority; the
 * browser trusts the certificate once mkcert's root is installed where it looks (`mkcert -install`, and on Windows
 * `certutil -user -addstore Root`).
 */
import { spawnSync } from 'node:child_process'
import { access, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { onPath } from './platform.ts'
import { userConfigDir, type UserConfig } from './user-config.ts'

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

const HINT = `hadley dev --https needs a certificate for localhost. Either
  - install mkcert (https://github.com/FiloSottile/mkcert) and run \`mkcert -install\` once; hadley then makes the
    certificate itself. On WSL, a browser on Windows trusts it once the root \`mkcert -CAROOT\` names is imported
    there: certutil -user -addstore Root rootCA.pem (the .pem, never rootCA-key.pem); or
  - name your own files in the user configuration (docs/dev-server.md):
      dev:
        https:
          cert: localhost.pem
          key:  localhost-key.pem`

/** The certificate and key, as Vite's `server.https` takes them. */
export async function devCertificate(
  config: UserConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ cert: Buffer; key: Buffer }> {
  let files = config.dev.https
  if (!files) {
    const dir = join(userConfigDir(env), 'certs')
    files = { cert: join(dir, 'localhost.pem'), key: join(dir, 'localhost-key.pem') }
    if (!(await exists(files.cert)) || !(await exists(files.key))) {
      const mkcert = onPath('mkcert', env.PATH)
      if (!mkcert) throw new Error(`mkcert is not on the PATH.\n${HINT}`)
      await mkdir(dir, { recursive: true })
      const made = spawnSync(
        mkcert,
        ['-cert-file', files.cert, '-key-file', files.key, 'localhost', '127.0.0.1', '::1'],
        { encoding: 'utf-8', timeout: 30_000, env },
      )
      if (made.error || made.status !== 0) {
        throw new Error(`mkcert failed: ${made.error?.message ?? made.stderr.trim()}.\n${HINT}`)
      }
    }
  }
  try {
    return { cert: await readFile(files.cert), key: await readFile(files.key) }
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${HINT}`, { cause: error })
  }
}
