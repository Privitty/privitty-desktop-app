/**
 * PrivittyStore — module-level singleton that tracks Privitty-protected chats.
 *
 * Why not React context?
 * The chatlist uses react-window with React.memo(..., areEqual). Even though
 * React is supposed to propagate context through memo boundaries, the strict
 * areEqual comparator from react-window can prevent child re-renders in
 * practice. By owning state inside each Message component (via useState +
 * store subscription), we guarantee re-renders regardless of any memoization
 * in ancestor components.
 *
 * Design:
 *  • Per-account Set<chatId> backed by localStorage — instant on startup.
 *  • Module-level listener set notified on every new detection.
 *  • Components call subscribe() in useEffect and store.isPrivitty() in useState.
 */

type Listener = (chatId: number) => void
type ReadyListener = () => void
export type FileAccessChangePayload = {
  chatId: number
  msgId?: number
  filePath?: string
}
type FileAccessListener = (payload: FileAccessChangePayload) => void

class PrivittyStore {
  private chats = new Map<number, Set<number>>() // accountId → Set<chatId>
  private listeners = new Set<Listener>()
  private fileAccessListeners = new Set<FileAccessListener>()
  private activeAccountId: number | null = null

  // Server readiness tracking — ensures file-status fetches wait until
  // switchProfile has completed and the privitty-server is fully initialized.
  private serverReady = false
  private readyListeners = new Set<ReadyListener>()

  private storageKey(accountId: number) {
    return `privitty_chats_v1_${accountId}`
  }

  /**
   * Load (or initialise) the per-account cache from localStorage.
   * Call this once when the account becomes known.
   */
  loadAccount(accountId: number) {
    if (this.chats.has(accountId)) return // already loaded
    try {
      const raw = localStorage.getItem(this.storageKey(accountId))
      if (raw) {
        const ids: unknown = JSON.parse(raw)
        if (Array.isArray(ids)) {
          this.chats.set(accountId, new Set(ids as number[]))
          return
        }
      }
    } catch {
      // corrupted — start fresh
    }
    this.chats.set(accountId, new Set())
  }

  setActiveAccount(accountId: number) {
    this.activeAccountId = accountId
    this.loadAccount(accountId)
  }

  isPrivitty(accountId: number, chatId: number): boolean {
    this.loadAccount(accountId)
    return this.chats.get(accountId)?.has(chatId) ?? false
  }

  markPrivitty(accountId: number, chatId: number) {
    this.loadAccount(accountId)
    const set = this.chats.get(accountId)!
    if (!set.has(chatId)) {
      set.add(chatId)
      this.persist(accountId, set)
      // Notify every subscribed Message component.
      this.listeners.forEach(l => l(chatId))
    }
  }

  /** Subscribe to new Privitty detections. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Notify message bubbles to refresh Privitty file access status immediately. */
  notifyFileAccessChanged(payload: FileAccessChangePayload) {
    this.fileAccessListeners.forEach(l => l(payload))
  }

  subscribeFileAccessChanged(listener: FileAccessListener): () => void {
    this.fileAccessListeners.add(listener)
    return () => this.fileAccessListeners.delete(listener)
  }

  /**
   * Signal that the privitty-server has finished switchProfile and is ready
   * to handle requests. Must be called exactly once per session by
   * PrivittyChatContext when it receives the `privittyServerReady` IPC event.
   */
  setServerReady() {
    if (this.serverReady) return
    this.serverReady = true
    this.readyListeners.forEach(l => l())
    this.readyListeners.clear()
  }

  /**
   * Invoke `callback` as soon as the server is ready.
   * If the server is already ready, `callback` is called synchronously.
   * Returns an unsubscribe function (no-op if already fired).
   */
  onServerReady(callback: ReadyListener): () => void {
    if (this.serverReady) {
      callback()
      return () => {}
    }
    this.readyListeners.add(callback)
    return () => this.readyListeners.delete(callback)
  }

  getActiveAccountId(): number | null {
    return this.activeAccountId
  }

  private persist(accountId: number, set: Set<number>) {
    try {
      localStorage.setItem(this.storageKey(accountId), JSON.stringify([...set]))
    } catch {
      // storage full — non-fatal
    }
  }
}

export const privittyStore = new PrivittyStore()
