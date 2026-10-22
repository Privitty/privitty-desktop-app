/** Watchtower app enrollment over HTTPS. The token is not written to the trace. */

export type WatchtowerEnrollStart = {
  challengeId: string
  emailHint: string
  trace: string[]
}

type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

export async function watchtowerEnrollStart(
  link: string,
  fetchImpl: FetchLike
): Promise<WatchtowerEnrollStart> {
  const trace: string[] = []
  const note = (line: string) => {
    trace.push(line)
    /* ignore-console-log */
    console.info('[watchtower-enroll]', line)
  }

  const parsed = parseEnrollLink(link)
  note(`host ${parsed.wt}`)
  note(`token ${parsed.token.slice(0, 6)}… (${parsed.token.length} chars)`)
  note(`ca pin ${parsed.caSha256}`)

  const bootstrapUrl = `${parsed.wt}/enroll/bootstrap`
  note(`GET ${bootstrapUrl}`)
  const bootstrapResponse = await fetchImpl(bootstrapUrl)
  const bootstrapText = await bootstrapResponse.text()
  note(`bootstrap HTTP ${bootstrapResponse.status}`)
  if (!bootstrapResponse.ok) {
    throw new Error(
      `bootstrap returned ${bootstrapResponse.status}: ${bootstrapText.slice(0, 300)}`
    )
  }
  const bootstrap = JSON.parse(bootstrapText) as { ca_bundle_pem?: string }
  const bundle = bootstrap.ca_bundle_pem
  if (!bundle) {
    throw new Error('bootstrap response has no ca bundle')
  }
  const pin = await pinOfFirstCertificate(bundle)
  note(`bootstrap ca pin ${pin}`)
  if (pin !== parsed.caSha256) {
    throw new Error('ca pin mismatch')
  }

  const startUrl = `${parsed.wt}/enroll/app/start`
  note(`POST ${startUrl}`)
  const startResponse = await fetchImpl(startUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: parsed.token }),
  })
  const startText = await startResponse.text()
  note(`start HTTP ${startResponse.status} ${startText.slice(0, 300)}`)
  if (!startResponse.ok) {
    throw new Error(
      `enrollment start returned ${startResponse.status}: ${startText.slice(0, 300)}`
    )
  }
  const started = JSON.parse(startText) as {
    challenge_id?: string
    challengeId?: string
    email_hint?: string
    emailHint?: string
  }
  return {
    challengeId: String(started.challenge_id ?? started.challengeId ?? ''),
    emailHint: String(started.email_hint ?? started.emailHint ?? ''),
    trace,
  }
}

function parseEnrollLink(link: string): {
  wt: string
  token: string
  caSha256: string
} {
  const url = new URL(link.trim())
  if (url.protocol !== 'privitty:' || url.hostname !== 'enroll') {
    throw new Error('enrollment link')
  }
  const wt = url.searchParams.get('wt') ?? ''
  const token = url.searchParams.get('t') ?? ''
  const ca = normalizePin(url.searchParams.get('ca') ?? '')
  if (!wt.startsWith('https://') || wt.includes(' ') || !token || !ca) {
    throw new Error('enrollment link')
  }
  return { wt: wt.replace(/\/+$/, ''), token, caSha256: ca }
}

function normalizePin(value: string): string | null {
  const trimmed = value.trim()
  const hex = trimmed.replace(/^sha256:/i, '').trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null
}

async function pinOfFirstCertificate(bundle: string): Promise<string> {
  const begin = '-----BEGIN CERTIFICATE-----'
  const end = '-----END CERTIFICATE-----'
  const start = bundle.indexOf(begin)
  const stop = bundle.indexOf(end)
  if (start < 0 || stop < 0) {
    throw new Error('bootstrap response has no ca bundle')
  }
  const b64 = bundle.slice(start + begin.length, stop).replace(/\s/g, '')
  const der = Uint8Array.from(atob(b64), char => char.charCodeAt(0))
  const digest = await crypto.subtle.digest('SHA-256', der)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}
