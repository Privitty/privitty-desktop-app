//@ts-check
import { writeFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { isAppxSupportedLanguage } from './appx_languages.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// this can be changed by ../../../bin/github-actions/devbuild.js
const previewBuild = false

const exclude_list = readFileSync(
  join(__dirname, 'packageignore_list'),
  'utf-8'
)
  .split('\n')
  .map(line => line.trim())
  .filter(line => line != '' && !line.startsWith('#'))
  .map(line => '!' + line)
const files = [
  // start with including all files
  '**/*',
  ...exclude_list,
  { from: '../../_locales', to: '_locales', filter: '*.json' },
]
const env = process.env

// Check if we should sign (production mode)
const shouldSign = env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false'

/** @type {import('./types').DeepWriteable<import('electron-builder').Configuration>} */
const build = {}
build['appId'] = 'chat.privitty.desktop.electron'
// Controls installed app name, exe basename and default install folder
build['productName'] = 'PrivittyChat'
build['extraMetadata'] = {
  //@ts-ignore
  // Packaged package name (root package.json name is not what electron-builder ships).
  name: 'privittychat-desktop',
}

if (previewBuild) {
  build.appId = 'chat.privitty.desktop.electron.dev'
  //@ts-ignore
  build.extraMetadata.name = 'privittychat-desktop-dev'
  //@ts-ignore
  build.extraMetadata.productName = 'PrivittyChat-DevBuild'
  const p = JSON.parse(
    readFileSync(join(__dirname, '../package.json'), { encoding: 'utf-8' })
  )
  //@ts-ignore
  build.extraMetadata.version = p.version + '-DevBuild'
}

build['protocols'] = [
  {
    name: 'QR code data',
    role: 'Viewer',
    schemes: ['openpgp4fpr', 'dcaccount', 'dclogin'],
  },
  {
    name: 'Send Mails via MailTo Scheme',
    // https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html#//apple_ref/doc/uid/TP40009249-102207-TPXREF115
    role: 'Viewer',
    schemes: ['mailto'],
  },
]

build['fileAssociations'] = [
  {
    ext: 'xdc',
    name: 'Webxdc app',
    // icon - default, which means build/ext\.(ico|icns)
    mimeType: 'application/x-webxdc',
  },
]

build['files'] = files
// When building a universal DMG (UNIVERSAL_BUILD=true), the lipo step has
// already merged arm64+x64 into "-darwin-universal" packages. We include only
// those so @electron/universal sees the same Mach-O path in both arch slices.
// For single-arch builds we include both arch packages and let afterPackHook
// prune the one that does not match the current build architecture.
const isUniversalBuild = env.UNIVERSAL_BUILD === 'true'

const macExtraResources = isUniversalBuild
  ? [
      {
        from: 'node_modules/@privitty/stdio-rpc-server-darwin-universal',
        to: 'app.asar.unpacked/node_modules/@privitty/stdio-rpc-server-darwin-universal',
      },
      {
        from: 'node_modules/@privitty/privitty-core-darwin-universal',
        to: 'app.asar.unpacked/node_modules/@privitty/privitty-core-darwin-universal',
      },
    ]
  : [
      {
        from: 'node_modules/@privitty/stdio-rpc-server-darwin-arm64',
        to: 'app.asar.unpacked/node_modules/@privitty/stdio-rpc-server-darwin-arm64',
      },
      {
        from: 'node_modules/@privitty/stdio-rpc-server-darwin-x64',
        to: 'app.asar.unpacked/node_modules/@privitty/stdio-rpc-server-darwin-x64',
      },
      {
        from: 'node_modules/@privitty/privitty-core-darwin-arm64',
        to: 'app.asar.unpacked/node_modules/@privitty/privitty-core-darwin-arm64',
      },
      {
        from: 'node_modules/@privitty/privitty-core-darwin-x64',
        to: 'app.asar.unpacked/node_modules/@privitty/privitty-core-darwin-x64',
      },
    ]

build['extraResources'] = [
  {
    from: 'node_modules/@privitty/stdio-rpc-server',
    to: 'app.asar.unpacked/node_modules/@privitty/stdio-rpc-server',
  },
  {
    from: 'node_modules/@privitty/privitty-core',
    to: 'app.asar.unpacked/node_modules/@privitty/privitty-core',
  },
  ...macExtraResources,
]
build['asarUnpack'] = [
  // Privitty packages
  './node_modules/@privitty/privitty-core/**',
  './node_modules/@privitty/privitty-core-*/**',
  // stdio-rpc-server packages (meta-package AND platform-specific)
  './node_modules/@privitty/stdio-rpc-server/**',
  './node_modules/@privitty/stdio-rpc-server-*/**',
]
// 'html-dist/xdcs/' should be in 'asarUnpack', but that had "file already exists" errors in the ci
// see https://github.com/deltachat/deltachat-desktop/pull/3876, so we now do it "manually" in the afterPackHook

build['afterPack'] = './build/afterPackHook.mjs'

// Only enable afterSign (notarization) if signing is enabled
if (shouldSign) {
  build['afterSign'] = './build/afterSignHook.cjs'
}

// With pnpm, let electron-builder skip native module rebuild to avoid invoking a global pnpm
// which can fail on Windows ("%1 is not a valid Win32 application").
build['npmRebuild'] = false

if (typeof env.NO_ASAR !== 'undefined' && env.NO_ASAR != 'false') {
  build['asar'] = false
}

// platform specific

const PREBUILD_FILTERS = {
  NOT_LINUX: '!node_modules/@privitty/stdio-rpc-server-linux-*${/*}',
  NOT_MAC: '!node_modules/@privitty/stdio-rpc-server-darwin-*${/*}',
  NOT_WINDOWS: '!node_modules/@privitty/stdio-rpc-server-win32-*${/*}',
}

// For universal DMG builds, electron-builder traverses up to the pnpm workspace
// root and picks up arch-specific darwin packages from the virtual store even
// after the pre-cleanup CI step removes them from packages/target-electron/node_modules.
// They end up in app.asar.unpacked; the afterPackHook then deletes them; but the ASAR
// header still references them, so @electron/universal's mergeASARs fails with ENOENT.
// Explicit exclusions here are the only reliable guard against workspace-root leakage.
// @parcel/watcher-darwin-* binaries also land in app.asar.unpacked automatically (electron
// builder unpacks .node files) and cause the "same in both builds" merge rejection.
const UNIVERSAL_STRIP_FILTERS = isUniversalBuild
  ? [
      // single-arch @privitty prebuilds (replaced by the -darwin-universal fat binary)
      '!node_modules/@privitty/stdio-rpc-server-darwin-arm64${/*}',
      '!node_modules/@privitty/stdio-rpc-server-darwin-x64${/*}',
      '!node_modules/@privitty/privitty-core-darwin-arm64${/*}',
      '!node_modules/@privitty/privitty-core-darwin-x64${/*}',
      // @parcel/watcher native addons are ARM64-only or x64-only and must not
      // appear in app.asar.unpacked of a universal build
      '!node_modules/@parcel/watcher-darwin-arm64${/*}',
      '!node_modules/@parcel/watcher-darwin-x64${/*}',
    ]
  : []

build['mac'] = {
  appId: previewBuild
    ? 'chat.privitty.desktop.electron.devbuild'
    : 'chat.privitty.desktop.electron',
  category: 'public.app-category.social-networking',
  entitlements: 'build/entitlements.mac.plist',
  entitlementsInherit: 'build/entitlements.mac.plist',
  extendInfo: {
    NSCameraUsageDescription: 'For scanning qr codes.',
    NSMicrophoneUsageDescription: 'For recording voice messages',
    ITSAppUsesNonExemptEncryption: false,
  },
  gatekeeperAssess: shouldSign,
  hardenedRuntime: shouldSign,
  icon: 'build/icon-mac.icns',
  artifactName: 'privittychat-desktop-${version}-${arch}.${ext}',
  identity: shouldSign ? undefined : null, // null = skip signing, undefined = auto-detect
  files: [
    ...files,
    PREBUILD_FILTERS.NOT_LINUX,
    PREBUILD_FILTERS.NOT_WINDOWS,
    ...UNIVERSAL_STRIP_FILTERS,
  ],
  darkModeSupport: true,
  // electron-builder 26.x defaults mergeASARs=true for universal builds.
  // With mergeASARs=true, @electron/universal tries to read every file that the
  // ASAR header lists as "unpacked" from app.asar.unpacked. The afterPackHook
  // deletes arch-specific prebuilds from that dir, causing ENOENT.
  // UNIVERSAL_STRIP_FILTERS above prevent those packages from entering the ASAR
  // at all; with them gone, both architecture slices produce identical ASARs so
  // mergeASARs=false (ASAR deduplication path) is safe and much simpler.
  // x64ArchFiles is kept as a safety net for any Mach-O that still appears
  // identically in both slices (would otherwise cause a merge rejection).
  ...(isUniversalBuild
    ? {
        mergeASARs: false,
        x64ArchFiles:
          'Contents/Resources/app.asar.unpacked/node_modules/**/*-darwin-*/**',
      }
    : {
        x64ArchFiles:
          'Contents/Resources/app.asar.unpacked/node_modules/**/*-darwin-x64/**',
        mergeASARs: true,
      }),
}

build['mas'] = {
  hardenedRuntime: false,
  entitlements: 'build/entitlements.mas.plist',
  entitlementsInherit: 'build/entitlements.mas.inherit.plist',
  // binaries // Paths of any extra binaries that need to be signed.
}

build['dmg'] = {
  sign: false,
  contents: [
    {
      x: 220,
      y: 200,
    },
    {
      x: 448,
      y: 200,
      type: 'link',
      path: '/Applications',
    },
  ],
}
build['linux'] = {
  target: ['AppImage', 'deb'],
  category: 'Network;Chat;InstantMessaging;',
  desktop: {
    entry: {
      Comment: 'privitty Chat email-based messenger',
      Keywords: 'privitty;chat;privitty;messaging;messenger;email',
    },
  },
  files: [...files, PREBUILD_FILTERS.NOT_MAC, PREBUILD_FILTERS.NOT_WINDOWS],
  icon: 'build/icon.icns', // electron builder gets the icon out of the mac icon archive
  description: 'The Email messenger (https://privitty.com)',
}

build['appImage'] = {
  artifactName: 'privittychat-desktop-${version}-${arch}.${ext}',
}

build['deb'] = {
  packageName: previewBuild
    ? 'privittychat-desktop-preview'
    : 'privittychat-desktop',
  depends: [
    'libasound2',
    'libgtk-3-0',
    'libnotify4',
    'libnss3',
    'libxss1',
    'libxtst6',
    'xdg-utils',
    'libatspi2.0-0',
    'libuuid1',
    'libsecret-1-0',
  ],
}

build['win'] = {
  // Use a pre-built multi-resolution ICO (16–256 px, 9 sizes).
  // Supplying an ICO file directly avoids the PNG→ICO conversion that
  // electron-builder performs via rcedit/wine on non-Windows builders,
  // which can silently fail and leave the default Electron atom icon in
  // the exe (visible in Start-menu search and the installer title bar).
  icon: 'build/icon.ico',
  // Use a fixed prefix for Windows installer filenames
  artifactName: 'privittychat-desktop-${version}-Setup.${arch}.${ext}', // specifying it inside of build['nsis'] does not work for unknown reasons.
  files: [...files, PREBUILD_FILTERS.NOT_MAC, PREBUILD_FILTERS.NOT_LINUX],
  // Keep executable resource editing (icon + metadata) enabled even for unsigned
  // builds. Setting signAndEditExecutable to false skips rcedit entirely, which
  // leaves the default Electron icon on the .exe (Start menu search uses that).
  // Signing is controlled separately via CSC_* env vars / certificates.
}

build['portable'] = {
  artifactName: 'privittychat-desktop-${version}-Portable.${arch}.${ext}',
}

// supported languages are on https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/supported-languages?pivots=store-installer-msix
const languages = [
  'ar',
  'bg',
  'ca',
  'cs',
  // 'ckb', not supported by ms-store
  'da',
  'de',
  'en',
  'el',
  // 'eo',  not supported by ms-store
  'es',
  'et',
  'eu',
  'fa',
  'fi',
  'fr',
  'gl',
  'hr',
  'hu',
  'id',
  'it',
  'ja-jp',
  'ko',
  'lt',
  'nb',
  'nl-nl',
  'pl',
  'pt',
  'pt-BR',
  'ro',
  'ru',
  // 'sc', not supported by ms-store
  'sk',
  'sq',
  // sr', not supported by ms-store - although ms page mentions it as supported
  'sv',
  'ta',
  'te',
  'tr',
  'uk',
  'vi',
  'zh-cn',
  'zh-tw',
].map(code => code.toLowerCase())

const unsupported_languages = languages.filter(
  code => !isAppxSupportedLanguage(code)
)
if (unsupported_languages.length > 0) {
  throw new Error(
    'Unsupported appx languages:' + JSON.stringify(unsupported_languages)
  )
}

build['appx'] = {
  applicationId: build['appId'],
  publisher: 'CN=C13753E5-D590-467C-9FCA-6799E1A5EC1E',
  publisherDisplayName: 'merlinux',
  identityName: 'merlinux.privittyChat',
  languages,
  artifactName: 'privittychat-desktop-${version}-Package.${arch}.${ext}',
  // Dark tile background so the white Privitty logo is always clearly visible
  // regardless of whether the user has Windows light or dark mode enabled.
  backgroundColor: '#1a1a2e',
}

// see https://www.electron.build/configuration/nsis
build['nsis'] = {
  oneClick: false,
  allowToChangeInstallationDirectory: false,
}

// module.exports = build
// using this as a js module doesn#t work on windows
// because electron builder asks windows to open it as file instead of reading it.

writeFileSync(
  join(__dirname, '../electron-builder.json5'),
  '// GENERATED, this file is generated by gen-electron-builder-config.js \n// run "pack:generate_config" to re-generate it\n' +
    JSON.stringify(build)
)
