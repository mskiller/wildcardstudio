import { useEffect, useRef, useState, useCallback } from 'react'

type WsStatus = 'connecting' | 'open' | 'closed' | 'error'

interface UseWebSocketOptions {
  onMessage?: (data: unknown) => void
  reconnectDelay?: number
  maxReconnects?: number
}

/**
 * Reconnecting WebSocket hook.
 * Connects to the given URL and calls onMessage for every JSON message received.
 * Automatically reconnects on close/error up to maxReconnects times.
 */
export function useWebSocket(url: string, options: UseWebSocketOptions = {}) {
  const { onMessage, reconnectDelay = 3000, maxReconnects = 10 } = options
  const [status, setStatus] = useState<WsStatus>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCount = useRef(0)
  const unmounted = useRef(false)

  const connect = useCallback(() => {
    if (unmounted.current) return

    try {
      const ws = new WebSocket(url)
      wsRef.current = ws
      setStatus('connecting')

      ws.onopen = () => {
        reconnectCount.current = 0
        setStatus('open')
      }

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data)
          onMessage?.(data)
        } catch {
          onMessage?.(evt.data)
        }
      }

      ws.onerror = () => {
        setStatus('error')
      }

      ws.onclose = () => {
        if (unmounted.current) return
        setStatus('closed')
        if (reconnectCount.current < maxReconnects) {
          reconnectCount.current += 1
          setTimeout(connect, reconnectDelay)
        }
      }
    } catch {
      setStatus('error')
    }
  }, [url, onMessage, reconnectDelay, maxReconnects])

  useEffect(() => {
    unmounted.current = false
    connect()
    return () => {
      unmounted.current = true
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }, [])

  return { status, send }
}
