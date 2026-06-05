interface BadgeProps {
  style?: string | null
  format?: string | null
  className?: string
}

const STYLE_MAP: Record<string, string> = {
  tag:     'badge-tag',
  nl:      'badge-nl',
  mixed:   'badge-mixed',
  unknown: 'badge-unknown',
}

const FORMAT_MAP: Record<string, string> = {
  impact:          'badge-impact',
  dynamic_prompts: 'badge-dynamic',
}

export function StyleBadge({ style, className = '' }: BadgeProps) {
  if (!style) return null
  return (
    <span className={`${STYLE_MAP[style] ?? 'badge-unknown'} ${className}`}>
      {style}
    </span>
  )
}

export function FormatBadge({ format, className = '' }: BadgeProps) {
  if (!format) return null
  const label = format === 'dynamic_prompts' ? 'dynamic' : format
  return (
    <span className={`${FORMAT_MAP[format] ?? 'badge-unknown'} ${className}`}>
      {label}
    </span>
  )
}
