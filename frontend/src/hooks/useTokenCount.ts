import { useState, useEffect, useRef } from 'react'
import { editorApi } from '@/api/editor'

interface TokenInfo {
  clip_tokens: number
  t5_tokens: number
  clip_limit: number
  over_limit: boolean
  text_length: number
}

/**
 * Debounced token counter hook.
 * Returns live token info as the user types, with a configurable debounce delay.
 */
export function useTokenCount(text: string, debounceMs = 400) {
  const [info, setInfo] = useState<TokenInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!text.trim()) {
      setInfo(null)
      return
    }

    setIsLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const data = await editorApi.tokenCount(text)
        setInfo(data)
      } catch {
        // silently ignore network errors during typing
      } finally {
        setIsLoading(false)
      }
    }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [text, debounceMs])

  const percentage = info ? Math.min(100, (info.clip_tokens / info.clip_limit) * 100) : 0

  const severity: 'ok' | 'warn' | 'over' =
    !info           ? 'ok'
    : info.over_limit ? 'over'
    : percentage > 80 ? 'warn'
    : 'ok'

  return { info, isLoading, percentage, severity }
}
