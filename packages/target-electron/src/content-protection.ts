import { BrowserWindow } from 'electron'
import { DesktopSettings } from './desktop_settings'
import { platform } from 'os'
import { getLogger } from '@deltachat-desktop/shared/logger'

const log = getLogger('contentProtection')

function updateContentProtection(window: BrowserWindow, enabled: boolean) {
  window.setContentProtection(enabled)
  if (enabled && platform() !== 'darwin' && platform() !== 'win32') {
    log.warn('setContentProtection not available on your platform', platform())
  }
}

export function setContentProtection(window: BrowserWindow) {
  // Always enable content protection to prevent screenshots/screen recording
  // and persist the setting for future runs.
  DesktopSettings.update({ contentProtectionEnabled: true })
  updateContentProtection(window, true)
}

export function updateContentProtectionOnAllActiveWindows(enabled: boolean) {
  for (const win of BrowserWindow.getAllWindows()) {
    updateContentProtection(win, enabled)
  }
}
