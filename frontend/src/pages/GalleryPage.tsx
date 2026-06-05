import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Image as ImageIcon, Calendar, Sparkles, Copy, 
  ExternalLink, Search, RefreshCw, Layers, Sliders, X, Terminal, ArrowUpRight
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import Spinner from '@/components/shared/Spinner'
import { useEditorStore } from '@/store/editorStore'

const imageToSrc = (imgUrl: string) => {
  if (!imgUrl) return ''
  if (/^(https?:|data:|blob:)/i.test(imgUrl)) return imgUrl
  if (imgUrl.startsWith('/api/')) return imgUrl
  if (imgUrl.startsWith('/')) return `/api${imgUrl}`
  return `/api/${imgUrl}`
}

export default function GalleryPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItem, setSelectedItem] = useState<any | null>(null)

  // Fetch generation history
  const { data: historyData, isLoading, refetch } = useQuery({
    queryKey: ['generationHistory'],
    queryFn: async () => {
      const response = await api.get('/generation/history?limit=100')
      return response.data
    }
  })

  // Filter history items by search query
  const filteredItems = (historyData?.items ?? []).filter((item: any) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      (item.prompt ?? '').toLowerCase().includes(query) ||
      (item.negative_prompt ?? '').toLowerCase().includes(query) ||
      (item.model ?? '').toLowerCase().includes(query) ||
      (item.provider ?? '').toLowerCase().includes(query)
    )
  })

  const copyToClipboard = (text: string, message = 'Copié !') => {
    if (!text) return
    navigator.clipboard.writeText(text)
    toast.success(message)
  }

  const handleSendToEditor = (prompt: string) => {
    useEditorStore.getState().requestInsertText(prompt)
    toast.success('Prompt envoyé à l\'éditeur !')
    navigate('/editor')
  }

  return (
    <div className="gallery-page flex flex-col h-full p-5 gap-4 bg-studio-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap shrink-0">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-500 font-mono uppercase tracking-wider">
            <ImageIcon size={14} />
            F12 - Historique & Galerie
          </div>
          <h2 className="font-display text-xl font-semibold text-white mt-1">Galerie des générations</h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input pl-9 text-xs"
              placeholder="Rechercher par prompt, modèle..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            className="btn-ghost p-2 rounded-md border border-studio-border text-gray-400 hover:text-white"
            onClick={() => { refetch(); toast.success('Galerie actualisée') }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Grid container */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Spinner size={32} />
            <p className="text-sm text-gray-500">Chargement des générations...</p>
          </div>
        ) : filteredItems.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredItems.map((item: any, i: number) => {
              const firstImg = item.images?.[0]
              const src = firstImg ? imageToSrc(firstImg.history_image_url) : null
              return (
                <div 
                  key={item.id ?? i}
                  className="group rounded-xl border border-studio-border bg-studio-surface overflow-hidden hover:border-studio-accent/40 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between"
                  onClick={() => setSelectedItem(item)}
                >
                  {/* Image wrapper */}
                  <div className="aspect-square bg-studio-bg relative flex items-center justify-center overflow-hidden border-b border-studio-border shrink-0">
                    {src ? (
                      <img 
                        src={src} 
                        alt={item.prompt} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" 
                      />
                    ) : (
                      <ImageIcon className="text-gray-700" size={32} />
                    )}
                    {item.provider && (
                      <span className="absolute top-2 left-2 badge bg-studio-bg/80 backdrop-blur-sm border border-studio-border/50 text-[10px] text-studio-accent-glow font-mono uppercase">
                        {item.provider}
                      </span>
                    )}
                    <span className="absolute bottom-2 right-2 badge bg-studio-bg/80 backdrop-blur-sm border border-studio-border/50 text-[9px] text-gray-400 font-mono">
                      {item.width}x{item.height}
                    </span>
                  </div>

                  {/* Metadata preview */}
                  <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                    <p className="text-xs text-gray-300 line-clamp-2 leading-relaxed" title={item.prompt}>
                      {item.prompt}
                    </p>
                    <div className="flex items-center justify-between gap-2 mt-1 shrink-0">
                      <div className="flex items-center gap-1 text-[10px] text-gray-500 font-mono">
                        <Calendar size={10} />
                        {item.created_at ? new Date(item.created_at).toLocaleDateString('fr') : 'Récemment'}
                      </div>
                      <span className="text-[10px] text-studio-accent-glow font-mono bg-studio-accent/10 px-1.5 py-0.5 rounded border border-studio-accent/20">
                        {item.steps} steps
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600">
            <ImageIcon size={48} className="opacity-25 mb-3" />
            <p className="text-sm font-medium text-gray-400">Aucun résultat trouvé</p>
            <p className="text-xs text-gray-600 mt-1">Générez des images ou ajustez votre recherche.</p>
          </div>
        )}
      </div>

      {/* Details Modal Popup */}
      {selectedItem && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in"
          onClick={() => setSelectedItem(null)}
        >
          <div 
            className="w-full max-w-5xl h-[85vh] rounded-2xl border border-studio-border bg-studio-surface overflow-hidden flex flex-col md:flex-row shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Left Side: Image Preview */}
            <div className="flex-1 bg-studio-bg flex flex-col relative min-h-0 border-b md:border-b-0 md:border-r border-studio-border">
              <button 
                className="absolute top-4 left-4 p-2 rounded-full bg-studio-surface/80 border border-studio-border/80 text-gray-400 hover:text-white hover:bg-studio-elevated z-10 transition-colors"
                onClick={() => setSelectedItem(null)}
              >
                <X size={16} />
              </button>

              <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">
                {selectedItem.images?.[0] ? (
                  <img 
                    src={imageToSrc(selectedItem.images[0].history_image_url)} 
                    alt={selectedItem.prompt} 
                    className="max-w-full max-h-full object-contain rounded-lg shadow-lg hover:scale-[1.01] transition-transform cursor-pointer"
                    onClick={() => window.open(imageToSrc(selectedItem.images[0].history_image_url), '_blank')}
                    title="Clic droit ou clic gauche pour ouvrir l'image dans un nouvel onglet"
                  />
                ) : (
                  <ImageIcon size={64} className="text-gray-700" />
                )}
              </div>

              {/* Quick actions bar */}
              <div className="p-3 bg-studio-surface/40 border-t border-studio-border flex items-center justify-between gap-4">
                <span className="text-[10px] text-gray-500 font-mono">
                  ID: #{selectedItem.id || 'N/A'} • {selectedItem.provider}
                </span>
                {selectedItem.images?.[0] && (
                  <a 
                    href={imageToSrc(selectedItem.images[0].history_image_url)} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="btn-ghost text-xs flex items-center gap-1.5 py-1 px-2.5 rounded border border-studio-border hover:text-white"
                  >
                    <ExternalLink size={12} />
                    Ouvrir en plein écran
                  </a>
                )}
              </div>
            </div>

            {/* Modal Right Side: Generation parameters */}
            <div className="w-full md:w-[420px] bg-studio-surface flex flex-col min-h-0">
              {/* Tabs / Title */}
              <div className="p-4 border-b border-studio-border shrink-0 flex items-center justify-between">
                <h3 className="font-display font-semibold text-white text-sm">Paramètres de génération</h3>
                <span className={`badge ${selectedItem.status === 'completed' ? 'bg-studio-success/10 text-studio-success border border-studio-success/20' : 'bg-studio-danger/10 text-studio-danger border border-studio-danger/20'}`}>
                  {selectedItem.status}
                </span>
              </div>

              {/* Scrollable parameters block */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Positive Prompt */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] text-gray-500 font-mono uppercase tracking-wider">Positive Prompt</span>
                    <button 
                      className="text-studio-accent-glow hover:underline flex items-center gap-1 text-[10px]"
                      onClick={() => copyToClipboard(selectedItem.prompt, 'Prompt copié !')}
                    >
                      <Copy size={10} /> Copier
                    </button>
                  </div>
                  <div className="p-3 rounded-lg bg-studio-bg border border-studio-border font-mono text-xs text-gray-300 select-all whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
                    {selectedItem.prompt || 'Aucun prompt'}
                  </div>
                </div>

                {/* Negative Prompt */}
                {selectedItem.negative_prompt && (
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[11px] text-gray-500 font-mono uppercase tracking-wider">Negative Prompt</span>
                      <button 
                        className="text-studio-accent-glow hover:underline flex items-center gap-1 text-[10px]"
                        onClick={() => copyToClipboard(selectedItem.negative_prompt, 'Negative prompt copié !')}
                      >
                        <Copy size={10} /> Copier
                      </button>
                    </div>
                    <div className="p-3 rounded-lg bg-studio-bg border border-studio-border font-mono text-xs text-gray-400 select-all whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto">
                      {selectedItem.negative_prompt}
                    </div>
                  </div>
                )}

                {/* Settings Details Grid */}
                <div className="border-t border-studio-border/60 pt-3 space-y-3">
                  <span className="text-[11px] text-gray-500 font-mono uppercase tracking-wider block">Configuration</span>

                  <div className="grid grid-cols-2 gap-3">
                    <MetaItem label="Modèle" value={selectedItem.model} copyable onCopy={(v) => copyToClipboard(v, 'Modèle copié !')} />
                    <MetaItem label="Sampler" value={selectedItem.sampler} />
                    <MetaItem label="Scheduler" value={selectedItem.scheduler} />
                    <MetaItem label="Resolution" value={`${selectedItem.width} x ${selectedItem.height}`} />
                    <MetaItem label="Steps" value={selectedItem.steps} />
                    <MetaItem label="CFG Scale" value={selectedItem.cfg_scale} />
                    <MetaItem label="Seed" value={selectedItem.seed} copyable onCopy={(v) => copyToClipboard(String(v), 'Seed copié !')} />
                    <MetaItem label="Provider" value={selectedItem.provider} />
                  </div>
                </div>

                {/* Loras json list */}
                {selectedItem.loras && selectedItem.loras.length > 0 && (
                  <div className="border-t border-studio-border/60 pt-3">
                    <span className="text-[11px] text-gray-500 font-mono uppercase tracking-wider block mb-2">LoRA Actifs</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedItem.loras.map((lora: any, index: number) => (
                        <span key={index} className="inline-flex items-center gap-2 px-2 py-1 rounded bg-studio-bg border border-studio-border text-[11px] font-mono">
                          <span className="text-gray-300">{lora.name}</span>
                          <span className="text-studio-accent-glow font-bold">{lora.weight}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error log if failed */}
                {selectedItem.error && (
                  <div className="border border-studio-danger/30 bg-studio-danger/5 rounded-lg p-3 text-xs text-studio-danger leading-relaxed">
                    <span className="font-semibold block mb-1">Rapport d'erreur :</span>
                    {selectedItem.error}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="p-4 border-t border-studio-border bg-studio-surface shrink-0 space-y-2">
                <button 
                  className="btn-primary w-full justify-center text-xs py-2.5"
                  onClick={() => handleSendToEditor(selectedItem.prompt)}
                >
                  <ArrowUpRight size={14} className="mr-1.5" />
                  Envoyer à l'éditeur & Ouvrir
                </button>
                <button 
                  className="btn-ghost w-full justify-center text-xs py-2 rounded border border-studio-border hover:bg-studio-elevated hover:text-white transition-colors"
                  onClick={() => {
                    const paramsText = `Model: ${selectedItem.model || ''}\nSampler: ${selectedItem.sampler || ''}\nScheduler: ${selectedItem.scheduler || ''}\nSteps: ${selectedItem.steps}\nCFG: ${selectedItem.cfg_scale}\nSeed: ${selectedItem.seed}\nSize: ${selectedItem.width}x${selectedItem.height}\nPrompt: ${selectedItem.prompt}\nNegative Prompt: ${selectedItem.negative_prompt || ''}`
                    copyToClipboard(paramsText, 'Tous les paramètres ont été copiés !')
                  }}
                >
                  Copier tous les paramètres
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetaItem({ 
  label, 
  value, 
  copyable = false, 
  onCopy 
}: { 
  label: string
  value: any
  copyable?: boolean
  onCopy?: (val: string) => void
}) {
  const displayValue = value === null || value === undefined || value === '' ? '—' : String(value)
  return (
    <div className="rounded-lg border border-studio-border bg-studio-bg p-2 flex flex-col justify-between gap-1">
      <span className="text-[10px] text-gray-600 font-medium">{label}</span>
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <span className="text-xs text-gray-300 font-mono truncate" title={displayValue}>{displayValue}</span>
        {copyable && value && (
          <button 
            onClick={() => onCopy?.(displayValue)}
            className="text-gray-600 hover:text-white hover:bg-studio-surface p-1 rounded shrink-0 transition-colors"
            title="Copier"
          >
            <Copy size={11} />
          </button>
        )}
      </div>
    </div>
  )
}
