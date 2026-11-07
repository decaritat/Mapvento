import type { ReactNode } from 'react'

export function ExternalLink({
  url,
  children,
  className,
  title,
  tabIndex,
}: {
  url: string
  children: ReactNode
  className?: string
  title?: string
  tabIndex?: number
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title}
      tabIndex={tabIndex}
    >
      {children}
    </a>
  )
}
