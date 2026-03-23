#!/usr/bin/env node

// Cross-platform version of link_catalog.sh

import { execSync } from 'child_process'
import path from 'path'

function linkCatalog() {
  const packages = [
    'packages/target-electron',
    'packages/target-browser',
    'packages/frontend',
    'packages/runtime',
    'packages/target-tauri',
  ]

  for (const pkg of packages) {
    console.log(`Linking catalog dependencies in ${pkg}...`)

    try {
      if (pkg === 'packages/target-tauri') {
        // For tauri, we need to add the dependencies
        execSync(
          'pnpm add --save @privitty/jsonrpc-client@catalog: @privitty/deltachat-rpc-server@catalog:',
          {
            cwd: pkg,
            stdio: 'inherit',
          }
        )
      } else if (pkg === 'packages/frontend' || pkg === 'packages/runtime') {
        // For frontend and runtime, only add jsonrpc-client
        execSync('pnpm add @privitty/jsonrpc-client@catalog:', {
          cwd: pkg,
          stdio: 'inherit',
        })
      } else {
        // For target-electron and target-browser, add both dependencies
        execSync(
          'pnpm add --save @privitty/jsonrpc-client@catalog: @privitty/deltachat-rpc-server@catalog:',
          {
            cwd: pkg,
            stdio: 'inherit',
          }
        )
      }
    } catch (error) {
      console.error(
        `Error linking catalog dependencies in ${pkg}:`,
        error.message
      )
      process.exit(1)
    }
  }

  console.log('Catalog linking completed successfully!')
}

linkCatalog()
