import React from 'react'
import classNames from 'classnames'

import styles from './styles.module.scss'

export type IconName =
  | 'apps'
  | 'active'
  | 'arrow-left'
  | 'blocked'
  | 'leave'
  | 'trash'
  | 'mute'
  | 'search'
  | 'reply'
  | 'forward'
  | 'bookmark-filled'
  | 'bookmark-line'
  | 'copy'
  | 'audio-muted'
  | 'bell'
  | 'brightness-6'
  | 'chevron-left'
  | 'chevron-right'
  | 'code-tags'
  | 'cross'
  | 'devices'
  | 'download'
  | 'edit'
  | 'error'
  | 'eye-off'
  | 'eye-open'
  | 'favorite'
  | 'forum'
  | 'file'
  | 'image'
  | 'image_outline'
  | 'info'
  | 'lead-pencil'
  | 'list'
  | 'link'
  | 'lock'
  | 'loading'
  | 'map'
  | 'minus'
  | 'more'
  | 'more_vert'
  | 'open_in_new'
  | 'palette'
  | 'paperclip'
  | 'person'
  | 'person-filled'
  | 'phone'
  | 'plus'
  | 'rotate-right'
  | 'qr'
  | 'question_mark'
  | 'reaction'
  | 'sell'
  | 'settings'
  | 'swap_vert'
  | 'swap_hor'
  | 'upload-file'

type PropsBase = {
  className?: string
  onClick?: (ev: Event | React.SyntheticEvent<Element, Event>) => void
  icon: IconName
  coloring?: keyof Omit<typeof styles, 'icon'>
  size?: number
}
type JustIconProps = PropsBase & {
  /** Consider using IconButton instead */
  onClick?: undefined
}
type IconButtonProps = PropsBase & {
  'aria-label': string
}

export default function Icon({
  coloring,
  size = 20,
  icon,
  className,
}: JustIconProps) {
  return (
    <span
      className={classNames(
        styles.icon,
        coloring && styles[coloring],
        className
      )}
      style={{
        WebkitMaskImage: `url(./images/icons/${icon}.svg)`,
        height: `${size}px`,
        width: `${size}px`,
      }}
    />
  )
}

export function IconButton({ coloring, size, icon, ...rest }: IconButtonProps) {
  return (
    <button {...rest} className={classNames(styles.iconButton)}>
      <Icon coloring={coloring} size={size} icon={icon} />
    </button>
  )
}
