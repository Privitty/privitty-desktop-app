/**
 * Desktop-side implementation of Watchtower app enrollment confirm.
 *
 * Used when the bundled core binary does not expose `privitty_wt_enroll_confirm`.
 * Generates a P-256 device key and enc key, builds a PKCS#10 CSR, POSTs to
 * `/enroll/app`, then writes the identity files to the DeltaChat blob directory
 * so the account can renew and check entitlement once a Watchtower-aware core
 * binary is in place.
 *
 * Key storage format intentionally matches
 * `privitty-core-rust/src/privitty/watchtower/enroll.rs` for forward
 * compatibility.  The device private key is stored as a plain PKCS#8 PEM
 * (not sealed) because the JS runtime cannot reproduce the ChaCha20-Poly1305
 * sealing that the Rust `SoftwareKeyProvider::seal` uses.
 */

import { generateKeyPairSync, sign as nodeSign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeWatchtowerFetch } from './watchtower-fetch.js'
import { getAccountsPath } from './application-constants.js'

// ── DER encoding ──────────────────────────────────────────────────────────────

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  if (n < 0x100) return Buffer.from([0x81, n])
  if (n < 0x10000) return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff])
  throw new Error(`DER length too large: ${n}`)
}

function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(value.length), value])
}

const seq = (...parts: Buffer[]) => tlv(0x30, Buffer.concat(parts))
const set_ = (...parts: Buffer[]) => tlv(0x31, Buffer.concat(parts))
const bitStr = (data: Buffer) =>
  tlv(0x03, Buffer.concat([Buffer.from([0x00]), data]))
const oid = (bytes: number[]) => tlv(0x06, Buffer.from(bytes))
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'))
const int = (n: number) => tlv(0x02, Buffer.from([n]))
const ctx0 = (content: Buffer) =>
  Buffer.concat([Buffer.from([0xa0]), derLength(content.length), content])

// OID: ecdsa-with-SHA256 (1.2.840.10045.4.3.2)
const ECDSA_SHA256 = oid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])
// OID: commonName (2.5.4.3)
const OID_CN = oid([0x55, 0x04, 0x03])

function buildCsr(spkiDer: Buffer, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): string {
  // Subject: CN=privitty-app
  const subject = seq(set_(seq(OID_CN, utf8('privitty-app'))))
  // Attributes: [0] IMPLICIT empty
  const attrs = ctx0(Buffer.alloc(0))
  // CertificationRequestInfo
  const cri = seq(int(0), subject, spkiDer, attrs)
  // Sign with ECDSA-SHA256.  Node.js returns a DER-encoded ECDSA sig.
  const sig = nodeSign('sha256', cri, privateKey)
  // CertificationRequest
  const csrDer = seq(cri, seq(ECDSA_SHA256), bitStr(sig))
  const b64 = csrDer.toString('base64')
  const wrapped = (b64.match(/.{1,64}/g) ?? []).join('\n')
  return `-----BEGIN CERTIFICATE REQUEST-----\n${wrapped}\n-----END CERTIFICATE REQUEST-----\n`
}

// ── Account directory ─────────────────────────────────────────────────────────

async function blobDir(accountId: number): Promise<string> {
  const accountsPath = getAccountsPath()
  const toml = await readFile(join(accountsPath, 'accounts.toml'), 'utf8')
  // Find the `dir` field for the given account id.
  // accounts.toml uses the format:
  //   [[accounts]]
  //   id = 1
  //   dir = "<uuid>"
  let currentId: number | null = null
  let dir: string | null = null
  for (const line of toml.split('\n')) {
    const idMatch = /^\s*id\s*=\s*(\d+)/.exec(line)
    if (idMatch) {
      currentId = parseInt(idMatch[1], 10)
      dir = null
    }
    const dirMatch = /^\s*dir\s*=\s*"([^"]+)"/.exec(line)
    if (dirMatch) {
      dir = dirMatch[1]
    }
    if (currentId === accountId && dir) {
      return join(accountsPath, dir, 'dc.db-blobs')
    }
  }
  throw new Error(`account ${accountId} not found in accounts.toml`)
}

