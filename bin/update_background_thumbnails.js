#!/usr/bin/env node

// Cross-platform version of update_background_thumbnails.sh

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

function updateBackgroundThumbnails() {
  const scriptDir = __dirname
  const backgroundsDir = path.join(scriptDir, '..', 'images', 'backgrounds')
  const thumbDir = path.join(backgroundsDir, 'thumb')

  // Remove existing thumb directory
  if (fs.existsSync(thumbDir)) {
    fs.rmSync(thumbDir, { recursive: true, force: true })
  }

  // Create thumb directory
  fs.mkdirSync(thumbDir, { recursive: true })

  // Get all image files
  const files = fs
    .readdirSync(backgroundsDir)
    .filter(file => /\.(jpg|jpeg|png|webp|gif)$/i.test(file))

  // Process each file with ImageMagick
  for (const filename of files) {
    const inputPath = path.join(backgroundsDir, filename)
    const outputPath = path.join(thumbDir, filename)

    try {
      execSync(`magick "${inputPath}" -resize 128x128 "${outputPath}"`, {
        stdio: 'inherit',
      })
      console.log(`Processed: ${filename}`)
    } catch (error) {
      console.error(`Error processing ${filename}:`, error.message)
    }
  }

  console.log('Background thumbnails updated successfully!')
}

updateBackgroundThumbnails()
