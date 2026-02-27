// @ts-ignore
import applicationConfig from 'application-config'
if (process.env.NODE_ENV !== 'production') {
  try {
    const { config } = await import('dotenv')
    config()
  } catch (e) {
    /* ignore-console-log */
    console.error('Failed to load .env file', e)
  }
}

// Use separate data dir for dev builds so production and development can coexist
const appName = process.argv.includes('--devmode') ? 'Privitty-test' : 'Privitty'
const appConfig = applicationConfig(appName)

import { join } from 'path'

if (process.env.DC_TEST_DIR) {
  appConfig.filePath = join(process.env.DC_TEST_DIR, 'config.json')
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  /* ignore-console-log */
  console.log('Running in Portable Mode', process.env.PORTABLE_EXECUTABLE_DIR)
  appConfig.filePath = join(
    process.env.PORTABLE_EXECUTABLE_DIR,
    'PrivittyData',
    'config.json'
  )
}

export default Object.freeze(appConfig)
