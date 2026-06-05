import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, ClipboardList, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { actionsApi, type ActionPreview } from '@/api/actions'
import Spinner from '@/components/shared/Spinner'

export default function ActionsPage() {
  const [limit, setLimit] = useState(100)

  const previewMutation = useMutation({
    mutationFn: () => actionsApi.preview({ action: 'dedupe_cleanup', source: 'auto', threshold: 85, max_groups: limit }),
    onSuccess: (data) => {
      const normalized = normalizePreview(data)
      toast.success(`${normalized.actionCount} actions proposées`)
    },
  })

  const preview = useMemo(
    () => previewMutation.data ? normalizePreview(previewMutation.data) : null,
    [previewMutation.data],
  )
  const error = previewMutation.error instanceof Error ? previewMutation.error.message : null
  const missingEndpoint = error ? /not found|404|method not allowed/i.test(error) : false

  return (
    <div className="flex flex-col h-full p-5 gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-gray-600">Prévisualisation non destructive</p>
          <h1 className="text-xl font-display font-semibold text-white mt-1">Actions de nettoyage</h1>
          <p className="text-sm text-gray-500 mt-2 max-w-2xl">
            Cette page demande au backend un plan d'actions vérifiable. Elle n'exécute aucune suppression, fusion ou écriture.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-xs text-gray-500 flex items-center gap-2">
            Limite
            <input
              className="input w-24 text-xs"
              type="number"
              min={10}
              max={500}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 100)}
            />
          </label>
          <button
            className="btn-primary"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
          >
            {previewMutation.isPending ? <Spinner size={14} /> : <ClipboardList size={14} />}
            Préparer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-studio-success">
            <ShieldCheck size={16} />
            <span className="text-sm font-medium">Lecture seule</span>
          </div>
          <p className="text-xs text-gray-600 mt-2 leading-relaxed">
            Aucun bouton destructeur n'est affiché ici tant qu'une API backend sûre ne confirme pas explicitement l'exécution.
          </p>
        </div>
        <StatCard label="Actions proposées" value={preview?.actionCount ?? '—'} />
        <StatCard label="Groupes" value={preview?.groupCount ?? '—'} />
      </div>

      {error && (
        <div className="rounded-md border border-studio-warn/30 bg-studio-warn/10 p-4 text-studio-warn">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle size={16} />
            {missingEndpoint ? 'API /actions/preview absente' : 'Aperçu indisponible'}
          </div>
          <p className="text-xs leading-relaxed mt-2 opacity-90">
            {missingEndpoint
              ? "Le frontend est prêt, mais le backend ne fournit pas encore l'endpoint d'aperçu. La page restera non destructive jusqu'à son arrivée."
              : error}
          </p>
        </div>
      )}

      <div className="card flex-1 min-h-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-studio-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Aperçu</h2>
            <p className="text-xs text-gray-600 mt-1">{preview?.note ?? 'Préparez un aperçu pour inspecter les actions proposées.'}</p>
          </div>
          <div className="flex items-center gap-2">
            {preview?.source && (
              <span className="badge bg-studio-muted text-gray-400">{preview.source}</span>
            )}
            {preview?.createdAt && (
              <span className="text-xs text-gray-600">{preview.createdAt}</span>
            )}
          </div>
        </div>

        <div className="h-full overflow-y-auto p-4">
          {previewMutation.isPending ? (
            <div className="flex justify-center pt-12"><Spinner /></div>
          ) : preview && preview.actions.length > 0 ? (
            <div className="space-y-2">
              {preview.actions.map((action, index) => (
                <div key={index} className="rounded-md border border-studio-border bg-studio-bg p-3">
                  <div className="text-xs text-gray-600 mb-2">Action #{index + 1}</div>
                  <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(action, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center text-gray-600 py-16">
              <ClipboardList size={40} className="mb-3 opacity-30" />
              <p className="text-sm">Aucun aperçu chargé</p>
              <p className="text-xs mt-1">Cliquez sur Préparer pour demander un plan de dédoublonnage au backend.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function normalizePreview(preview: ActionPreview) {
  const payload = preview.payload ?? preview
  const groups = Array.isArray(preview.groups) ? preview.groups : []
  const groupedActions = groups.flatMap((group, groupIndex) =>
    (group.proposed_actions ?? []).map((action) => ({
      group_index: groupIndex + 1,
      group_id: group.group_id ?? null,
      group_type: group.type ?? null,
      group_confidence: group.confidence ?? null,
      ...action,
    })),
  )
  const actions = Array.isArray(payload.actions) ? payload.actions : groupedActions
  const createdAt = formatDate(preview.created_at)

  return {
    kind: payload.kind ?? preview.kind ?? preview.action ?? 'dedupe_cleanup',
    source: preview.source,
    groupCount: preview.summary?.groups ?? groups.length,
    actionCount: payload.action_count ?? preview.action_count ?? actions.length,
    actions,
    note: payload.note ?? preview.note ?? `${preview.summary?.proposed_removals ?? 0} suppressions proposées sur ${preview.summary?.entries_considered ?? 0} entrées considérées.`,
    createdAt,
  }
}

function formatDate(value: ActionPreview['created_at']) {
  if (value == null) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value)

  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('fr')
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-display font-semibold text-white">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}
