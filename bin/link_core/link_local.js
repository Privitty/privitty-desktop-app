#!/usr/bin/env node

// Cross-platform version of link_local.sh

import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

function linkLocal() {
  let coreRepoCheckout = process.env.CORE_REPO_CHECKOUT

  if (!coreRepoCheckout) {
    // Check for common core repository locations
    const possiblePaths = ['../core', '../deltachat-core-rust']

    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        coreRepoCheckout = possiblePath
        break
      }
    }

    if (!coreRepoCheckout) {
      console.error('No valid directory found for CORE_REPO_CHECKOUT')
      console.error(
        'Please set CORE_REPO_CHECKOUT environment variable or ensure ../core or ../deltachat-core-rust exists'
      )
      process.exit(1)
    }
  }

  console.log(`Using core repository at: ${coreRepoCheckout}`)

  const packages = [
    'packages/target-electron',
    'packages/target-browser',
    'packages/frontend',
    'packages/runtime',
    'packages/target-tauri',
  ]

  for (const pkg of packages) {
    console.log(`Linking local dependencies in ${pkg}...`)

    try {
      if (pkg === 'packages/target-tauri') {
        // For tauri, we need to add the dependencies
        execSync(
          `pnpm add @privitty/jsonrpc-client@link:../../${coreRepoCheckout}/deltachat-jsonrpc/typescript @privitty/deltachat-rpc-server@link:../../${coreRepoCheckout}/deltachat-rpc-server/npm-package`,
          {
            cwd: pkg,
            stdio: 'inherit',
          }
        )

        // Also update Cargo.toml for Rust dependencies
        try {
          execSync(
            `cargo add deltachat --path ../../../${coreRepoCheckout} && cargo add deltachat-jsonrpc --path ../../../${coreRepoCheckout}/deltachat-jsonrpc`,
            {
              cwd: path.join(pkg, 'src-tauri'),
              stdio: 'inherit',
            }
          )
        } catch (cargoError) {
          console.warn(
            '\n\nFailed to link local core to tauri: please update Cargo.toml in packages/target-tauri/src-tauri manually'
          )
        }
      } else if (pkg === 'packages/frontend' || pkg === 'packages/runtime') {
        // For frontend and runtime, only add jsonrpc-client
        execSync(
          `pnpm add @privitty/jsonrpc-client@link:../../${coreRepoCheckout}/deltachat-jsonrpc/typescript`,
          {
            cwd: pkg,
            stdio: 'inherit',
          }
        )
      } else {
        // For target-electron and target-browser, add both dependencies
        execSync(
          `pnpm add @privitty/jsonrpc-client@link:../../${coreRepoCheckout}/deltachat-jsonrpc/typescript @privitty/deltachat-rpc-server@link:../../${coreRepoCheckout}/deltachat-rpc-server/npm-package`,
          {
            cwd: pkg,
            stdio: 'inherit',
          }
        )
      }
    } catch (error) {
      console.error(
        `Error linking local dependencies in ${pkg}:`,
        error.message
      )
      process.exit(1)
    }
  }

  console.log('Local linking completed successfully!')
}

linkLocal()
