import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Star, Trash2, BookOpen, Image as ImageIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { libraryApi, type PromptItem } from '@/api/library'
import { generationApi } from '@/api/generation'
import SearchInput from '@/components/shared/SearchInput'
import Modal from '@/components/shared/Modal'
import Spinner from '@/components/shared/Spinner'
import { StyleBadge } from '@/components/shared/Badge'
import TokenCounter from '@/components/editor/TokenCounter'

const MODELS = ['sdxl', 'illustrious', 'noobai', 'other']

export default function LibraryPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [model, setModel] = useState<string | undefined>()
  const [collection, setCollection] = useState<string | undefined>()
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ title: '', content: '', model_target: 'sdxl', notes: '', collection: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['library', page, search, model, collection],
    queryFn: () => libraryApi.list({ page, limit: 20, q: search || undefined, model, collection }),
  })

  const { data: collections } = useQuery({
    queryKey: ['library-collections'],
    queryFn: libraryApi.collections,
  })

  const { data: generationHistory } = useQuery({
    queryKey: ['generation-history', 'library'],
    queryFn: () => generationApi.history({ limit: 5 }),
    retry: false,
  })

  const createMutation = useMutation({
    mutationFn: () => libraryApi.create({ ...form }),
    onSuccess: () => {
      toast.success('Prompt sauvegardé')
      setShowCreate(false)
      setForm({ title: '', content: '', model_target: 'sdxl', notes: '', collection: '' })
      qc.invalidateQueries({ queryKey: ['library'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => libraryApi.delete(id),
    onSuccess: () => { toast.success('Supprimé'); qc.invalidateQueries({ queryKey: ['library'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const ratingMutation = useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: number }) => libraryApi.update(id, { rating }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  })

  const imageLinkedCount = data?.items.filter((item) => item.image_path).length ?? 0

  return (
    <div className="flex flex-col h-full p-5 gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} className="flex-1 max-w-sm" />
        <div className="flex gap-1">
          {MODELS.map((m) => (
            <button
              key={m}
              onClick={() => setModel(model === m ? undefined : m)}
              className={`px-2.5 py-1 rounded text-xs transition-colors border ${model === m ? 'border-studio-accent/50 bg-studio-accent/15 text-studio-accent-glow' : 'border-studio-border text-gray-500 hover:text-white'}`}
            >
              {m}
            </button>
          ))}
        </div>
        {(collections?.collections ?? []).map((c) => (
          <button
            key={c}
            onClick={() => setCollection(collection === c ? undefined : c)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${collection === c ? 'border-studio-accent/50 bg-studio-accent/15 text-studio-accent-glow' : 'border-studio-border text-gray-500 hover:text-white'}`}
          >
            {c}
          </button>
        ))}
        <button className="btn-primary ml-auto" onClick={() => setShowCreate(true)}>
          <Plus size={13} /> Ajouter
        </button>
      </div>

      {imageLinkedCount > 0 && (
        <div className="rounded-md border border-studio-accent/25 bg-studio-accent/10 px-3 py-2 text-xs text-studio-accent-glow flex items-center gap-2">
          <ImageIcon size={14} />
          {imageLinkedCount} prompt{imageLinkedCount > 1 ? 's' : ''} de cette page possède{imageLinkedCount > 1 ? 'nt' : ''} une image ou génération liée.
        </div>
      )}

      {(generationHistory?.items?.length ?? 0) > 0 && (
        <div className="rounded-md border border-studio-border bg-studio-surface px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
            <ImageIcon size={14} />
            Dernières générations sauvegardées
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {generationHistory!.items.slice(0, 5).map((item, index) => (
              <div key={`${item.id ?? index}`} className="min-w-56 rounded-md border border-studio-border bg-studio-bg p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="badge bg-studio-muted text-gray-400">{item.provider ?? 'generation'}</span>
                  <span className="text-[10px] text-gray-700">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString('fr') : '—'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 line-clamp-2 mt-2">{item.prompt ?? 'Prompt sans titre'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cards */}
      {isLoading ? (
        <div className="flex justify-center pt-12"><Spinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4 flex-1 overflow-y-auto">
            {(data?.items ?? []).map((p) => (
              <PromptCard
                key={p.id}
                prompt={p}
                readOnly={p.id < 0}
                onDelete={() => p.id > 0 && deleteMutation.mutate(p.id)}
                onRate={(r) => p.id > 0 && ratingMutation.mutate({ id: p.id, rating: r })}
              />
            ))}
            {data?.items.length === 0 && (
              <div className="col-span-3 flex flex-col items-center justify-center text-gray-600 py-16">
                <BookOpen size={40} className="mb-3 opacity-30" />
                <p className="text-sm">Aucun prompt dans la bibliothèque</p>
              </div>
            )}
          </div>
          {data && data.total > 20 && (
            <div className="flex justify-center gap-2 shrink-0">
              <button className="btn-ghost text-xs" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
              <span className="text-xs text-gray-500 self-center">Page {page}</span>
              <button className="btn-ghost text-xs" disabled={page * 20 >= data.total} onClick={() => setPage(p => p + 1)}>Suivant</button>
            </div>
          )}
        </>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Ajouter un prompt" width="max-w-2xl">
        <div className="space-y-3">
          <input className="input" placeholder="Titre (optionnel)" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} />
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">Contenu du prompt *</label>
              <TokenCounter text={form.content} />
            </div>
            <textarea
              className="input h-36 resize-none font-mono text-xs leading-relaxed"
              placeholder="masterpiece, best quality…"
              value={form.content}
              onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Modèle cible</label>
              <select className="input text-sm" value={form.model_target} onChange={(e) => setForm(f => ({ ...f, model_target: e.target.value }))}>
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Collection</label>
              <input className="input" placeholder="favoris, paysages…" value={form.collection} onChange={(e) => setForm(f => ({ ...f, collection: e.target.value }))} />
            </div>
          </div>
          <textarea className="input h-16 resize-none text-sm" placeholder="Notes…" value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setShowCreate(false)}>Annuler</button>
            <button className="btn-primary" onClick={() => createMutation.mutate()} disabled={!form.content.trim() || createMutation.isPending}>
              {createMutation.isPending ? <Spinner size={14} /> : null}
              Sauvegarder
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function PromptCard({
  prompt,
  readOnly,
  onDelete,
  onRate,
}: {
  prompt: PromptItem
  readOnly?: boolean
  onDelete: () => void
  onRate: (r: number) => void
}) {
  return (
    <div className="card p-4 space-y-3 group hover:border-studio-muted transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {prompt.title && <p className="text-sm font-medium text-white truncate">{prompt.title}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StyleBadge style={prompt.prompt_style} />
            {prompt.model_target && (
              <span className="badge bg-studio-muted text-gray-400">{prompt.model_target}</span>
            )}
            {prompt.collection && (
              <span className="badge bg-studio-muted text-gray-400">{prompt.collection}</span>
            )}
            {prompt.image_path && (
              <span className="badge bg-studio-accent/15 text-studio-accent-glow">image liée</span>
            )}
            {prompt.token_count && (
              <span className="text-xs font-mono text-gray-600">{prompt.token_count} tokens</span>
            )}
            {readOnly && (
              <span className="badge bg-studio-accent/10 text-studio-accent-glow">index wildcard</span>
            )}
          </div>
        </div>
        {!readOnly && (
          <button onClick={onDelete} className="text-gray-600 hover:text-studio-danger opacity-0 group-hover:opacity-100 transition-all shrink-0">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <p className="text-xs font-mono text-gray-400 leading-relaxed line-clamp-3">{prompt.content}</p>
      <div className="flex items-center justify-between">
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => onRate(n)} disabled={readOnly} title={readOnly ? 'Prompt indexé en lecture seule' : undefined}>
              <Star
                size={13}
                className={n <= (prompt.rating ?? 0) ? 'text-studio-warn fill-studio-warn' : 'text-gray-700 hover:text-gray-500'}
              />
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-700">{new Date(prompt.created_at).toLocaleDateString('fr')}</span>
      </div>
    </div>
  )
}
