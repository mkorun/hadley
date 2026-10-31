import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { networkUrls, wslNetworking } from '../dev-addresses.ts'
import { devOptions, localOrigin, portInUse, siteEditor, sitePort } from '../dev-options.ts'
import { devCertificate } from '../dev-https.ts'
import { languageRecord } from '../site-config.ts'
import { readUserConfig } from '../user-config.ts'
import type { Config } from '../site.ts'

// How the dev server serves (docs/dev-server.md): its options, the user configuration, the certificate of --https,
// and where a local build sends comments.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-dev-options-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const env = (extra: Record<string, string> = {}) => ({ XDG_CONFIG_HOME: dir, PATH: '', ...extra })
const userConfig = (text: string) => {
  mkdirSync(join(dir, 'hadley'), { recursive: true })
  writeFileSync(join(dir, 'hadley', 'config.lima'), text)
}

describe('the options of hadley dev', () => {
  it('serve HTTP on localhost:8000 unless --port or --https say otherwise, and leave the rest', () => {
    assert.deepEqual(devOptions(['comments']), {
      options: { port: 8000, https: false, host: false },
      rest: ['comments'],
    })
    assert.equal(devOptions(['--host']).options.host, true)
    const { options } = devOptions(['--https', '--port', '8443'])
    assert.equal(localOrigin(options), 'https://localhost:8443')
    for (const port of [['--port'], ['--port', 'x'], ['--port', '0'], ['--port', '65535']])
      assert.throws(() => devOptions(port), /--port needs a port from 1 to 65534/)
  })

  it("serve on the site's port, dev.port of its config.lima, unless --port gives another", () => {
    assert.equal(sitePort(null), 8000)
    assert.equal(sitePort({ site: {} } as never), 8000)
    assert.equal(sitePort({ dev: { port: 8010 } }), 8010)
    assert.equal(devOptions([], sitePort({ dev: { port: 8010 } })).options.port, 8010)
    assert.equal(devOptions(['--port', '8443'], 8010).options.port, 8443)
    for (const port of ['8010', 0, 65535, 80.5])
      assert.throws(() => sitePort({ dev: { port } }), /config\.lima: dev\.port needs a port from 1 to 65534/)
  })

  it('turn the block editor on only where dev.editor of config.lima says true', () => {
    assert.equal(siteEditor(null), false)
    assert.equal(siteEditor({ dev: {} }), false)
    assert.equal(siteEditor({ dev: { editor: false } }), false)
    assert.equal(siteEditor({ dev: { editor: true } }), true)
    for (const editor of ['true', 1, 'yes'])
      assert.throws(() => siteEditor({ dev: { editor } }), /config\.lima: dev\.editor is true or false/)
  })

  it('tell a port something answers on from a free one', async () => {
    const server = createServer().listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as AddressInfo
    assert.equal(await portInUse(port), true)
    server.close()
    await once(server, 'close')
    assert.equal(await portInUse(port), false)
  })
})

describe('the addresses of hadley dev --host', () => {
  it('are the configured name first, then each external IPv4 address once', () => {
    const address = (address: string, family: 'IPv4' | 'IPv6', internal = false) =>
      ({ address, family, internal, netmask: '', mac: '', cidr: null }) as never
    const interfaces = {
      lo: [address('127.0.0.1', 'IPv4', true)],
      eth0: [address('192.168.1.20', 'IPv4'), address('fe80::1', 'IPv6')],
      wg0: [address('10.0.0.2', 'IPv4'), address('192.168.1.20', 'IPv4')],
    }
    assert.deepEqual(networkUrls({ port: 8000, https: false }, 'pc.fritz.box', interfaces), [
      'http://pc.fritz.box:8000',
      'http://192.168.1.20:8000',
      'http://10.0.0.2:8000',
    ])
    assert.deepEqual(networkUrls({ port: 8443, https: true }, undefined, { lo: interfaces.lo }), [])
  })
})

// Michael 2026-10-26: under WSL in NAT mode, --host showed an address of Linux no other device reaches
describe('the networking mode of WSL', () => {
  const told = (status: number | null, stdout: string) => () => ({ status, stdout }) as never
  it('is what wslinfo tells under WSL, unknown when it cannot, and nothing elsewhere', () => {
    const wsl = () => '6.18.33.2-microsoft-standard-WSL2\n'
    assert.equal(wslNetworking(wsl, told(0, 'nat\n')), 'nat')
    assert.equal(wslNetworking(wsl, told(0, 'mirrored\n')), 'mirrored')
    assert.equal(wslNetworking(wsl, told(null, '')), 'unknown')
    assert.equal(
      wslNetworking(
        () => '6.12.0-26-amd64\n',
        () => {
          throw new Error('wslinfo must not run outside WSL')
        },
      ),
      undefined,
    )
    assert.equal(
      wslNetworking(
        () => {
          throw new Error('no /proc')
        },
        told(0, 'nat'),
      ),
      undefined,
    )
  })
})

