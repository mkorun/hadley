import { generateKeyPairSync, sign } from 'node:crypto'

/** Minimal self-signed X.509 v1 test certificate: no saved private key, OpenSSL program or CA installation. */
export function testCertificate(): { cert: Buffer; key: string | Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const der = (tag: number, ...values: Buffer[]): Buffer => {
    const value = Buffer.concat(values)
    const size = value.length
    const length = size < 128 ? [size] : size < 256 ? [0x81, size] : [0x82, size >> 8, size & 255]
    return Buffer.concat([Buffer.from([tag, ...length]), value])
  }
  const sequence = (...values: Buffer[]) => der(0x30, ...values)
  // ecdsa-with-SHA256, and a distinguished name holding commonName = localhost.
  const algorithm = sequence(der(0x06, Buffer.from('2a8648ce3d040302', 'hex')))
  const name = sequence(
    der(0x31, sequence(der(0x06, Buffer.from('550403', 'hex')), der(0x0c, Buffer.from('localhost')))),
  )
  const validity = sequence(der(0x17, Buffer.from('200101000000Z')), der(0x17, Buffer.from('491231235959Z')))
  const certificate = sequence(
    der(0x02, Buffer.from([1])),
    algorithm,
    name,
    validity,
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
  )
  return {
    cert: Buffer.from(
      '-----BEGIN CERTIFICATE-----\n' +
        sequence(certificate, algorithm, der(0x03, Buffer.from([0]), sign('sha256', certificate, privateKey)))
          .toString('base64')
          .match(/.{1,64}/g)!
          .join('\n') +
        '\n-----END CERTIFICATE-----\n',
    ),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }
}
