#!/usr/bin/env node

// Cross-platform version of create-local-help.sh

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

function createLocalHelp() {
  const scriptDir = __dirname
  const projectRoot = path.join(scriptDir, '..', '..')
  const staticHelpDir = path.join(projectRoot, 'static', 'help')
  const pagefindDir = path.join(staticHelpDir, 'pagefind')

  try {
    // Run the Python script to create local help
    console.log('Running deltachat-pages tool...')
    execSync(
      '../deltachat-pages/tools/create-local-help.py ../deltachat-pages/result static/help --add_pagefind',
      {
        cwd: projectRoot,
        stdio: 'inherit',
      }
    )

    // Remove existing pagefind directory
    if (fs.existsSync(pagefindDir)) {
      fs.rmSync(pagefindDir, { recursive: true, force: true })
    }

    // Run pagefind
    console.log('Running pagefind...')
    execSync('npx pagefind --site ./static/help/', {
      cwd: projectRoot,
      stdio: 'inherit',
    })

    // Run help translations
    console.log('Running help translations...')
    execSync('node ./bin/help/help-translations.js', {
      cwd: projectRoot,
      stdio: 'inherit',
    })

    // Output compliance warning
    const today = new Date().toISOString().split('T')[0]
    console.log()
    console.log(
      '☝️ Compliance Warning: Add the following line to CHANGELOG.md:'
    )
    console.log(`- Update local help (${today})`)
    console.log()
  } catch (error) {
    console.error('Error creating local help:', error.message)
    process.exit(1)
  }
}

createLocalHelp()
