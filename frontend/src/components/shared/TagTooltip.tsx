import React, { useState, useRef, useEffect } from 'react'
import { Tag, TagCategory } from '@/api/tags'

interface TagTooltipProps {
  tag: Tag
  category?: TagCategory
  children: React.ReactNode
}

export default function TagTooltip({ tag, category, children }: TagTooltipProps) {
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setVisible(true), 350)
  }

  const hideTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  let parsedAliases: string[] = []
  if (tag.aliases) {
    try {
      const parsed = JSON.parse(tag.aliases)
      if (Array.isArray(parsed)) {
        parsedAliases = parsed
      } else {
        console.warn('Parsed aliases for tag is not an array:', tag.name)
      }
    } catch (e) {
      console.error('Failed to parse aliases for tag:', tag.name, e)
    }
  }

  return (
    <div
      className="relative inline-block"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {visible && (
        <div
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-studio-surface border border-studio-border rounded-lg shadow-xl p-3 z-50 pointer-events-none text-left animate-tooltip-in"
        >
          <div className="flex items-center gap-2 border-b border-studio-border pb-1.5 mb-1.5">
            {category?.icon && <span className="text-sm">{category.icon}</span>}
            <span className="font-mono text-sm font-semibold truncate" style={{ color: category?.color || '#abb2bf' }}>
              {tag.name}
            </span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Catégorie :</span>
              <span className="text-gray-300 font-medium capitalize">{category?.name || 'Général'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Source :</span>
              <span className="text-gray-300 font-medium">
                {tag.source === 'wildcard_index' ? 'Index (Wildcards)' : 'Base de données'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Utilisation :</span>
              <span className="text-gray-300 font-medium">{tag.usage_count || 0} fois</span>
            </div>
            {parsedAliases.length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-studio-border/50">
                <span className="text-gray-500 block mb-0.5">Alias :</span>
                <span className="text-gray-400 font-mono text-[10px] block leading-normal break-all">
                  {parsedAliases.join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

