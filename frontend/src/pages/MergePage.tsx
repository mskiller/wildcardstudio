import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Merge, RotateCcw, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { mergeApi } from '@/api/merge'
import Spinner from '@/components/shared/Spinner'
import ConfirmDialog from '@/components/shared/ConfirmDialog'

export default function MergePage() {
  const qc = useQueryClient()
  const [sources, setSources] = useState<string[]>(['', ''])
  const [target, setTarget] = useState('')
  const [deleteAfter, setDeleteAfter] = useState(false)
  const [prepareData, setPrepareData] = useState<any>(null)
  const [confirmRollback, setConfirmRollback] = useState<number | null>(null)

  const { data: history = [] } = useQuery({
    queryKey: ['merge-history'],
    queryFn: mergeApi.history,
  })

  const prepareMutation = useMutation({
    mutationFn: () => mergeApi.prepare(sources.filter(Boolean), target),
    onSuccess: (d) => setPrepareData(d),
    onError: (e: Error) => toast.error(e.message),
  })

  const executeMutation = useMutation({
    mutationFn: () => mergeApi.execute(prepareData.prepare_token, deleteAfter),
    onSuccess: () => {
      toast.success('Fusion effectuée !')
      setPrepareData(null)
      setSources(['', ''])
      setTarget('')
      qc.invalidateQueries({ queryKey: ['merge-history'] })
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rollbackMutation = useMutation({
    mutationFn: (id: number) => mergeApi.rollback(id),
    onSuccess: () => {
      toast.success('Rollback effectué')
      qc.invalidateQueries({ queryKey: ['merge-history'] })
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addSource = () => setSources((s) => [...s, ''])

  return (
    <div className="flex h-full gap-5 p-5">
      {/* Left: form */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-500">Fichiers sources</label>
            <button className="btn-ghost text-xs" onClick={addSource}><Plus size={12} /> Ajouter source</button>
          </div>
          {sources.map((s, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                className="input flex-1 font-mono text-xs"
                placeholder="comfyui/styles.yaml"
                value={s}
                onChange={(e) => setSources((arr) => arr.map((x, j) => j === i ? e.target.value : x))}
              />
              {sources.length > 2 && (
                <button className="text-gray-600 hover:text-studio-danger" onClick={() => setSources((arr) => arr.filter((_, j) => j !== i))}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Fichier résultat *</label>
          <input
            className="input font-mono text-xs"
            placeholder="merged/all_styles.yaml"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)}
            className="accent-studio-accent" />
          Supprimer les sources après fusion
        </label>

        <button
          className="btn-ghost"
          onClick={() => prepareMutation.mutate()}
          disabled={sources.filter(Boolean).length < 2 || !target.trim() || prepareMutation.isPending}
        >
          {prepareMutation.isPending ? <Spinner size={14} /> : <ChevronRight size={14} />}
          Préparer la fusion
        </button>

        {prepareData && (
          <div className="card p-4 space-y-3 border-studio-accent/30">
            <div className="text-xs text-gray-400">
              <strong className="text-white">Aperçu de la fusion :</strong>
              <ul className="mt-2 space-y-1">
                {Object.entries(prepareData.source_entry_counts as Record<string, number>).map(([k, v]) => (
                  <li key={k} className="font-mono">{k} → {v} entrées</li>
                ))}
              </ul>
              <p className="mt-2 text-studio-success font-semibold">{prepareData.merged_entry_count} entrées après déduplication</p>
              {prepareData.duplicate_groups > 0 && (
                <p className="text-studio-warn">{prepareData.duplicate_groups} groupes de doublons supprimés</p>
              )}
            </div>
            <div className="max-h-32 overflow-y-auto bg-studio-bg rounded p-3">
              <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap">{prepareData.preview.slice(0, 1000)}</pre>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost text-sm" onClick={() => setPrepareData(null)}>Annuler</button>
              <button
                className="btn-primary flex-1 justify-center"
                onClick={() => executeMutation.mutate()}
                disabled={executeMutation.isPending}
              >
                {executeMutation.isPending ? <Spinner size={14} /> : <Merge size={14} />}
                Exécuter la fusion
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: history */}
      <div className="w-96 flex flex-col shrink-0">
        <h3 className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-3">Historique</h3>
        <div className="flex-1 overflow-y-auto space-y-2">
          {history.map((h) => (
            <div key={h.id} className="card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-gray-300 truncate">{h.result_file}</p>
                  <p className="text-xs text-gray-600">{new Date(h.merged_at).toLocaleString('fr')}</p>
                </div>
                <span className={`badge shrink-0 ${h.status === 'completed' ? 'bg-studio-success/20 text-studio-success' : 'bg-gray-500/20 text-gray-400'}`}>
                  {h.status}
                </span>
              </div>
              <p className="text-xs text-gray-500">{h.summary}</p>
              {h.status === 'completed' && (
                <button className="btn-ghost text-xs w-full justify-center" onClick={() => setConfirmRollback(h.id)}>
                  <RotateCcw size={11} /> Rollback
                </button>
              )}
            </div>
          ))}
          {history.length === 0 && (
            <p className="text-xs text-gray-600 text-center pt-8">Aucun historique</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRollback !== null}
        onClose={() => setConfirmRollback(null)}
        onConfirm={() => confirmRollback !== null && rollbackMutation.mutate(confirmRollback)}
        title="Rollback"
        message="Restaurer les fichiers sources et supprimer le fichier fusionné ?"
        confirmLabel="Rollback"
        danger
      />
    </div>
  )
}
