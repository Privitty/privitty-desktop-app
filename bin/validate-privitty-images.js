#!/usr/bin/env node
// @ts-check
/**
 * Validates that all required Privitty branding images exist.
 * Run: node bin/validate-privitty-images.js
 */
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const REQUIRED_IMAGES = [
  // App icons (root images/)
  'images/privittychat.png',
  'images/privittychat.ico',
  // Tray icons
  'images/tray/tray-icon-mac.png',
  'images/tray/privittychat.png',
  'images/tray/privittychat.ico',
  'images/tray/privittychat-unread.png',
  'images/tray/privittychat-unread.ico',
  'images/tray/unread-badge.png',
  // Optional SVGs (source for exports)
  'images/tray/privittychat.svg',
  'images/tray/privittychat-unread.svg',
]

let missing = 0
for (const relPath of REQUIRED_IMAGES) {
  const fullPath = join(root, relPath)
  if (existsSync(fullPath)) {
    console.log('✓', relPath)
  } else {
    console.log('✗ MISSING:', relPath)
    missing++
  }
}

if (missing > 0) {
  console.log('\n' + missing + ' image(s) missing.')
  process.exit(1)
} else {
  console.log('\nAll required Privitty images present.')
}
