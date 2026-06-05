import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Wand2, Download, Copy, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import { generatorApi } from '@/api/generator'
import Spinner from '@/components/shared/Spinner'
import { useTagStore } from '@/store/tagStore'
import PromptEditor from '@/components/shared/PromptEditor'
import { explorerApi } from '@/api/explorer'

export default function GeneratorPage() {
  const [activeTab, setActiveTab] = useState<'create' | 'test'>('create')
  const qc = useQueryClient()
  
  // Existing Generator State
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [format, setFormat] = useState<'impact' | 'dynamic_prompts'>('impact')
  const [style, setStyle] = useState<'tag' | 'nl'>('tag')
  const [entries, setEntries] = useState<string[]>([''])

  // Tester State
  const [testPrompt, setTestPrompt] = useState('')
  const [testCount, setTestCount] = useState<number | ''>(3)
  
  const pendingPromptForGenerator = useTagStore((s) => s.pendingPromptForGenerator)
  const clearPendingPrompt = useTagStore((s) => s.clearPendingPrompt)

  useEffect(() => {
    if (pendingPromptForGenerator) {
      setEntries((prev) => {
        if (prev.length === 1 && prev[0] === '') {
          return [pendingPromptForGenerator]
        }
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

  const { data: tree } = useQuery({
    queryKey: ['explorer-tree'],
    queryFn: explorerApi.getTree,
  })

  const wildcardFilesList = useMemo(() => {
    if (!tree) return []
    const list: string[] = []
    const traverse = (node: any) => {
      if (node.type === 'file') {
        const cleanPath = node.path.replace(/\.(yaml|yml|txt)$/i, '').toLowerCase()
        list.push(cleanPath)
        const nameNoExt = node.name.replace(/\.(yaml|yml|txt)$/i, '').toLowerCase()
        if (!list.includes(nameNoExt)) {
          list.push(nameNoExt)
        }
      }
      if (node.children) {
        node.children.forEach(traverse)
      }
    }
    traverse(tree)
    return list
  }, [tree])

  const previewMutation = useMutation({
    mutationFn: () => generatorApi.preview({ name, format, style, entries: entries.filter((e) => e.trim()) }),
  })

  const createMutation = useMutation({
    mutationFn: () => generatorApi.create({ name, format, style, entries: entries.filter((e) => e.trim()), target_folder: folder }),
    onSuccess: (d) => {
      toast.success(`Créé : ${d.path} (${d.entry_count} entrées)`)
      qc.invalidateQueries({ queryKey: ['explorer-tree'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const testMutation = useMutation({
    mutationFn: () => {
      const count = Math.max(1, Math.min(10, Number(testCount) || 1))
      return generatorApi.processPrompt(testPrompt, count)
    },
    onSuccess: () => toast.success('Prompt traité avec succès !'),
    onError: (e: Error) => toast.error(e.message),
  })

  const addEntry = () => setEntries((e) => [...e, ''])
  const setEntry = (i: number, v: string) => setEntries((e) => e.map((x, j) => j === i ? v : x))
  const removeEntry = (i: number) => setEntries((e) => e.filter((_, j) => j !== i))

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Texte copié !')
  }

  // Detect wildcards in test prompt
  const uniqueWildcards = useMemo(() => {
    const detectedWildcards = Array.from(testPrompt.matchAll(/__([A-Za-z0-9_./\\-]+)__/g)).map(m => m[1])
    return Array.from(new Set(detectedWildcards))
  }, [testPrompt])

  const wildcardFilesSet = useMemo(() => new Set(wildcardFilesList), [wildcardFilesList])

  return (
    <div className="flex flex-col h-full p-5 gap-4">
      {/* Segmented control tabs */}
      <div className="flex border-b border-studio-border pb-2 shrink-0">
        <button
          onClick={() => setActiveTab('create')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'create'
              ? 'border-studio-accent text-studio-accent-glow'
              : 'border-transparent text-gray-500 hover:text-white'
          }`}
        >
          Créateur de Wildcard
        </button>
        <button
          onClick={() => setActiveTab('test')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'test'
              ? 'border-studio-accent text-studio-accent-glow'
              : 'border-transparent text-gray-500 hover:text-white'
          }`}
        >
          Testeur de Wildcards
        </button>
      </div>

      {activeTab === 'create' ? (
        <div className="flex-1 flex gap-5 min-h-0">
          {/* Form */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">Nom du wildcard *</label>
                <input className="input" placeholder="lighting_styles" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">Dossier cible</label>
                <input className="input" placeholder="comfyui/" value={folder} onChange={(e) => setFolder(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">Format</label>
                <div className="flex rounded-md border border-studio-border overflow-hidden bg-studio-surface">
                  {([['impact', 'Impact (ComfyUI)'], ['dynamic_prompts', 'Dynamic Prompts']] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setFormat(v)}
                      className={`px-3 py-1.5 text-xs transition-colors ${format === v ? 'bg-studio-accent/20 text-studio-accent-glow font-bold' : 'text-gray-500 hover:text-white'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">Style des entrées</label>
                <div className="flex rounded-md border border-studio-border overflow-hidden bg-studio-surface">
                  {([['tag', 'TAG / Booru'], ['nl', 'Natural Language']] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setStyle(v)}
                      className={`px-3 py-1.5 text-xs transition-colors ${style === v ? 'bg-studio-accent/20 text-studio-accent-glow font-bold' : 'text-gray-500 hover:text-white'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Entries */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-500 font-semibold">Entrées ({entries.filter((e) => e.trim()).length})</label>
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
                disabled={!name.trim() || entries.filter((e) => e.trim()).length === 0 || previewMutation.isPending}
              >
                {previewMutation.isPending ? <Spinner size={12} /> : <Wand2 size={12} />}
                Aperçu
              </button>
              <button
                className="btn-primary flex-1 justify-center"
                onClick={() => createMutation.mutate()}
                disabled={!name.trim() || entries.filter((e) => e.trim()).length === 0 || createMutation.isPending}
              >
                {createMutation.isPending ? <Spinner size={14} /> : <Download size={14} />}
                Créer le fichier
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="w-96 card flex flex-col shrink-0">
            <div className="px-4 py-3 border-b border-studio-border bg-studio-surface/60">
              <span className="text-xs text-gray-500 font-mono uppercase tracking-wider font-semibold">Aperçu fichier</span>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-studio-bg">
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
      ) : (
        /* TESTER TAB */
        <div className="flex-1 flex gap-5 min-h-0">
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-semibold">Modèle de prompt à tester</label>
              <PromptEditor
                value={testPrompt}
                onChange={setTestPrompt}
                placeholder="A __subject__ wearing a {red|blue} shirt, __lighting_style__"
                rows={5}
                className="card border border-studio-border"
              />
            </div>

            <div className="flex gap-4 items-end">
              <div className="w-32">
                <label className="text-xs text-gray-500 mb-1 block font-semibold">Variations</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={10}
                  value={testCount}
                  onChange={(e) => {
                    const val = e.target.value
                    setTestCount(val === '' ? '' : Number(val))
                  }}
                  onBlur={() => {
                    const count = Math.max(1, Math.min(10, Number(testCount) || 3))
                    setTestCount(count)
                  }}
                />
              </div>
              <button
                className="btn-primary flex-1 justify-center h-10"
                onClick={() => testMutation.mutate()}
                disabled={!testPrompt.trim() || testMutation.isPending}
              >
                {testMutation.isPending ? <Spinner size={14} /> : <Play size={14} />}
                Générer les variations
              </button>
            </div>

            {/* Analysis card for detected wildcards */}
            {uniqueWildcards.length > 0 && (
              <div className="card p-3 space-y-2">
                <p className="text-xs text-gray-500 font-semibold font-mono uppercase tracking-wide">Wildcards détectés</p>
                <div className="flex flex-wrap gap-2">
                  {uniqueWildcards.map((wc) => {
                    const exists = wildcardFilesSet.has(wc.toLowerCase())
                    return (
                      <span key={wc} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border ${
                        exists ? 'bg-studio-success/10 border-studio-success/30 text-studio-success' : 'bg-studio-danger/10 border-studio-danger/30 text-studio-danger'
                      }`}>
                        <span>{exists ? '🟢' : '🔴'}</span>
                        <span className="font-mono">{wc}</span>
                        <span className="text-[10px] opacity-75">({exists ? 'Indexé' : 'Inconnu'})</span>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Results Panel */}
          <div className="w-96 card flex flex-col shrink-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-studio-border bg-studio-surface/60 flex items-center justify-between">
              <span className="text-xs text-gray-500 font-mono uppercase tracking-wider font-semibold">Résultats ({testMutation.data?.processed.length || 0})</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-studio-bg">
              {testMutation.data ? (
                testMutation.data.processed.map((p, idx) => (
                  <div key={idx} className="p-3 bg-studio-elevated/40 border border-studio-border rounded-lg flex flex-col gap-2 group hover:border-studio-muted transition-colors">
                    <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono">
                      <span>Variation #{idx + 1}</span>
                      <button className="text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleCopy(p)}>
                        <Copy size={11} />
                      </button>
                    </div>
                    <p className="text-xs font-mono text-gray-300 break-words leading-relaxed select-all">
                      {p}
                    </p>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm">
                  <Play size={24} className="mb-2 opacity-30" />
                  Générez pour voir les prompts résolus
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
