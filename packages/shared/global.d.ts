import { getMessageFunction, LocaleData } from './localize.js'
import type { T as _T } from '@privitty/jsonrpc-client'

declare global {
  interface Window {
    localeData: LocaleData
    /** not auto updated translate, for a translate function that responds to language updates use i18nContext */
    static_translate: getMessageFunction
  }
}

// Extend the Message type to include Privitty-specific properties
declare module '@privitty/jsonrpc-client' {
  interface Message {
    isPrivittyMessage?: boolean
  }
}

// Extend the RawClient type to include Privitty-specific methods
declare module '@privitty/jsonrpc-client' {
  interface RawClient {
    sendMsgWithSubject?: (
      chatId: number,
      text: string,
      subject: string
    ) => Promise<number>
  }
}
