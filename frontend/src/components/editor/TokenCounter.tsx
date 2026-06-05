import { useEffect, useState } from 'react'
import { editorApi } from '@/api/editor'

interface Props { text: string }

export default function TokenCounter({ text }: Props) {
  const [data, setData] = useState<{ clip_tokens: number; t5_tokens: number; over_limit: boolean } | null>(null)

  useEffect(() => {
    if (!text.trim()) { setData(null); return }
    const t = setTimeout(() => {
      editorApi.tokenCount(text).then(setData).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [text])

  if (!data) return null

  const pct = Math.min(100, (data.clip_tokens / 77) * 100)
  const color = data.over_limit ? '#f87171' : pct > 80 ? '#fbbf24' : '#34d399'

  return (
    <div className="flex items-center gap-3 text-xs font-mono">
      <div className="flex items-center gap-1.5">
        <div className="w-24 h-1.5 rounded-full bg-studio-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <span style={{ color }}>{data.clip_tokens}/77 CLIP</span>
      </div>
      <span className="text-gray-600">·</span>
      <span className="text-gray-500">~{data.t5_tokens} T5</span>
    </div>
  )
}
