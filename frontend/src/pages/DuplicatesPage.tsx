import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ScanLine, Eye, EyeOff, CheckCheck, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { duplicatesApi, type DuplicateGroup } from '@/api/duplicates'
import Spinner from '@/components/shared/Spinner'
import { useEditorStore } from '@/store/editorStore'
import { buildEditorNavigationUrl } from '@/store/editorNavigation'

export default function DuplicatesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [threshold, setThreshold] = useState(85)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const requestOpenInEditor = useEditorStore((s) => s.requestOpenInEditor)

  const { data: groups = [], isLoading, refetch } = useQuery({
    queryKey: ['duplicate-groups'],
    queryFn: duplicatesApi.groups,
  })

  const scanMutation = useMutation({
    mutationFn: () => duplicatesApi.scan(threshold),
    onSuccess: (d) => {
      toast.success(`${d.groups_found} groupes trouvés`)
      qc.invalidateQueries({ queryKey: ['duplicate-groups'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const ignoreMutation = useMutation({
    mutationFn: (id: number) => duplicatesApi.ignore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['duplicate-groups'] }),
  })

  const batchMutation = useMutation({
    mutationFn: (action: 'merged' | 'ignored') =>
      duplicatesApi.batch(Array.from(selected), action),
    onSuccess: () => {
      toast.success('Batch effectué')
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['duplicate-groups'] })
    },
  })

  const pending = groups.filter((g) => g.status === 'pending')
  const done = groups.filter((g) => g.status !== 'pending')

  const toggleSelect = (id: number) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const openInEditor = (filePath: string, label: string) => {
    const request = {
      file_path: filePath,
      label,
      source: 'duplicates' as const,
    }
    requestOpenInEditor(request)
    navigate(buildEditorNavigationUrl(request))
  }

  return (
    <div className="flex flex-col h-full p-5 gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Seuil de similarité :</label>
          <input
            type="range" min={60} max={99} value={threshold}
            onChange={(e) => setThreshold(+e.target.value)}
            className="w-28 accent-studio-accent"
          />
          <span className="text-xs font-mono text-white w-10">{threshold}%</span>
        </div>
        <button
          className="btn-primary"
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
        >
          {scanMutation.isPending ? <Spinner size={14} /> : <ScanLine size={14} />}
          Scanner
        </button>
        {selected.size > 0 && (
          <div className="flex gap-2 ml-auto">
            <button className="btn-ghost text-xs" onClick={() => batchMutation.mutate('ignored')}>
              <EyeOff size={12} /> Ignorer ({selected.size})
            </button>
            <button className="btn-primary text-xs" onClick={() => batchMutation.mutate('merged')}>
              <CheckCheck size={12} /> Marquer fusionnés ({selected.size})
            </button>
          </div>
        )}
        <div className="ml-auto flex gap-3 text-xs text-gray-500">
          <span className="text-studio-warn">{pending.length} en attente</span>
          <span className="text-studio-success">{done.length} traités</span>
        </div>
      </div>

      {/* Groups */}
      {isLoading ? (
        <div className="flex justify-center pt-12"><Spinner /></div>
      ) : pending.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
          <CheckCheck size={40} className="mb-3 opacity-30" />
          <p className="text-sm">Aucun doublon en attente</p>
          <p className="text-xs mt-1">Lancez un scan pour détecter les doublons</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-3">
          {pending.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              selected={selected.has(g.id)}
              onToggle={() => toggleSelect(g.id)}
              onIgnore={() => ignoreMutation.mutate(g.id)}
              onOpenInEditor={openInEditor}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function GroupCard({ group, selected, onToggle, onIgnore, onOpenInEditor }: {
  group: DuplicateGroup
  selected: boolean
  onToggle: () => void
  onIgnore: () => void
  onOpenInEditor: (filePath: string, label: string) => void
}) {
  return (
    <div className={`card p-4 space-y-3 transition-colors ${selected ? 'border-studio-accent/50' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={selected} onChange={onToggle}
            className="rounded accent-studio-accent" />
          <span className={`badge ${group.type === 'exact' ? 'bg-studio-danger/20 text-studio-danger' : 'bg-studio-warn/20 text-studio-warn'}`}>
            {group.type}
          </span>
          <span className="text-xs text-gray-500">{group.members.length} entrées</span>
        </div>
        <button className="btn-ghost text-xs" onClick={onIgnore}>
          <EyeOff size={11} /> Ignorer
        </button>
      </div>
      <div className="space-y-1.5">
        {group.members.map((m, i) => (
          <div key={m.entry_id} className="flex items-start gap-3">
            <div className="flex-1 bg-studio-elevated rounded px-3 py-2 font-mono text-xs text-gray-300">
              {m.content}
            </div>
            <div className="text-xs text-gray-600 font-mono whitespace-nowrap mt-2">
              {m.file}
              {i > 0 && <span className="ml-2 text-studio-warn">{Math.round(m.similarity * 100)}%</span>}
              <button
                className="ml-2 text-studio-accent hover:underline"
                onClick={() => onOpenInEditor(m.file, `Duplicates:${group.id}`)}
              >
                ouvrir éditeur
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
