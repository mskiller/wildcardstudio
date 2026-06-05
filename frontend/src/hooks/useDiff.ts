import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { comparatorApi, type DiffResult } from '@/api/comparator'

type DiffMode = 'auto' | 'tag' | 'nl'

/** Hook for prompt diff / comparison state */
export function useDiff(initialMode: DiffMode = 'auto') {
  const [left, setLeft]   = useState('')
  const [right, setRight] = useState('')
  const [mode, setMode]   = useState<DiffMode>(initialMode)
  const [result, setResult] = useState<DiffResult | null>(null)

  const mutation = useMutation({
    mutationFn: () => comparatorApi.diff(left, right, mode),
    onSuccess: setResult,
  })

  const compare = useCallback(() => {
    if (left.trim() && right.trim()) mutation.mutate()
  }, [left, right, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const swap = useCallback(() => {
    setLeft(right)
    setRight(left)
    setResult(null)
  }, [left, right])

  const clear = useCallback(() => {
    setLeft('')
    setRight('')
    setResult(null)
  }, [])

  return {
    left, setLeft,
    right, setRight,
    mode, setMode,
    result,
    isPending: mutation.isPending,
    error: mutation.error as Error | null,
    compare,
    swap,
    clear,
  }
}
