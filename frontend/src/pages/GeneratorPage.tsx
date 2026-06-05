import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus, Trash2, Wand2, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { generatorApi } from '@/api/generator'
import Spinner from '@/components/shared/Spinner'
import { useTagStore } from '@/store/tagStore'

export default function GeneratorPage() {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [format, setFormat] = useState<'impact' | 'dynamic_prompts'>('impact')
  const [style, setStyle] = useState<'tag' | 'nl'>('tag')
  const [entries, setEntries] = useState<string[]>([''])

  const pendingPromptForGenerator = useTagStore((s) => s.pendingPromptForGenerator)
  const clearPendingPrompt = useTagStore((s) => s.clearPendingPrompt)

  useEffect(() => {
    if (pendingPromptForGenerator) {
      setEntries((prev) => {
        if (prev.length === 1 && prev[0] === '') {
          return [pendingPromptForGenerator]
        }
        // Remove trailing empty entries
        const cleaned = [...prev]
        while (cleaned.length > 0 && cleaned[cleaned.length - 1] === '') {
          cleaned.pop()
        }
        return [...cleaned, pendingPromptForGenerator]
      })
      toast.success('Prompt importé depuis le gestionnaire de tags !')
      clearPendingPrompt()
    }
  }, [pendingPromptForGenerator, clearPendingPrompt])

  const previewMutation = useMutation({
    mutationFn: () => generatorApi.preview({ name, format, style, entries: entries.filter(Boolean) }),
  })

  const createMutation = useMutation({
    mutationFn: () => generatorApi.create({ name, format, style, entries: entries.filter(Boolean), target_folder: folder }),
    onSuccess: (d) => toast.success(`Créé : ${d.path} (${d.entry_count} entrées)`),
    onError: (e: Error) => toast.error(e.message),
  })

  const addEntry = () => setEntries((e) => [...e, ''])
  const setEntry = (i: number, v: string) => setEntries((e) => e.map((x, j) => j === i ? v : x))
  const removeEntry = (i: number) => setEntries((e) => e.filter((_, j) => j !== i))

  return (
    <div className="flex gap-5 h-full p-5">
      {/* Form */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Nom du wildcard *</label>
            <input className="input" placeholder="lighting_styles" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Dossier cible</label>
            <input className="input" placeholder="comfyui/" value={folder} onChange={(e) => setFolder(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Format</label>
            <div className="flex rounded-md border border-studio-border overflow-hidden">
              {([['impact', 'Impact (ComfyUI)'], ['dynamic_prompts', 'Dynamic Prompts']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setFormat(v)}
                  className={`px-3 py-1.5 text-xs transition-colors ${format === v ? 'bg-studio-accent/20 text-studio-accent-glow' : 'text-gray-500 hover:text-white'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Style des entrées</label>
            <div className="flex rounded-md border border-studio-border overflow-hidden">
              {([['tag', 'TAG / Booru'], ['nl', 'Natural Language']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setStyle(v)}
                  className={`px-3 py-1.5 text-xs transition-colors ${style === v ? 'bg-studio-accent/20 text-studio-accent-glow' : 'text-gray-500 hover:text-white'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Entries */}
        <div className="flex-1 overflow-y-auto space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-500">Entrées ({entries.filter(Boolean).length})</label>
            <button className="btn-ghost text-xs" onClick={addEntry}><Plus size={12} /> Ajouter</button>
          </div>
          {entries.map((entry, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                className="input flex-1 font-mono text-xs"
                placeholder={style === 'tag' ? 'dramatic side lighting, shadows' : 'A warm golden sunset glow…'}
                value={entry}
                onChange={(e) => setEntry(i, e.target.value)}
              />
              <button className="text-gray-600 hover:text-studio-danger transition-colors" onClick={() => removeEntry(i)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3 shrink-0">
          <button
            className="btn-ghost"
            onClick={() => previewMutation.mutate()}
            disabled={!name.trim() || entries.filter(Boolean).length === 0 || previewMutation.isPending}
          >
            {previewMutation.isPending ? <Spinner size={12} /> : <Wand2 size={12} />}
            Aperçu
          </button>
          <button
            className="btn-primary flex-1 justify-center"
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || entries.filter(Boolean).length === 0 || createMutation.isPending}
          >
            {createMutation.isPending ? <Spinner size={14} /> : <Download size={14} />}
            Créer le fichier
          </button>
        </div>
      </div>

      {/* Preview */}
      <div className="w-96 card flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-studio-border">
          <span className="text-xs text-gray-500 font-mono uppercase tracking-wider">Aperçu fichier</span>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {previewMutation.data ? (
            <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap leading-relaxed">
              {previewMutation.data.preview}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm">
              <Wand2 size={24} className="mb-2 opacity-30" />
              Cliquez sur Aperçu pour voir le fichier généré
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
