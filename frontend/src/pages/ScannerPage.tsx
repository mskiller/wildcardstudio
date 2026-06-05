import { useQuery, useMutation } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ScanSearch, ArrowLeftRight, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { scannerApi, type ScannerEntry, type ScannerFile } from '@/api/scanner'
import { StyleBadge, FormatBadge } from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'

export default function ScannerPage() {
  const [convertText, setConvertText] = useState('')
  const [direction, setDirection] = useState<'nl_to_tag' | 'tag_to_nl'>('nl_to_tag')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const pageSize = 500

  const { data: results, isLoading, error, refetch } = useQuery({
    queryKey: ['scanner-results', page],
    queryFn: () => scannerApi.results({ page, limit: pageSize }),
  })

  const { data: selectedScan, isLoading: selectedLoading, error: selectedError } = useQuery({
    queryKey: ['scanner-file', selectedPath],
    queryFn: () => scannerApi.scanFile(selectedPath!),
    enabled: !!selectedPath,
  })

  const scanMutation = useMutation({
    mutationFn: scannerApi.scan,
    onSuccess: (d) => {
      if (d.status === 'already_running') {
        toast('Un scan est déjà en cours')
      } else {
        const pruned = d.pruned ? `, ${d.pruned} anciens retirés` : ''
        toast.success(`${d.scanned} fichiers analysés${pruned}`)
      }
      setPage(1)
      refetch()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const convertMutation = useMutation({
    mutationFn: () => scannerApi.convert(convertText, direction),
    onError: (e: Error) => toast.error(e.message),
  })

  const summary = results?.summary
  const selectedFile = results?.files.find((f) => f.path === selectedPath)
  const totalPages = Math.max(1, Math.ceil((results?.total ?? 0) / (results?.limit ?? pageSize)))

  return (
    <div className="flex flex-col h-full p-5 gap-5">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Total', value: summary.total, color: 'text-white' },
            { label: 'TAG / Booru', value: summary.tag, color: 'text-studio-tag' },
            { label: 'Natural Language', value: summary.nl, color: 'text-studio-nl' },
            { label: 'Mixte', value: summary.mixed, color: 'text-studio-mixed' },
            { label: 'Inconnu', value: summary.unknown, color: 'text-gray-500' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card p-4 text-center">
              <div className={`text-2xl font-display font-semibold ${color}`}>{value}</div>
              <div className="text-xs text-gray-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
        >
          {scanMutation.isPending ? <Spinner size={14} /> : <ScanSearch size={14} />}
          Re-scanner tous les fichiers
        </button>
        {summary?.variants != null && (
          <span className="badge bg-studio-muted text-gray-400">{summary.variants} variantes</span>
        )}
        {summary?.wildcard_refs != null && (
          <span className="badge bg-studio-muted text-gray-400">{summary.wildcard_refs} refs wildcard</span>
        )}
        {summary?.yaml_files != null && (
          <span className="badge bg-studio-muted text-gray-400">{summary.yaml_files} YAML</span>
        )}
      </div>

      {/* Conversion tool */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400 font-medium">Convertisseur de style</span>
          <div className="flex rounded-md border border-studio-border overflow-hidden ml-auto">
            {(['nl_to_tag', 'tag_to_nl'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`px-3 py-1.5 text-xs transition-colors ${direction === d ? 'bg-studio-accent/20 text-studio-accent-glow' : 'text-gray-500 hover:text-white'}`}
              >
                {d === 'nl_to_tag' ? 'NL → TAG' : 'TAG → NL'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Source</label>
            <textarea
              className="input h-24 resize-none font-mono text-xs leading-relaxed"
              value={convertText}
              onChange={(e) => setConvertText(e.target.value)}
              placeholder={direction === 'nl_to_tag'
                ? 'A beautiful woman with long hair…'
                : 'masterpiece, best quality, 1girl…'}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Résultat</label>
            <div className="input h-24 font-mono text-xs leading-relaxed text-gray-300 overflow-auto">
              {convertMutation.data?.result || (
                <span className="text-gray-600">Résultat ici…</span>
              )}
            </div>
          </div>
        </div>
        {convertMutation.data?.note && (
          <p className="text-xs text-studio-warn">{convertMutation.data.note}</p>
        )}
        <button
          className="btn-primary text-xs"
          onClick={() => convertMutation.mutate()}
          disabled={!convertText.trim() || convertMutation.isPending}
        >
          <ArrowLeftRight size={12} />
          Convertir
        </button>
      </div>

      {/* File table + richer inspection */}
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 flex-1 min-h-0">
        <div className="overflow-auto">
          {isLoading ? (
            <div className="flex justify-center pt-8"><Spinner /></div>
          ) : error instanceof Error ? (
            <FriendlyPanel icon={<AlertTriangle size={18} />} title="Scanner indisponible" message={error.message} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-studio-border text-left">
                  {['Fichier', 'Style', 'Format', 'Entrées', 'Syntaxe', 'Classification', 'Scanné le'].map((h) => (
                    <th key={h} className="px-3 py-2 text-xs text-gray-500 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(results?.files ?? []).map((f) => (
                  <tr
                    key={f.path}
                    className={`border-b border-studio-border/50 hover:bg-studio-elevated/50 transition-colors cursor-pointer ${
                      selectedPath === f.path ? 'bg-studio-accent/10' : ''
                    }`}
                    onClick={() => setSelectedPath(f.path)}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-gray-300 truncate max-w-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronRight size={12} className={selectedPath === f.path ? 'text-studio-accent' : 'text-gray-700'} />
                        <span className="truncate">{f.path}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2"><StyleBadge style={f.effective_classification ?? f.prompt_style} /></td>
                    <td className="px-3 py-2"><FormatBadge format={f.format} /></td>
                    <td className="px-3 py-2 text-gray-400">{f.entry_count}</td>
                    <td className="px-3 py-2"><SyntaxSignals file={f} compact /></td>
                    <td className="px-3 py-2"><ClassificationSignals file={f} /></td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{f.last_scanned ? new Date(f.last_scanned).toLocaleString('fr') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <ScannerDetails
          file={selectedFile}
          scan={selectedScan}
          loading={selectedLoading}
          error={selectedError instanceof Error ? selectedError.message : null}
        />
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-3 border-t border-studio-border pt-3 text-xs text-gray-500">
          <button className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            <ChevronLeft size={13} /> Precedent
          </button>
          <span>Page {page} / {totalPages} - {results?.total ?? 0} fichiers</span>
          <button className="btn-ghost text-xs" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
            Suivant <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function SyntaxSignals({ file, compact = false }: { file: ScannerFile; compact?: boolean }) {
  const refs = file.wildcard_refs_count ?? file.refs_count
  const values = [
    { label: 'blancs', value: file.blank_count },
    { label: 'comm.', value: file.comment_count },
    { label: 'refs', value: refs },
    { label: 'var.', value: file.variants_count },
    { label: 'yaml', value: file.yaml_keys_count },
  ].filter((item) => item.value != null)

  if (values.length === 0) {
    return <span className="text-xs text-gray-700">—</span>
  }

  return (
    <div className={`flex flex-wrap gap-1 ${compact ? 'max-w-56' : ''}`}>
      {values.map((item) => (
        <span key={item.label} className="badge bg-studio-muted text-gray-400">
          {item.value} {item.label}
        </span>
      ))}
    </div>
  )
}

function ClassificationSignals({ file }: { file: ScannerFile }) {
  const reasons = normalizeReasons(file.classification_reasons)
  const score = file.classification_score == null
    ? null
    : file.classification_score <= 1
      ? `${Math.round(file.classification_score * 100)}%`
      : `${Math.round(file.classification_score)}%`

  if (!score && reasons.length === 0 && !file.error) {
    return <span className="text-xs text-gray-700">—</span>
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {score && <span className="text-xs font-mono text-gray-400">{score}</span>}
        {file.error && <span className="text-xs text-studio-danger truncate max-w-36">{file.error}</span>}
      </div>
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1 max-w-56">
          {reasons.slice(0, 3).map((reason) => (
            <span key={reason} className="badge bg-studio-accent/10 text-studio-accent-glow">{reason}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function ScannerDetails({
  file,
  scan,
  loading,
  error,
}: {
  file: ScannerFile | undefined
  scan: { path: string; overall_style: string; entry_total?: number; limit?: number; entries: ScannerEntry[] } | undefined
  loading: boolean
  error: string | null
}) {
  if (!file) {
    return (
      <aside className="card p-4 text-xs text-gray-600 leading-relaxed">
        Sélectionnez un fichier pour inspecter ses entrées, scores et raisons de classification.
      </aside>
    )
  }

  return (
    <aside className="card flex flex-col min-h-0 overflow-hidden">
      <div className="p-4 border-b border-studio-border space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white truncate">{file.path}</h2>
          <p className="text-xs text-gray-600 mt-1">{file.entry_count} entrées indexées</p>
        </div>
        <SyntaxSignals file={file} />
        <ClassificationSignals file={file} />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex justify-center pt-8"><Spinner /></div>
        ) : error ? (
          <FriendlyPanel icon={<AlertTriangle size={18} />} title="Détail indisponible" message={error} />
        ) : (
          <>
            {(scan?.entries ?? []).slice(0, 80).map((entry, index) => (
              <EntryCard key={`${entry.line_number ?? index}-${entry.content}`} entry={entry} index={index} />
            ))}
            {scan?.entry_total != null && scan.entry_total > (scan.limit ?? scan.entries.length) && (
              <p className="text-xs text-gray-600 text-center py-2">
                {scan.entries.length} / {scan.entry_total} entrées chargées pour garder l'inspection fluide.
              </p>
            )}
            {(scan?.entries ?? []).length === 0 && (
              <p className="text-xs text-gray-600 text-center pt-8">Aucune entrée retournée par le scanner.</p>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

function EntryCard({ entry, index }: { entry: ScannerEntry; index: number }) {
  const score = entry.classification_score ?? Math.max(entry.tag_score ?? 0, entry.nl_score ?? 0)
  const scoreLabel = score <= 1 ? `${Math.round(score * 100)}%` : `${Math.round(score)}%`
  const reasons = normalizeReasons(entry.classification_reasons)

  return (
    <div className="rounded-md border border-studio-border bg-studio-bg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-gray-600">#{index + 1}</span>
          {entry.line_number && <span className="badge bg-studio-muted text-gray-500">ligne {entry.line_number}</span>}
          {entry.yaml_path && <span className="badge bg-studio-muted text-gray-500 truncate max-w-28">{entry.yaml_path}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StyleBadge style={entry.classification ?? entry.style} />
          <span className="text-xs font-mono text-gray-500">{scoreLabel}</span>
        </div>
      </div>
      <p className="text-xs font-mono text-gray-400 leading-relaxed line-clamp-3">{entry.content}</p>
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {reasons.map((reason) => (
            <span key={reason} className="badge bg-studio-accent/10 text-studio-accent-glow">{reason}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function normalizeReasons(value: ScannerFile['classification_reasons']): string[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : []
  }
  return Object.entries(value)
    .flatMap(([key, raw]) => {
      if (raw == null || raw === false) {
        return []
      }
      if (typeof raw === 'object') {
        return Object.entries(raw as Record<string, unknown>)
          .filter(([, nestedValue]) => nestedValue != null && nestedValue !== 0 && nestedValue !== false)
          .map(([nestedKey, nestedValue]) => `${nestedKey}: ${nestedValue}`)
      }
      return [`${key}: ${raw}`]
    })
    .map((item) => item.trim())
    .filter(Boolean)
}

function FriendlyPanel({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <div className="rounded-md border border-studio-warn/30 bg-studio-warn/10 p-4 text-sm text-studio-warn">
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <p className="text-xs leading-relaxed mt-2 opacity-90">{message}</p>
    </div>
  )
}
