import { C, T } from '@privitty/jsonrpc-client'
import { BackendRemote } from '../backend-com'

export interface FileAccessRequestee {
  contactId: string
  name: string
  isOwner: boolean
  isForwarded: boolean
  status: string | null
  expiryTime: number | null
  allowDownload: boolean | null
  allowForward: boolean | null
}

export type FileAccessSections = {
  ownerList: FileAccessRequestee[]
  sharedList: FileAccessRequestee[]
  forwardedList: FileAccessRequestee[]
  selfAccountAddr: string | null
  isPeer2Mode: boolean
  displayFileName: string
}

function normalizeAddr(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

function emailsEqual(a?: string | null, b?: string | null): boolean {
  const left = normalizeAddr(a)
  const right = normalizeAddr(b)
  return left.length > 0 && left === right
}

function isBlank(value?: string | null): boolean {
  return !value || value.trim().length === 0
}

function forwardedStatusPriority(status: string | null | undefined): number {
  const normalized = (status ?? '').trim().toLowerCase()
  switch (normalized) {
    case 'denied':
    case 'revoked':
      return 200
    case 'deleted':
      return 190
    case 'active':
      return 100
    case 'requested':
    case 'waiting_owner_action':
    case 'waiting_for_owner_action':
    case 'pending_owner_relay':
    case 'pending_peer_relay':
      return 60
    case 'none':
      return 20
    case 'expired':
      return 10
    default:
      return 0
  }
}

function preferForwardedInfo(
  current: T.PrivittyForwardedInfo,
  candidate: T.PrivittyForwardedInfo
): T.PrivittyForwardedInfo {
  const currentPriority = forwardedStatusPriority(current.status)
  const candidatePriority = forwardedStatusPriority(candidate.status)
  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority ? candidate : current
  }
  const currentExpiry = current.expiryTime ?? 0
  const candidateExpiry = candidate.expiryTime ?? 0
  return candidateExpiry >= currentExpiry ? candidate : current
}

function dedupeForwarded(
  forwarded: T.PrivittyForwardedInfo[],
  excludeContactAddr?: string | null
): T.PrivittyForwardedInfo[] {
  const excludeKey = normalizeAddr(excludeContactAddr)
  const byContact = new Map<string, T.PrivittyForwardedInfo>()

  for (const entry of forwarded) {
    let contactKey = normalizeAddr(entry.contactAddr)
    if (!contactKey) {
      contactKey = normalizeAddr(entry.contactName)
    }
    if (!contactKey || (excludeKey && contactKey === excludeKey)) {
      continue
    }
    const existing = byContact.get(contactKey)
    byContact.set(
      contactKey,
      existing ? preferForwardedInfo(existing, entry) : entry
    )
  }

  return Array.from(byContact.values())
}

function isForwardeeForwardedRelayView(
  message: T.Message,
  forwarded: T.PrivittyForwardedInfo[]
): boolean {
  if (message.fromId === C.DC_CONTACT_ID_SELF || forwarded.length === 0) {
    return false
  }
  const sender = message.sender
  const senderAddr = sender?.address
  if (!senderAddr) return false
  const normalizedSender = normalizeAddr(senderAddr)
  return forwarded.some(f => normalizeAddr(f.contactAddr) === normalizedSender)
}

function ownerRequestee(name: string, contactId: string): FileAccessRequestee {
  return {
    contactId,
    name,
    isOwner: true,
    isForwarded: false,
    status: null,
    expiryTime: null,
    allowDownload: null,
    allowForward: null,
  }
}

function sharedRequestee(info: T.PrivittySharedInfo): FileAccessRequestee {
  return {
    contactId: info.contactAddr,
    name: info.contactName,
    isOwner: false,
    isForwarded: false,
    status: info.status || 'active',
    expiryTime: info.expiryTime > 0 ? info.expiryTime : null,
    allowDownload: info.downloadAllowed,
    allowForward: info.forwardAllowed,
  }
}

function forwardedRequestee(info: T.PrivittyForwardedInfo): FileAccessRequestee {
  return {
    contactId: info.contactAddr,
    name: info.contactName,
    isOwner: false,
    isForwarded: true,
    status: info.status || 'active',
    expiryTime: info.expiryTime > 0 ? info.expiryTime : null,
    allowDownload: info.downloadAllowed,
    allowForward: false,
  }
}

