'use strict'
/**
 * create-universal-bins.cjs
 *
 * Uses `lipo` to combine arch-specific macOS binaries (arm64 + x64) into a
 * single universal (fat) Mach-O binary, placed in a new "-darwin-universal"
 * package alongside the arch-specific packages.
 *
 * This is a required pre-build step before running:
 *   electron-builder --mac dmg --universal
 *
 * Why: @electron/universal (used internally by electron-builder) requires that
 * every Mach-O binary exists at the exact same path in both the x64 and arm64
 * build slices. Arch-specific packages (e.g. -darwin-arm64 vs -darwin-x64)
 * live at different paths, so the merger rejects them. By producing a single
 * -darwin-universal package with a fat binary, both slices see the same path.
 */

const { execSync } = require('child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..')
const NM = join(ROOT, 'node_modules', '@privitty')

const PACKAGES = [
  {
    name: 'deltachat-rpc-server',
    binaryName: 'deltachat-rpc-server',
  },
  {
    name: 'privitty-core',
    binaryName: 'privitty-server',
  },
]

function run(cmd) {
  console.log(`  $ ${cmd}`)
  execSync(cmd, { stdio: 'inherit' })
}

console.log('Creating universal (fat) binaries for macOS...\n')

for (const pkg of PACKAGES) {
  const arm64Dir = join(NM, `${pkg.name}-darwin-arm64`)
  const x64Dir = join(NM, `${pkg.name}-darwin-x64`)
  const universalDir = join(NM, `${pkg.name}-darwin-universal`)

  if (!existsSync(arm64Dir)) {
    console.error(`ERROR: arm64 package not found: ${arm64Dir}`)
    process.exit(1)
  }
  if (!existsSync(x64Dir)) {
    console.error(`ERROR: x64 package not found: ${x64Dir}`)
    process.exit(1)
  }

  const arm64Bin = join(arm64Dir, pkg.binaryName)
  const x64Bin = join(x64Dir, pkg.binaryName)
  const universalBin = join(universalDir, pkg.binaryName)

  if (!existsSync(arm64Bin)) {
    console.error(`ERROR: arm64 binary not found: ${arm64Bin}`)
    process.exit(1)
  }
  if (!existsSync(x64Bin)) {
    console.error(`ERROR: x64 binary not found: ${x64Bin}`)
    process.exit(1)
  }

  console.log(`\nCreating @privitty/${pkg.name}-darwin-universal`)
  mkdirSync(universalDir, { recursive: true })

  console.log(`  lipo: ${arm64Bin} + ${x64Bin} → ${universalBin}`)
  run(`lipo -create -output "${universalBin}" "${arm64Bin}" "${x64Bin}"`)

  // Copy and patch package.json / README / index.js from arm64 package,
  // replacing the arch suffix so the package name is consistent.
  for (const file of ['package.json', 'README.md', 'index.js']) {
    const src = join(arm64Dir, file)
    if (existsSync(src)) {
      const content = readFileSync(src, 'utf-8')
      const updated = content.replace(
        new RegExp(`${pkg.name}-darwin-arm64`, 'g'),
        `${pkg.name}-darwin-universal`
      )
      writeFileSync(join(universalDir, file), updated)
    }
  }

  console.log(`  ✓ ${universalDir}`)
}

console.log(
  '\n✓ Universal binaries created. You can now run the universal DMG build.\n'
)
