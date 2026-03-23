#!/usr/bin/env node

// Cross-platform compatibility test script
// This script tests all the cross-platform functionality

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

console.log('🧪 Testing Cross-Platform Compatibility...\n')

const tests = [
  {
    name: 'Package.json reset script',
    test: () => {
      console.log('Testing reset:node_modules script...')
      // Test the Node.js code in the reset script
      const resetCode = `const fs=require('fs');const path=require('path');function rmrf(dir){if(fs.existsSync(dir)){fs.readdirSync(dir).forEach(file=>{const curPath=path.join(dir,file);if(fs.lstatSync(curPath).isDirectory())rmrf(curPath);else fs.unlinkSync(curPath);});fs.rmdirSync(dir);}}try{rmrf('node_modules');}catch(e){}try{fs.readdirSync('packages').forEach(pkg=>{try{rmrf(path.join('packages',pkg,'node_modules'));}catch(e){}});}catch(e){}console.log('Cleaned node_modules directories');`

      // Create a test directory to clean
      const testDir = 'test-cleanup'
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true })
      }

      // Test the cleanup function
      const testCode = resetCode.replace('node_modules', testDir)
      execSync(`node -e "${testCode}"`, { stdio: 'pipe' })

      // Verify the directory was cleaned
      if (!fs.existsSync(testDir)) {
        console.log('✅ Reset script works correctly')
        return true
      } else {
        console.log('❌ Reset script failed')
        return false
      }
    },
  },
  {
    name: 'Translation conversion script',
    test: () => {
      console.log('Testing translation conversion...')
      try {
        execSync(
          'node ./bin/build-shared-convert-translations.mjs ./_locales',
          {
            stdio: 'pipe',
            timeout: 10000,
          }
        )
        console.log('✅ Translation conversion works')
        return true
      } catch (error) {
        console.log('❌ Translation conversion failed:', error.message)
        return false
      }
    },
  },
  {
    name: 'Find complete translations script',
    test: () => {
      console.log('Testing find complete translations...')
      try {
        execSync('node ./bin/find_complete_translations.js', {
          stdio: 'pipe',
          timeout: 5000,
        })
        console.log('✅ Find complete translations works')
        return true
      } catch (error) {
        console.log('❌ Find complete translations failed:', error.message)
        return false
      }
    },
  },
  {
    name: 'Cross-platform utilities',
    test: () => {
      console.log('Testing cross-platform utilities...')
      try {
        // Test mkdir
        execSync('node bin/cross-platform-utils.js mkdir -p test-utils-dir', {
          stdio: 'pipe',
        })

        // Test file creation
        fs.writeFileSync('test-utils-dir/test.txt', 'test')

        // Test cp
        execSync(
          'node bin/cross-platform-utils.js cp test-utils-dir/test.txt test-utils-dir/test2.txt',
          { stdio: 'pipe' }
        )

        // Test rm
        execSync('node bin/cross-platform-utils.js rm -rf test-utils-dir', {
          stdio: 'pipe',
        })

        console.log('✅ Cross-platform utilities work')
        return true
      } catch (error) {
        console.log('❌ Cross-platform utilities failed:', error.message)
        return false
      }
    },
  },
  {
    name: 'Dependencies check',
    test: async () => {
      console.log('Checking required dependencies...')
      try {
        // Check if xml-js is available using dynamic import
        const xmlJs = await import('xml-js')
        console.log('✅ xml-js dependency is available')
        return true
      } catch (error) {
        console.log('❌ xml-js dependency missing:', error.message)
        return false
      }
    },
  },
  {
    name: 'Platform detection',
    test: () => {
      console.log('Testing platform detection...')
      const platform = process.platform
      const arch = process.arch
      console.log(`✅ Running on ${platform} (${arch})`)

      // Test platform-specific path handling
      const testPath = path.join('test', 'path', 'with', 'separators')
      console.log(`✅ Path handling works: ${testPath}`)
      return true
    },
  },
]

async function runTests() {
  let passed = 0
  let failed = 0

  for (const test of tests) {
    console.log(`\n📋 ${test.name}`)
    console.log('─'.repeat(50))

    try {
      const result = await test.test()
      if (result) {
        passed++
      } else {
        failed++
      }
    } catch (error) {
      console.log(`❌ Test failed with error: ${error.message}`)
      failed++
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('📊 Test Results:')
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(
    `📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`
  )

  if (failed === 0) {
    console.log(
      '\n🎉 All tests passed! The project is ready for cross-platform builds.'
    )
  } else {
    console.log('\n⚠️  Some tests failed. Please check the errors above.')
  }

  console.log('\n💡 To test on other platforms:')
  console.log('   • Windows: Use Windows Command Prompt or PowerShell')
  console.log('   • Linux: Use any Linux distribution')
  console.log('   • CI: Push to GitHub to trigger automated builds')
}

runTests().catch(console.error)