describe('the user configuration', () => {
  it('is empty without a file, and HADLEY_DEV_HOST names the host', async () => {
    assert.deepEqual(await readUserConfig(env()), { dev: { allowedHosts: [] } })
    assert.equal((await readUserConfig(env({ HADLEY_DEV_HOST: 'pc.fritz.box' }))).dev.hostname, 'pc.fritz.box')
  })

  it('reads its keys, with the paths of the certificate and the comments service relative to it', async () => {
    userConfig(
      `dev:\n  hostname: workstation.fritz.box\n  allowedHosts: [.trycloudflare.com]\n  https:\n    cert: c.pem\n    key: ${join(dir, 'k.pem')}\n  open: [wslview]\n  forms: bin/hadley-forms\n`,
    )
    assert.deepEqual(await readUserConfig(env()), {
      dev: {
        hostname: 'workstation.fritz.box',
        allowedHosts: ['.trycloudflare.com'],
        https: { cert: join(dir, 'hadley', 'c.pem'), key: join(dir, 'k.pem') },
        open: ['wslview'],
        forms: join(dir, 'hadley', 'bin', 'hadley-forms'),
      },
    })
  })

  it('stops at a key it does not know or a value of another kind, with the file named', async () => {
    userConfig('dev:\n  hostnme: x\n')
    await assert.rejects(readUserConfig(env()), /config\.lima: dev\.hostnme is no key hadley knows/)
    userConfig('dev:\n  open: wslview\n')
    await assert.rejects(readUserConfig(env()), /dev\.open is not a list of texts/)
    userConfig('dev:\n  https:\n    cert: c.pem\n')
    await assert.rejects(readUserConfig(env()), /dev\.https needs both cert and key/)
  })
})

describe('the certificate of hadley dev --https', () => {
  it('is the files the user configuration names', async () => {
    writeFileSync(join(dir, 'c.pem'), 'CERT')
    writeFileSync(join(dir, 'k.pem'), 'KEY')
    userConfig(`dev:\n  https:\n    cert: ${join(dir, 'c.pem')}\n    key: ${join(dir, 'k.pem')}\n`)
    const certificate = await devCertificate(await readUserConfig(env()), env())
    assert.deepEqual([String(certificate.cert), String(certificate.key)], ['CERT', 'KEY'])
  })

  it('is made once by mkcert from the PATH, and without it the build says how to get one', async () => {
    await assert.rejects(devCertificate(await readUserConfig(env()), env()), /mkcert is not on the PATH[\s\S]*certutil/)
    // a mkcert that writes the files it is asked for and logs its arguments: a shell script, which Windows runs as no
    // program (it looks for mkcert.exe)
    if (process.platform === 'win32') return
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(
      join(bin, 'mkcert'),
      `#!/bin/sh\necho "$@" >> "${join(dir, 'calls')}"\necho CERT > "$2"\necho KEY > "$4"\n`,
    )
    chmodSync(join(bin, 'mkcert'), 0o755)
    const withMkcert = env({ PATH: `${bin}:/usr/bin:/bin` })
    const certificate = await devCertificate(await readUserConfig(withMkcert), withMkcert)
    assert.equal(String(certificate.cert), 'CERT\n')
    await devCertificate(await readUserConfig(withMkcert), withMkcert)
    const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')
    assert.equal(calls.length, 1)
    assert.match(
      calls[0]!,
      /-cert-file .*hadley\/certs\/localhost\.pem -key-file .*localhost-key\.pem localhost 127\.0\.0\.1 ::1$/,
    )
    assert.ok(existsSync(join(dir, 'hadley', 'certs', 'localhost-key.pem')))
  })
})

describe('the comments of a local build', () => {
  const config = { site: { default: { language: 'de' } }, comments: { enabled: true, url: 'https://site.example' } }

  // the dev server passes them on to the comments service (lib/dev-server.ts; confirmed live 2026-10-26)
  it('go to the page own origin in a local build, and to comments.url when publishing', () => {
    assert.equal(languageRecord(config as unknown as Config, 'de', true).comments?.url, '')
    assert.equal(languageRecord(config as unknown as Config, 'de', false).comments?.url, 'https://site.example')
  })

  it('stop at a comments.devUrl, which no build reads any more', () => {
    const old = { ...config, comments: { ...config.comments, devUrl: 'https://localhost:9000' } }
    assert.throws(() => languageRecord(old as unknown as Config, 'de', true), /comments\.devUrl is gone/)
  })
})
