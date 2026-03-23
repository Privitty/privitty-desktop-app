#!/usr/bin/env node

// Cross-platform utilities to replace common Unix commands
// Usage: node bin/cross-platform-utils.js <command> [args...]

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const command = process.argv[2]
const args = process.argv.slice(3)

function rmrf(target) {
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isDirectory()) {
      fs.readdirSync(target).forEach(file => {
        const curPath = path.join(target, file)
        if (fs.lstatSync(curPath).isDirectory()) {
          rmrf(curPath)
        } else {
          fs.unlinkSync(curPath)
        }
      })
      fs.rmdirSync(target)
    } else {
      fs.unlinkSync(target)
    }
  }
}

function mkdirp(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function cp(src, dest) {
  if (fs.lstatSync(src).isDirectory()) {
    mkdirp(dest)
    fs.readdirSync(src).forEach(file => {
      const srcPath = path.join(src, file)
      const destPath = path.join(dest, file)
      cp(srcPath, destPath)
    })
  } else {
    const destDir = path.dirname(dest)
    mkdirp(destDir)
    fs.copyFileSync(src, dest)
  }
}

function mv(src, dest) {
  const destDir = path.dirname(dest)
  mkdirp(destDir)
  fs.renameSync(src, dest)
}

function find(dir, pattern) {
  const results = []

  function search(currentDir) {
    if (!fs.existsSync(currentDir)) return

    const items = fs.readdirSync(currentDir)
    for (const item of items) {
      const fullPath = path.join(currentDir, item)
      const stat = fs.lstatSync(fullPath)

      if (stat.isDirectory()) {
        search(fullPath)
      } else if (pattern.test(item)) {
        results.push(fullPath)
      }
    }
  }

  search(dir)
  return results
}

// Command routing
switch (command) {
  case 'rm':
  case 'rmrf':
    if (args.includes('-rf') || args.includes('-r')) {
      const targets = args.filter(arg => !arg.startsWith('-'))
      targets.forEach(target => rmrf(target))
    } else {
      args.forEach(target => {
        if (fs.existsSync(target)) {
          fs.unlinkSync(target)
        }
      })
    }
    break

  case 'mkdir':
    if (args.includes('-p')) {
      const dirs = args.filter(arg => !arg.startsWith('-'))
      dirs.forEach(dir => mkdirp(dir))
    } else {
      args.forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir)
        }
      })
    }
    break

  case 'cp':
    if (args.includes('-r') || args.includes('-R')) {
      const src = args[args.length - 2]
      const dest = args[args.length - 1]
      cp(src, dest)
    } else {
      const src = args[0]
      const dest = args[1]
      fs.copyFileSync(src, dest)
    }
    break

  case 'mv':
    const src = args[0]
    const dest = args[1]
    mv(src, dest)
    break

  case 'find':
    const searchDir = args[0]
    const findPattern = args[2]
    const pattern = new RegExp(findPattern.replace('*', '.*'))
    const found = find(searchDir, pattern)
    found.forEach(file => console.log(file))
    break

  default:
    console.error(`Unknown command: ${command}`)
    console.error('Available commands: rm, mkdir, cp, mv, find')
    process.exit(1)
}
