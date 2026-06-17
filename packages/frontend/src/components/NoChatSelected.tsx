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
          <p>
            Welcome to Privitty, A secure, decentralized messaging app with
            advanced privacy features like message revocation and time-limited
            access.
          </p>
        </div>

        {/* Feature Cards */}
        <div className={styles.welcomeGrid}>
          <div className={styles.welcomeCard}>
            <div className={styles.cardIcon}>
              <Icon icon='file' size={40} />
            </div>
            <h3>Revoke File Anytime Anywhere</h3>
            <p>
              Shared the wrong document? Instantly wipe access to any file sent
              across any device.
            </p>
          </div>

          <div className={styles.welcomeCard}>
            <div className={styles.cardIcon}>
              <Icon icon='link' size={40} />
            </div>
            <h3>Trace Your Message</h3>
            <p>Monitor the lifecycle of your communication.</p>

            <div className={styles.status}>
              <span className={styles.statusItem}>
                <Icon icon='active' size={20} /> Sent & Encrypted
              </span>
              <span className={styles.statusItem}>
                <Icon icon='eye-open' size={20} /> Forwarded to which recipients
              </span>
            </div>
          </div>

          <div className={`${styles.welcomeCard} ${styles.small}`}>
            <div className={styles.cardIcon}>
              <Icon icon='blocked' size={40} />
            </div>
            <h3>Forward Control</h3>
            <p>Total containment of your communication.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
