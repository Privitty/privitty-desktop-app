import React from 'react'
import { getBackgroundImageStyle } from './message/MessageListAndComposer'
import { useSettingsStore } from '../stores/settings'
import styles from './NoChatSelected.module.scss'
import Icon from './Icon'

export default function NoChatSelected() {
  const settingsStore = useSettingsStore()[0]

  const style: React.CSSProperties = settingsStore
    ? getBackgroundImageStyle(settingsStore.desktopSettings)
    : {}

  return (
    <div
      className={`message-list-and-composer ${styles.privittyWelcome}`}
      style={style}
    >
      <div className={styles.welcomeContainer}>
        {/* Header */}
        <div className={styles.welcomeHeader}>
          <h1>
            Your Data
            <br />
            In Your Control
          </h1>
          <p>Cryptographic identity. Verified access. No VPN or firewall.</p>
        </div>

        {/* Feature Cards */}
        <div className={styles.welcomeGrid}>
          <div className={styles.welcomeCard}>
            <div className={styles.cardIcon}>
              <Icon icon='key' size={40} />
            </div>
            <h3>Machine Identity</h3>
            <p>
              OpenPGP-verified identity for every Privitty Edge. No IPs or
              shared credentials.
            </p>
          </div>

          <div className={styles.welcomeCard}>
            <div className={styles.cardIcon}>
              <Icon icon='file' size={40} />
            </div>
            <h3>Controlled File Transfer</h3>
            <p>
              Secure file sharing with view, download, forward, expiry, and
              revoke controls.
            </p>
          </div>

          <div className={styles.welcomeCard}>
            <div className={styles.cardIcon}>
              <Icon icon='devices' size={40} />
            </div>
            <h3>E2EE Remote Sessions</h3>
            <p>
              Secure SSH, RDP, and VNC sessions without inbound firewall ports.
            </p>
          </div>

          <div className={styles.welcomeCard}>
            <div className={styles.cardIcon}>
              <Icon icon='blocked' size={40} />
            </div>
            <h3>True Revoke & Panic</h3>
            <p>
              Revoke file access, terminate sessions, and log events instantly.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
