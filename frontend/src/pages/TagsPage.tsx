import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Download, Tag, Check, Copy, Sparkles, ArrowUp, ArrowDown, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { tagsApi } from '@/api/tags'
import SearchInput from '@/components/shared/SearchInput'
import Spinner from '@/components/shared/Spinner'
import { useTagStore } from '@/store/tagStore'
import TagTooltip from '@/components/shared/TagTooltip'

export default function TagsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [selectedCat, setSelectedCat] = useState<number | null>(null)
  const [newTagName, setNewTagName] = useState('')

  // Filter & Sort state
  const [sortBy, setSortBy] = useState<'count_desc' | 'count_asc' | 'alpha_asc' | 'alpha_desc'>('count_desc')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'custom' | 'wildcard'>('all')
  const [selectionFilter, setSelectionFilter] = useState<'all' | 'unselected' | 'selected'>('all')

  const { data: categories = [] } = useQuery({ queryKey: ['tag-categories'], queryFn: tagsApi.listCategories })
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['tags', selectedCat, search],
    queryFn: () => tagsApi.list({ category: selectedCat ?? undefined, q: search || undefined }),
  })

  // Zustand Store
  const selectedTags = useTagStore((s) => s.selectedTags)
  const toggleTag = useTagStore((s) => s.toggleTag)
  const removeTag = useTagStore((s) => s.removeTag)
  const reorderTags = useTagStore((s) => s.reorderTags)
  const clearSelection = useTagStore((s) => s.clearSelection)
  const sendToGenerator = useTagStore((s) => s.sendToGenerator)

  const createTag = useMutation({
    mutationFn: () => tagsApi.create({ name: newTagName, category_id: selectedCat ?? undefined }),
    onSuccess: () => {
      toast.success('Tag créé')
      setNewTagName('')
      qc.invalidateQueries({ queryKey: ['tags'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteTag = useMutation({
    mutationFn: (id: number) => tagsApi.delete(id),
    onSuccess: () => {
      toast.success('Tag supprimé')
      qc.invalidateQueries({ queryKey: ['tags'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const importMutation = useMutation({
    mutationFn: tagsApi.importFromWildcards,
    onSuccess: (d) => {
      toast.success(`${d.imported} tags importés`)
      qc.invalidateQueries({ queryKey: ['tags'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Filter and Sort implementation
  const processedTags = useMemo(() => {
    return tags
      .filter((tag) => {
        // Source Filter
        if (sourceFilter === 'custom' && tag.source === 'wildcard_index') return false
        if (sourceFilter === 'wildcard' && tag.source !== 'wildcard_index') return false

        // Selection Filter
        const isSelected = selectedTags.some((t) => t.id === tag.id)
        if (selectionFilter === 'selected' && !isSelected) return false
        if (selectionFilter === 'unselected' && isSelected) return false

        return true
      })
      .sort((a, b) => {
        if (sortBy === 'count_desc') return (b.usage_count || 0) - (a.usage_count || 0)
        if (sortBy === 'count_asc') return (a.usage_count || 0) - (b.usage_count || 0)
        if (sortBy === 'alpha_asc') return a.name.localeCompare(b.name)
        if (sortBy === 'alpha_desc') return b.name.localeCompare(a.name)
        return 0
      })
  }, [tags, sourceFilter, selectionFilter, selectedTags, sortBy])

  const handleCopyPrompt = () => {
    const prompt = selectedTags.map((t) => t.name).join(', ')
    navigator.clipboard.writeText(prompt)
    toast.success('Prompt copié dans le presse-papiers !')
  }

  const handleSendToGenerator = () => {
    sendToGenerator()
    toast.success('Prompt préparé. Redirection vers le générateur…')
    navigate('/generator')
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Category sidebar */}
      <div className="w-56 border-r border-studio-border bg-studio-surface flex flex-col shrink-0">
        <div className="p-3 border-b border-studio-border">
          <p className="text-xs text-gray-500 font-mono uppercase tracking-wider">Catégories</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <button
            onClick={() => setSelectedCat(null)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              selectedCat === null
                ? 'bg-studio-accent/15 text-studio-accent-glow font-medium'
                : 'text-gray-400 hover:text-white hover:bg-studio-elevated'
            }`}
          >
            <Tag size={13} />
            <span>Tous les tags</span>
            <span className="ml-auto text-xs text-gray-600">{tags.length}</span>
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCat(cat.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                selectedCat === cat.id
                  ? 'bg-studio-accent/15 text-studio-accent-glow font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-studio-elevated'
              }`}
            >
              <span>{cat.icon || '🏷️'}</span>
              <span className="truncate">{cat.name}</span>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-studio-border">
          <button
            className="btn-ghost w-full text-xs justify-center"
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? <Spinner size={12} /> : <Download size={12} />}
            Importer depuis wildcards
          </button>
        </div>
      </div>

      {/* Main tag grid area */}
      <div className="flex-1 flex flex-col min-w-0 p-5 gap-4 overflow-hidden">
        <div className="flex flex-col gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <SearchInput value={search} onChange={setSearch} className="flex-1 max-w-sm" />
            <div className="flex gap-2 ml-auto">
              <input
                className="input text-xs w-44"
                placeholder="Nouveau tag…"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newTagName.trim() && createTag.mutate()}
              />
              <button
                className="btn-primary text-xs"
                onClick={() => createTag.mutate()}
                disabled={!newTagName.trim() || createTag.isPending}
              >
                <Plus size={12} /> Ajouter
              </button>
            </div>
          </div>

          {/* Filtering and Sorting Row */}
          <div className="flex flex-wrap items-center gap-3 bg-studio-surface/50 border border-studio-border/60 rounded-lg p-2.5 text-xs text-gray-400">
            <div className="flex items-center gap-1.5">
              <span>Trier par :</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="bg-studio-elevated border border-studio-border rounded px-2 py-1 text-gray-200 focus:outline-none"
              >
                <option value="count_desc">Popularité (Décroissant)</option>
                <option value="count_asc">Popularité (Croissant)</option>
                <option value="alpha_asc">Nom (A-Z)</option>
                <option value="alpha_desc">Nom (Z-A)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span>Source :</span>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
                className="bg-studio-elevated border border-studio-border rounded px-2 py-1 text-gray-200 focus:outline-none"
              >
                <option value="all">Toutes les sources</option>
                <option value="custom">Base de données (Manuel)</option>
                <option value="wildcard">Index (Wildcards)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span>Sélection :</span>
              <select
                value={selectionFilter}
                onChange={(e) => setSelectionFilter(e.target.value as typeof selectionFilter)}
                className="bg-studio-elevated border border-studio-border rounded px-2 py-1 text-gray-200 focus:outline-none"
              >
                <option value="all">Tous</option>
                <option value="unselected">Non sélectionnés</option>
                <option value="selected">Sélectionnés</option>
              </select>
            </div>

            <div className="ml-auto font-mono text-[10px] text-gray-500">
              {processedTags.length} tags affichés
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center pt-12">
            <Spinner />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-wrap gap-2.5 content-start pb-6">
              {processedTags.map((tag) => {
                const cat = categories.find((c) => c.id === tag.category_id)
                const readOnly = tag.id < 0 || tag.source === 'wildcard_index'
                const isSelected = selectedTags.some((t) => t.id === tag.id)

                const catName = cat?.name?.toLowerCase() || 'default'
                const catColorClass = `tag-${catName}`

                return (
                  <TagTooltip key={tag.id} tag={tag} category={cat}>
                    <div
                      onClick={() => toggleTag(tag)}
                      className={`tag-danbooru group flex items-center gap-2 px-3.5 py-1.5 rounded-full border bg-studio-elevated/40 hover:bg-studio-elevated cursor-pointer select-none transition-all duration-150 ${catColorClass} ${
                        isSelected ? 'selected' : ''
                      }`}
                    >
                      {isSelected ? (
                        <Check size={12} className="stroke-[3]" />
                      ) : (
                        cat?.icon && <span className="text-xs">{cat.icon}</span>
                      )}
                      <span className="text-xs font-mono font-medium">{tag.name}</span>
                      {tag.usage_count > 0 && (
                        <span className="text-[10px] opacity-50 font-mono">
                          {tag.usage_count}
                        </span>
                      )}
                      {!readOnly && !isSelected && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteTag.mutate(tag.id)
                          }}
                          className="text-gray-600 hover:text-studio-danger opacity-0 group-hover:opacity-100 transition-all ml-1"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </TagTooltip>
                )
              })}
              {processedTags.length === 0 && (
                <p className="text-sm text-gray-600 mt-4">
                  {search ? 'Aucun tag correspondant' : 'Aucun tag dans cette catégorie'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right Prompt Builder Sidebar */}
      <div className="w-72 border-l border-studio-border bg-studio-surface flex flex-col shrink-0">
        <div className="p-3.5 border-b border-studio-border flex items-center justify-between bg-studio-surface/80">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-studio-accent" />
            <span className="text-xs text-gray-300 font-bold uppercase tracking-wider">
              Prompt Builder
            </span>
          </div>
          {selectedTags.length > 0 && (
            <span className="text-[10px] bg-studio-accent/20 text-studio-accent-glow px-2 py-0.5 rounded-full font-mono font-semibold">
              {selectedTags.length}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-2">
          {selectedTags.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 p-4">
              <Tag size={28} className="mb-2 opacity-25" />
              <p className="text-xs">Sélectionnez des tags dans la grille pour composer votre prompt</p>
            </div>
          ) : (
            selectedTags.map((tag, idx) => {
              const cat = categories.find((c) => c.id === tag.category_id)
              return (
                <div
                  key={`selected-${tag.id}`}
                  className="flex items-center gap-2 p-2 bg-studio-elevated/40 border border-studio-border rounded-lg group text-xs transition-colors hover:border-studio-muted"
                >
                  <span className="font-mono text-[10px] text-gray-600 w-4 shrink-0">
                    #{idx + 1}
                  </span>
                  {cat?.icon && <span className="text-[11px] shrink-0">{cat.icon}</span>}
                  <span className="flex-1 font-mono text-gray-300 truncate" title={tag.name}>
                    {tag.name}
                  </span>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => reorderTags(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 hover:text-white text-gray-500 disabled:opacity-30 disabled:hover:text-gray-500"
                    >
                      <ArrowUp size={11} />
                    </button>
                    <button
                      onClick={() => reorderTags(idx, 'down')}
                      disabled={idx === selectedTags.length - 1}
                      className="p-1 hover:text-white text-gray-500 disabled:opacity-30 disabled:hover:text-gray-500"
                    >
                      <ArrowDown size={11} />
                    </button>
                    <button
                      onClick={() => removeTag(tag.id)}
                      className="p-1 hover:text-studio-danger text-gray-500"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {selectedTags.length > 0 && (
          <div className="p-3 border-t border-studio-border bg-studio-surface/80 flex flex-col gap-2 shrink-0">
            <button onClick={handleCopyPrompt} className="btn-ghost w-full justify-center text-xs">
              <Copy size={12} /> Copier le prompt
            </button>
            <button
              onClick={handleSendToGenerator}
              className="btn-primary w-full justify-center text-xs font-semibold"
            >
              Envoyer au générateur
            </button>
            <button
              onClick={clearSelection}
              className="text-center text-[10px] text-gray-600 hover:text-gray-400 mt-1 transition-colors"
            >
              Vider la sélection
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
