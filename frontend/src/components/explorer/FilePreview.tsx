import { useQuery } from '@tanstack/react-query'
import { Shuffle, FileText } from 'lucide-react'
import { explorerApi } from '@/api/explorer'
import { StyleBadge, FormatBadge } from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'

interface Props { path: string }

export default function FilePreview({ path }: Props) {
  const { data: preview, refetch, isFetching } = useQuery({
    queryKey: ['preview', path],
    queryFn: () => explorerApi.preview(path, 8),
    enabled: !!path,
  })

  const { data: meta } = useQuery({
    queryKey: ['file-meta', path],
    queryFn: () => explorerApi.getFile(path),
    enabled: !!path,
  })

  return (
    <div className="space-y-3">
      {meta && (
        <div className="flex items-center gap-2 flex-wrap">
          <StyleBadge style={meta.prompt_style} />
          <FormatBadge format={meta.format} />
          <span className="text-xs text-gray-500">{meta.entry_count} entrées</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 font-mono">Aperçu aléatoire</span>
        <button
          className="btn-ghost text-xs py-1"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? <Spinner size={12} /> : <Shuffle size={12} />}
          Mélanger
        </button>
      </div>

      <div className="space-y-1.5">
        {(preview?.samples ?? []).map((s, i) => (
          <div key={i} className="bg-studio-elevated rounded px-3 py-2 text-sm font-mono text-gray-300 leading-relaxed">
            {s}
          </div>
        ))}
        {!preview?.samples?.length && (
          <div className="text-sm text-gray-600 flex items-center gap-2">
            <FileText size={14} />
            Fichier vide ou aucune entrée
          </div>
        )}
      </div>
    </div>
  )
}
