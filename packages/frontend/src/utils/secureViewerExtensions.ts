import { extname } from 'path'

export type SecureViewerType =
  'pdf' | 'image' | 'video' | 'docx' | 'xlsx' | 'xls' | 'pptx' | 'unsupported'

export type OfficeViewerType = 'docx' | 'xlsx' | 'xls' | 'pptx'

export type RoutableSecureViewerType = Exclude<SecureViewerType, 'unsupported'>

const OFFICE_VIEWER_TYPES = new Set<OfficeViewerType>([
  'docx',
  'xlsx',
  'xls',
  'pptx',
])

export function isOfficeViewerType(
  viewerType: SecureViewerType
): viewerType is OfficeViewerType {
  return OFFICE_VIEWER_TYPES.has(viewerType as OfficeViewerType)
}

export function isRoutableSecureViewerType(
  viewerType: SecureViewerType
): viewerType is RoutableSecureViewerType {
  return viewerType !== 'unsupported'
}

export const SUPPORTED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
] as const

export const SUPPORTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.mkv',
  '.m4v',
] as const

export const SUPPORTED_OFFICE_EXTENSIONS = [
  '.docx',
  '.xlsx',
  '.xls',
  '.pptx',
] as const

export const SUPPORTED_SECURE_VIEWER_EXTENSIONS = [
  '.pdf',
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS,
  ...SUPPORTED_OFFICE_EXTENSIONS,
] as const

const IMAGE_EXTENSION_SET = new Set<string>(SUPPORTED_IMAGE_EXTENSIONS)
const VIDEO_EXTENSION_SET = new Set<string>(SUPPORTED_VIDEO_EXTENSIONS)

export function stripPrvExtension(fileName: string): string {
  return fileName.toLowerCase().endsWith('.prv')
    ? fileName.slice(0, -4)
    : fileName
}

export function getExtensionFromFileName(fileName: string): string {
  const cleaned = stripPrvExtension(fileName)
  const parts = cleaned.split('.').filter(Boolean)
  if (parts.length < 2) {
    return ''
  }
  return `.${parts[parts.length - 1].toLowerCase()}`
}

export function isSupportedSecureViewerFileName(fileName: string): boolean {
  if (fileName.toLowerCase().endsWith('.prv')) {
    return true
  }
  const extension = getExtensionFromFileName(fileName)
  return SUPPORTED_SECURE_VIEWER_EXTENSIONS.includes(
    extension as (typeof SUPPORTED_SECURE_VIEWER_EXTENSIONS)[number]
  )
}

export function getSecureViewerTypeFromPath(
  filePath: string
): SecureViewerType {
  const extension = extname(filePath).toLowerCase()

  if (extension === '.pdf') {
    return 'pdf'
  }
  if (IMAGE_EXTENSION_SET.has(extension)) {
    return 'image'
  }
  if (VIDEO_EXTENSION_SET.has(extension)) {
    return 'video'
  }
  if (extension === '.docx') {
    return 'docx'
  }
  if (extension === '.xlsx') {
    return 'xlsx'
  }
  if (extension === '.xls') {
    return 'xls'
  }
  if (extension === '.pptx') {
    return 'pptx'
  }

  return 'unsupported'
}

export function getSecureViewerTypeFromFileName(
  fileName: string
): SecureViewerType {
  const extension = getExtensionFromFileName(fileName)
  return getSecureViewerTypeFromPath(`file${extension}`)
}
