import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import https from 'node:https'
import tls from 'node:tls'
import { promisify } from 'node:util'
import { homedir } from 'node:os'

const execFileAsync = promisify(execFile)

let authorities: Promise<string[]> | undefined

/**
 * Chromium refuses public names that resolve to 127.0.0.1, so enrollment uses
 * Node's resolver. The dev CA lives in the macOS keychain, which Node does not
 * load on its own.
 */
export function nodeWatchtowerFetch(
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  const url = new URL(input)
  return request(url, init)
}

async function request(
  url: URL,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  const hostname = url.hostname
  let address = hostname
  try {
    const found = await lookup(hostname)
    address = found.address
    /* ignore-console-log */
    console.info('[watchtower-enroll] dns', `${hostname} -> ${address}`)
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : ''
    throw new Error(
      `DNS lookup failed for ${hostname}${code ? ` (${code})` : ''}`
    )
  }

  const ca = await certificateAuthorities()
  const { status, body } = await new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      const req = https.request(
        {
          hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: init?.method ?? 'GET',
          headers: init?.headers,
          servername: hostname,
          ca,
        },
        response => {
          const chunks: Buffer[] = []
          response.on('data', chunk => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          })
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          })
        }
      )
      req.on('error', error => {
        reject(
          new Error(
            `${error.message} (${hostname} -> ${address})`
          )
        )
      })
      if (init?.body) req.write(init.body)
      req.end()
    }
  )
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }
}

function certificateAuthorities(): Promise<string[]> {
  authorities ??= loadAuthorities()
  return authorities
}

async function loadAuthorities(): Promise<string[]> {
  const pems = [...tls.rootCertificates]
  if (process.platform !== 'darwin') return pems
  const files = [
    '/Library/Keychains/System.keychain',
    `${homedir()}/Library/Keychains/login.keychain-db`,
  ]
  for (const file of files) {
    try {
      const { stdout } = await execFileAsync(
        'security',
        ['find-certificate', '-a', '-p', file],
        { maxBuffer: 16 * 1024 * 1024 }
      )
      if (stdout.includes('BEGIN CERTIFICATE')) {
        pems.push(stdout)
        /* ignore-console-log */
        console.info('[watchtower-enroll] trusted certificates from', file)
      }
    } catch (error) {
      /* ignore-console-log */
      console.info(
        '[watchtower-enroll] skipped keychain',
        file,
        error instanceof Error ? error.message : error
      )
    }
  }
  return pems
}