export function getFileAccessStatusDisplayText(
  status: string | null | undefined,
  expiryTime: number | null | undefined
): string {
  const normalized = (status ?? '').trim().toLowerCase()
  const formattedTime = formatExpiryTimestamp(expiryTime)

  switch (normalized) {
    case 'requested':
    case 'waiting_owner_action':
    case 'waiting_for_owner_action':
      return 'Access Requested'
    case 'denied':
      return 'Access Denied'
    case 'revoked':
      return 'Access Revoked'
    case 'active':
      return formattedTime ?? 'Access Requested'
    case 'expired':
      return formattedTime
        ? `Access Expired On ${formattedTime}`
        : 'Access Expired'
    default:
      return formattedTime ?? 'Access Requested'
  }
}

export function formatExpiryTimestamp(
  expiryTime: number | null | undefined
): string | null {
  if (expiryTime == null || expiryTime === 0) return null
  const ms = expiryTime > 1e12 ? expiryTime : expiryTime * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  const day = date.getDate()
  const year = date.getFullYear()
  const hours = date.getHours()
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${month} ${day}, ${year} ${hours}:${minutes}`
}

export function isAccessRequestedStatus(status?: string | null): boolean {
  const normalized = (status ?? '').trim().toLowerCase()
  return [
    'requested',
    'relay_to_owner',
    'waiting_owner_action',
    'waiting_for_owner_action',
  ].includes(normalized)
}

export function isAccessPermanentlyBlocked(status?: string | null): boolean {
  const normalized = (status ?? '').trim().toLowerCase()
  return normalized === 'denied' || normalized === 'revoked'
}

export function canRevokeAccess(status?: string | null): boolean {
  return (status ?? '').trim().toLowerCase() === 'active'
}

export function isAccessBlockedForPermissions(status?: string | null): boolean {
  const normalized = (status ?? '').trim().toLowerCase()
  return normalized === 'denied' || normalized === 'revoked' || normalized === 'expired'
}

export function shouldShowYouBadge(
  requestee: FileAccessRequestee,
  isPeer2Mode: boolean,
  selfAccountAddr: string | null
): boolean {
  if (requestee.isForwarded) {
    return (
      isPeer2Mode && emailsEqual(selfAccountAddr, requestee.contactId)
    )
  }
  if (requestee.isOwner) {
    return !isPeer2Mode
  }
  return isPeer2Mode
}

export async function buildFileAccessSections(
  accountId: number,
  chatId: number,
  msgId: number,
  fallbackFileName?: string
): Promise<FileAccessSections> {
  const message = await BackendRemote.rpc.getMessage(accountId, msgId)
  const isSender = message.fromId === C.DC_CONTACT_ID_SELF
  const isPeer2Mode = !isSender

  const selfContact = await BackendRemote.rpc.getContact(
    accountId,
    C.DC_CONTACT_ID_SELF
  )
  const selfName = selfContact.displayName
  const selfAddr = selfContact.address

  const info: T.PrivittyFileInfo | null =
    message.privittyFileInfo ??
    (await (BackendRemote.rpc as any).privittyGetFileAccessInfo(
      accountId,
      msgId
    ))

  const displayFileName =
    fallbackFileName ||
    message.fileName ||
    message.file?.split(/[/\\]/).pop() ||
    'File'

  const ownerList: FileAccessRequestee[] = []
  const sharedList: FileAccessRequestee[] = []
  const forwardedList: FileAccessRequestee[] = []

  if (!info) {
    return {
      ownerList,
      sharedList,
      forwardedList,
      selfAccountAddr: selfAddr,
      isPeer2Mode,
      displayFileName,
    }
  }

  const ownerName = isSender ? selfName : info.ownerName
  const ownerAddr = isSender ? selfAddr : info.ownerAddr
  if (!isBlank(ownerName)) {
    ownerList.push(ownerRequestee(ownerName, ownerAddr))
  }

  let sharedInfo = info.shared
  if (sharedInfo && !isSender) {
    sharedInfo = {
      ...sharedInfo,
      contactName: selfName,
      contactAddr: selfAddr,
    }
  }
  if (sharedInfo && !isBlank(sharedInfo.contactName)) {
    sharedList.push(sharedRequestee(sharedInfo))
  }

  let forwardedEntries = dedupeForwarded(
    info.forwarded,
    isSender ? sharedInfo?.contactAddr : null
  )

  if (
    !isSender &&
    isForwardeeForwardedRelayView(message, forwardedEntries)
  ) {
    forwardedEntries = forwardedEntries.map(entry => ({
      ...entry,
      contactName: selfName,
      contactAddr: selfAddr,
    }))
  }

  for (const entry of forwardedEntries) {
    if (!isBlank(entry.contactName) || !isBlank(entry.contactAddr)) {
      forwardedList.push(forwardedRequestee(entry))
    }
  }

  sharedList.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  forwardedList.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )

  return {
    ownerList,
    sharedList,
    forwardedList,
    selfAccountAddr: selfAddr,
    isPeer2Mode,
    displayFileName,
  }
}