// ── Confirm ───────────────────────────────────────────────────────────────────

export type ConfirmArgs = {
  accountId: number
  link: string
  challengeId: string
  code: string
  metadata: Record<string, unknown>
  // wrappingKeyB64 is accepted for API compatibility; the JS impl stores the
  // private key as a plain PEM because it cannot reproduce the Rust sealing.
  wrappingKeyB64: string
}

export type ConfirmResult = {
  status: 'ok' | 'blocked'
  reason?: string
  wt_url?: string
  trace: string[]
}

export async function watchtowerEnrollConfirm(args: ConfirmArgs): Promise<ConfirmResult> {
  const trace: string[] = []
  const note = (line: string) => {
    trace.push(line)
    /* ignore-console-log */
    console.info('[watchtower-enroll-confirm]', line)
  }

  const url = new URL(args.link.trim())
  if (url.protocol !== 'privitty:' || url.hostname !== 'enroll') {
    throw new Error('enrollment link')
  }
  const wt = (url.searchParams.get('wt') ?? '').replace(/\/+$/, '')
  const token = url.searchParams.get('t') ?? ''
  note(`confirm for account ${args.accountId} on ${wt}`)

  // Generate P-256 device key
  note('generating device key')
  const { publicKey: devPub, privateKey: devPriv } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const spkiDer = devPub.export({ type: 'spki', format: 'der' }) as Buffer
  const devPrivPem = devPriv.export({ type: 'pkcs8', format: 'pem' }) as string

  // Generate P-256 enc key
  note('generating enc key')
  const { publicKey: encPub } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const encPubPem = encPub.export({ type: 'spki', format: 'pem' }) as string

  // Build the CSR
  note('building CSR')
  const csrPem = buildCsr(spkiDer, devPriv)

  // POST /enroll/app
  const enrollUrl = `${wt}/enroll/app`
  note(`POST ${enrollUrl}`)
  const body = JSON.stringify({
    token,
    challenge_id: args.challengeId,
    code: args.code,
    csr_pem: csrPem,
    enc_public_key_pem: encPubPem,
    metadata: args.metadata,
  })
  const resp = await nodeWatchtowerFetch(enrollUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
  const respText = await resp.text()
  note(`enroll/app HTTP ${resp.status}`)
  if (!resp.ok) {
    throw new Error(`enrollment confirm returned ${resp.status}: ${respText.slice(0, 300)}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enrolled: Record<string, any> = JSON.parse(respText)
  note(`device_id ${enrolled.device_id ?? '?'}`)

  if (enrolled.reason) {
    note(`blocked: ${enrolled.reason}`)
    return { status: 'blocked', reason: String(enrolled.reason), trace }
  }

  // Find the DeltaChat blob directory for this account
  const blobs = await blobDir(args.accountId)
  const wtDir = join(blobs, 'watchtower')
  note(`storing identity in ${wtDir}`)
  await mkdir(wtDir, { recursive: true })

  const writes: Array<[string, string]> = [
    ['cert.pem', String(enrolled.cert_chain_pem ?? '')],
    ['chain.pem', String(enrolled.cert_chain_pem ?? '')],
    ['ca.pem', String(enrolled.ca_bundle_pem ?? '')],
    ['entitlement.jws', String(enrolled.entitlement_token ?? '')],
    ['signing.pub.pem', String(enrolled.signing_public_key_pem ?? '')],
    // Plain PKCS#8 PEM — not sealed.  A Watchtower-aware core will re-seal on
    // first use if it finds key_mode=software-plain.
    ['device.key.pem', devPrivPem],
    ['enc.pub.pem', encPubPem],
    ['key_mode', 'software-plain'],
    [
      'endpoints.json',
      JSON.stringify({
        broker_url: enrolled.broker_url ?? '',
        broker_ws_url: enrolled.broker_ws_url ?? '',
        device_api_url: enrolled.device_api_url ?? '',
      }),
    ],
  ]

  await Promise.all(
    writes.map(([name, content]) =>
      writeFile(join(wtDir, name), content, 'utf8')
    )
  )

  note('enrollment complete — identity stored')
  return { status: 'ok', wt_url: wt, trace }
}
