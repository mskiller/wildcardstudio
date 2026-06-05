import { useState, useEffect, type Dispatch, type SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2, Eye, EyeOff, Search, Star } from 'lucide-react'
import toast from 'react-hot-toast'
import { explorerApi } from '@/api/explorer'
import { metadataApi, type ReviewClassification } from '@/api/metadata'
import { useExplorerStore } from '@/store/explorerStore'
import { useEditorStore } from '@/store/editorStore'
import { buildEditorNavigationUrl } from '@/store/editorNavigation'
import FileTree from '@/components/explorer/FileTree'
import FilePreview from '@/components/explorer/FilePreview'
import SearchInput from '@/components/shared/SearchInput'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Spinner from '@/components/shared/Spinner'
import { StyleBadge, FormatBadge } from '@/components/shared/Badge'

type MetadataForm = {
  category: string
  status: string
  favorite: boolean
  notes: string
  classification_override: ReviewClassification | ''
}

const CLASSIFICATION_OPTIONS: { value: ReviewClassification; label: string }[] = [
  { value: 'tag', label: 'TAG / Booru' },
  { value: 'nl', label: 'Natural Language' },
  { value: 'mixed', label: 'Mixte' },
  { value: 'unknown', label: 'Inconnu' },
]

const emptyToNull = (value: string) => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export default function ExplorerPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { selectedPath, setSelectedPath } = useExplorerStore()
  const requestOpenInEditor = useEditorStore((s) => s.requestOpenInEditor)
  const [searchQuery, setSearchQuery] = useState('')
  const [editorContent, setEditorContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [newFileName, setNewFileName] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)
  const [metadataForm, setMetadataForm] = useState<MetadataForm>({
    category: '',
    status: '',
    favorite: false,
    notes: '',
    classification_override: '',
  })

  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ['tree'],
    queryFn: explorerApi.getTree,
    refetchInterval: 10_000,
  })

  const { data: file, isLoading: fileLoading } = useQuery({
    queryKey: ['file', selectedPath],
    queryFn: () => explorerApi.getFile(selectedPath!),
    enabled: !!selectedPath,
  })

  const { data: metadata, error: metadataLoadError } = useQuery({
    queryKey: ['metadata', 'file', selectedPath],
    queryFn: () => metadataApi.getFile(selectedPath!),
    enabled: !!selectedPath,
  })

  // Sync editor when a new file is loaded (but not while user is editing)
  useEffect(() => {
    if (file) {
      setEditorContent(file.content)
      setIsDirty(false)
    }
  }, [file?.path, file?.content])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedPath) {
      setMetadataForm({
        category: '',
        status: '',
        favorite: false,
        notes: '',
        classification_override: '',
      })
      return
    }

    const source = metadata ?? file
    setMetadataForm({
      category: source?.category ?? '',
      status: source?.status ?? '',
      favorite: Boolean(source?.favorite),
      notes: source?.notes ?? '',
      classification_override: (source?.classification_override as ReviewClassification | null) ?? '',
    })
  }, [
    selectedPath,
    file?.category,
    file?.status,
    file?.favorite,
    file?.notes,
    file?.classification_override,
    metadata?.category,
    metadata?.status,
    metadata?.favorite,
    metadata?.notes,
    metadata?.classification_override,
  ])

  // Reset dirty flag when user switches files
  useEffect(() => {
    setIsDirty(false)
    setTab('edit')
  }, [selectedPath])

  const { data: searchResults } = useQuery({
    queryKey: ['search', searchQuery],
    queryFn: () => explorerApi.search(searchQuery),
    enabled: searchQuery.length > 2,
  })

  const saveMutation = useMutation({
    mutationFn: () => explorerApi.saveFile(selectedPath!, editorContent),
    onSuccess: () => {
      toast.success('Fichier sauvegardé')
      setIsDirty(false)
      qc.invalidateQueries({ queryKey: ['tree'] })
      qc.invalidateQueries({ queryKey: ['file', selectedPath] })
      qc.invalidateQueries({ queryKey: ['preview', selectedPath] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => explorerApi.deleteFile(selectedPath!),
    onSuccess: () => {
      toast.success('Fichier supprimé')
      setSelectedPath(null)
      setEditorContent('')
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createMutation = useMutation({
    mutationFn: () => explorerApi.createFile(newFileName),
    onSuccess: () => {
      toast.success('Fichier créé')
      setShowNewFile(false)
      setNewFileName('')
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const metadataMutation = useMutation({
    mutationFn: () => {
      if (!selectedPath) throw new Error('Aucun fichier sélectionné')
      return metadataApi.saveFile(selectedPath, {
        category: emptyToNull(metadataForm.category),
        status: emptyToNull(metadataForm.status),
        favorite: metadataForm.favorite,
        notes: emptyToNull(metadataForm.notes),
        classification_override: metadataForm.classification_override || null,
      })
    },
    onSuccess: () => {
      toast.success('Métadonnées sauvegardées')
      qc.invalidateQueries({ queryKey: ['tree'] })
      qc.invalidateQueries({ queryKey: ['file', selectedPath] })
      qc.invalidateQueries({ queryKey: ['metadata', 'file', selectedPath] })
    },
    onError: (e: Error) => toast.error(`Métadonnées indisponibles : ${e.message}`),
  })

  const openSelectedInEditor = (lineNumber?: number) => {
    if (!selectedPath) return
    const request = {
      file_path: selectedPath,
      line_number: lineNumber,
      label: lineNumber ? `Explorer:${lineNumber}` : 'Explorer',
      source: 'explorer' as const,
    }
    requestOpenInEditor(request)
    navigate(buildEditorNavigationUrl(request))
  }

  return (
    <div className="flex h-full">
      {/* Sidebar: tree */}
      <div className="w-64 border-r border-studio-border flex flex-col bg-studio-surface shrink-0">
        <div className="p-3 border-b border-studio-border space-y-2">
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Rechercher dans les wildcards…" />
          <button className="btn-primary w-full text-xs justify-center" onClick={() => setShowNewFile(true)}>
            <Plus size={13} /> Nouveau fichier
          </button>
        </div>

        {showNewFile && (
          <div className="p-3 border-b border-studio-border bg-studio-elevated space-y-2">
            <input
              className="input text-xs"
              placeholder="chemin/nom.yaml"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newFileName.trim() && createMutation.mutate()}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                className="btn-primary text-xs flex-1 justify-center"
                onClick={() => createMutation.mutate()}
                disabled={!newFileName.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? <Spinner size={12} /> : null}
                Créer
              </button>
              <button className="btn-ghost text-xs" onClick={() => setShowNewFile(false)}>Annuler</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {treeLoading ? (
            <div className="flex justify-center pt-8"><Spinner /></div>
          ) : searchQuery.length > 2 ? (
            <div className="space-y-2">
              {(searchResults?.results ?? []).map((r) => (
                <div key={r.path} className="space-y-1">
                  <button
                    className="text-xs text-studio-accent font-mono hover:underline truncate block w-full text-left px-1"
                    onClick={() => { setSelectedPath(r.path); setSearchQuery('') }}
                  >
                    {r.path}
                  </button>
                  {r.matches.slice(0, 3).map((m, i) => (
                    <div key={i} className="text-xs text-gray-500 font-mono pl-3 truncate">{m.content}</div>
                  ))}
                </div>
              ))}
              {searchResults?.results.length === 0 && (
                <p className="text-xs text-gray-600 text-center pt-4">Aucun résultat</p>
              )}
            </div>
          ) : tree ? (
            <FileTree node={tree} />
          ) : null}
        </div>
      </div>

      {/* Main: editor / preview */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedPath ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-studio-border bg-studio-surface shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-mono text-gray-400 truncate">{selectedPath}</span>
                {file && <StyleBadge style={file.prompt_style} />}
                {file && <FormatBadge format={file.format} />}
                {isDirty && <span className="badge bg-studio-warn/20 text-studio-warn">non sauvegardé</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => openSelectedInEditor()}
                >
                  Ouvrir dans l’éditeur
                </button>
                <div className="flex rounded-md border border-studio-border overflow-hidden">
                  <button
                    onClick={() => setTab('edit')}
                    className={`px-3 py-1 text-xs transition-colors flex items-center gap-1 ${tab === 'edit' ? 'bg-studio-accent/20 text-studio-accent-glow' : 'text-gray-500 hover:text-white'}`}
                  >
                    <Eye size={11} /> Éditer
                  </button>
                  <button
                    onClick={() => setTab('preview')}
                    className={`px-3 py-1 text-xs transition-colors flex items-center gap-1 ${tab === 'preview' ? 'bg-studio-accent/20 text-studio-accent-glow' : 'text-gray-500 hover:text-white'}`}
                  >
                    <EyeOff size={11} /> Aperçu
                  </button>
                </div>
                <button
                  className="btn-primary text-xs"
                  onClick={() => saveMutation.mutate()}
                  disabled={!isDirty || saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Spinner size={12} /> : <Save size={12} />}
                  Sauvegarder
                </button>
                <button className="btn-danger text-xs" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              {fileLoading ? (
                <div className="flex justify-center pt-16"><Spinner /></div>
              ) : tab === 'edit' ? (
                <textarea
                  className="w-full h-full bg-studio-bg text-gray-300 font-mono text-sm p-4 resize-none focus:outline-none leading-relaxed"
                  value={editorContent}
                  onChange={(e) => { setEditorContent(e.target.value); setIsDirty(true) }}
                  spellCheck={false}
                />
              ) : (
                <div className="p-5">
                  <FilePreview path={selectedPath} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-600">
            <Search size={40} className="mb-4 opacity-30" />
            <p className="text-sm">Sélectionnez un fichier dans l'arborescence</p>
            <p className="text-xs mt-1 text-gray-700">ou utilisez la recherche pour trouver des wildcards</p>
          </div>
        )}
      </div>

      <MetadataPanel
        selectedPath={selectedPath}
        file={file}
        form={metadataForm}
        setForm={setMetadataForm}
        onSave={() => metadataMutation.mutate()}
        isSaving={metadataMutation.isPending}
        error={
          metadataMutation.error instanceof Error
            ? metadataMutation.error.message
            : metadataLoadError instanceof Error
              ? metadataLoadError.message
              : null
        }
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Supprimer le fichier"
        message={`Supprimer "${selectedPath}" ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        danger
      />
    </div>
  )
}

function MetadataPanel({
  selectedPath,
  file,
  form,
  setForm,
  onSave,
  isSaving,
  error,
}: {
  selectedPath: string | null
  file: Awaited<ReturnType<typeof explorerApi.getFile>> | undefined
  form: MetadataForm
  setForm: Dispatch<SetStateAction<MetadataForm>>
  onSave: () => void
  isSaving: boolean
  error: string | null
}) {
  const reasons = normalizeReasons(file?.classification_reasons)
  const hasScannerSignals =
    file?.blank_count != null ||
    file?.comment_count != null ||
    file?.wildcard_refs_count != null ||
    file?.variants_count != null ||
    file?.yaml_keys_count != null ||
    file?.classification_score != null ||
    reasons.length > 0

  return (
    <aside className="w-80 border-l border-studio-border bg-studio-surface shrink-0 overflow-y-auto">
      <div className="p-4 border-b border-studio-border">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Révision</h2>
            <p className="text-xs text-gray-600 mt-1">Métadonnées du fichier sélectionné</p>
          </div>
          <button
            className={`p-2 rounded-md border transition-colors ${
              form.favorite
                ? 'border-studio-warn/40 bg-studio-warn/15 text-studio-warn'
                : 'border-studio-border text-gray-600 hover:text-studio-warn'
            }`}
            onClick={() => setForm((f) => ({ ...f, favorite: !f.favorite }))}
            disabled={!selectedPath}
            title={form.favorite ? 'Retirer des favoris' : 'Marquer favori'}
          >
            <Star size={14} className={form.favorite ? 'fill-current' : undefined} />
          </button>
        </div>
      </div>

      {selectedPath ? (
        <div className="p-4 space-y-4">
          <div className="space-y-1">
            <p className="text-xs text-gray-500">Fichier</p>
            <p className="text-xs font-mono text-gray-300 break-all">{selectedPath}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs text-gray-500">Catégorie</span>
              <input
                className="input text-xs"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="character/style"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-500">Statut</span>
              <input
                className="input text-xs"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                placeholder="todo, reviewed..."
              />
            </label>
          </div>

          <label className="space-y-1 block">
            <span className="text-xs text-gray-500">Classification forcée</span>
            <select
              className="input text-xs"
              value={form.classification_override}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  classification_override: e.target.value as ReviewClassification | '',
                }))
              }
            >
              <option value="">Auto</option>
              {CLASSIFICATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 block">
            <span className="text-xs text-gray-500">Notes</span>
            <textarea
              className="input min-h-28 resize-none text-xs leading-relaxed"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Contexte, qualité, modèle conseillé..."
            />
          </label>

          <button className="btn-primary w-full justify-center text-xs" onClick={onSave} disabled={isSaving}>
            {isSaving ? <Spinner size={12} /> : <Save size={12} />}
            Sauver la révision
          </button>

          {error && (
            <div className="rounded-md border border-studio-warn/30 bg-studio-warn/10 p-3 text-xs text-studio-warn leading-relaxed">
              L'API <span className="font-mono">/metadata</span> n'est pas disponible ou a refusé la sauvegarde. Les champs restent éditables ici et seront prêts dès que le backend répond.
            </div>
          )}

          <div className="border-t border-studio-border pt-4 space-y-3">
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-gray-500">Signaux scanner</h3>
              <p className="text-xs text-gray-700 mt-1">Affichés automatiquement si le backend enrichit le fichier.</p>
            </div>

            {hasScannerSignals ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="Blancs" value={file?.blank_count} />
                  <Metric label="Commentaires" value={file?.comment_count} />
                  <Metric label="Refs" value={file?.wildcard_refs_count} />
                  <Metric label="Variantes" value={file?.variants_count} />
                  <Metric label="Clés YAML" value={file?.yaml_keys_count} />
                  <Metric
                    label="Score"
                    value={file?.classification_score == null ? null : `${Math.round(file.classification_score * 100)}%`}
                  />
                </div>
                {reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {reasons.map((reason) => (
                      <span key={reason} className="badge bg-studio-muted text-gray-400">{reason}</span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-600 leading-relaxed">
                Aucun signal enrichi reçu pour ce fichier pour le moment.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 text-xs text-gray-600 leading-relaxed">
          Sélectionnez un fichier pour ajouter une catégorie, un statut, des notes et une classification manuelle.
        </div>
      )}
    </aside>
  )
}

function normalizeReasons(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : []
  }
  if (typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, raw]) => {
      if (raw == null || raw === false) return []
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

function Metric({ label, value }: { label: string; value: number | string | null | undefined }) {
  return (
    <div className="rounded-md border border-studio-border bg-studio-bg p-2">
      <div className="text-sm font-semibold text-gray-300">{value ?? '—'}</div>
      <div className="text-[10px] text-gray-600 mt-0.5">{label}</div>
    </div>
  )
}
