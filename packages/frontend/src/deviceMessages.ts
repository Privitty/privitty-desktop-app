import { BackendRemote } from './backend-com'
import { getDeviceChatId, markChatAsSeen } from './backend/chat'

export async function updateDeviceChat(
  accountId: number,
  skipCurrentChangelog: boolean = false
) {
  const tx = window.static_translate
  const addDeviceMessage = async (
    label: string,
    msg: Partial<Parameters<typeof BackendRemote.rpc.addDeviceMessage>[2]>
  ) => {
    if (skipCurrentChangelog) {
      await BackendRemote.rpc.addDeviceMessage(accountId, label, null)
    } else {
      await BackendRemote.rpc.addDeviceMessage(accountId, label, {
        text: null,
        html: null,
        viewtype: null,
        file: null,
        filename: null,
        location: null,
        overrideSenderName: null,
        quotedMessageId: null,
        quotedText: null,
        ...msg,
      })
    }
  }
  // Label must be unique per "announcement" — once consumed it never fires again.
  // Using a Privitty-specific prefix + upstream version avoids conflicts with
  // past labels (changelog-version-1.58.0, changelog-version-2.3.0) that were
  // already consumed during development.
  await addDeviceMessage(`privitty-2.3.0-update`, {
    text: tx('update_2_0', 'Privitty 2.0 is here!'),
  })
}

export async function updateDeviceChats() {
  const selectedAccount = await BackendRemote.rpc.getSelectedAccountId()
  for (const accountId of await BackendRemote.rpc.getAllAccountIds()) {
    await updateDeviceChat(accountId, false)
    if (accountId !== selectedAccount) {
      const devChatId = await getDeviceChatId(accountId)
      if (devChatId) markChatAsSeen(accountId, devChatId)
    }
  }
}
