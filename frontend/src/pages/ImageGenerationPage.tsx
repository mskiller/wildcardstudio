import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  AlertCircle,
  CheckCircle2,
  History,
  Image as ImageIcon,
  PlugZap,
  Plus,
  RefreshCcw,
  Settings2,
  Trash2,
  Wand2,
  Copy,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Spinner from '@/components/shared/Spinner'
import PromptEditor from '@/components/shared/PromptEditor'
import { generatorApi } from '@/api/generator'
import {
  generationApi,
  type CapabilityOption,
  type GeneratedImage,
  type GenerationCapabilities,
  type GenerationHistoryItem,
  type GenerationProvider,
  type GenerationSettings,
  type Txt2ImgResponse,
} from '@/api/generation'

const STORAGE_KEY = 'wildcardstudio.imageGeneration.v1'

const DEFAULT_BASE_URL: Record<GenerationProvider, string> = {
  comfyui: 'http://127.0.0.1:8188',
  sdforge: 'http://127.0.0.1:7860',
}

const DEFAULT_SETTINGS: GenerationSettings = {
  model: '',
  sampler: '',
  scheduler: '',
  steps: 30,
  cfg: 7,
  seed: null,
  width: 1024,
  height: 1024,
  batch_size: 1,
  batch_count: 1,
  loras: [],
}

const SDXL_PRESETS = [
  { id: 'square', label: 'SDXL 1:1', width: 1024, height: 1024 },
  { id: 'portrait', label: 'Portrait', width: 832, height: 1216 },
  { id: 'landscape', label: 'Landscape', width: 1216, height: 832 },
  { id: 'wide', label: 'Wide', width: 1344, height: 768 },
  { id: 'tall', label: 'Tall', width: 768, height: 1344 },
  { id: 'custom', label: 'Custom', width: 1024, height: 1024 },
] as const

type ResolutionPresetId = (typeof SDXL_PRESETS)[number]['id']

type PersistedGenerationState = {
  provider?: GenerationProvider
  baseUrl?: string
  prompt?: string
  negativePrompt?: string
  resolutionPreset?: ResolutionPresetId
  settings?: Partial<GenerationSettings>
}

type LocalRun = {
  id: string
  createdAt: string
  provider: GenerationProvider
  prompt: string
  settings: GenerationSettings
  result: Txt2ImgResponse
}

function readPersistedState(): PersistedGenerationState {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function optionValue(option: CapabilityOption): string {
  if (typeof option === 'string') return option
  return String(option.name ?? option.value ?? option.filename ?? option.label ?? option.title ?? '')
}

function optionLabel(option: CapabilityOption): string {
  if (typeof option === 'string') return option
  return String(option.label ?? option.title ?? option.name ?? option.value ?? option.filename ?? '')
}

function firstOption(options?: CapabilityOption[]): string {
  return (options ?? []).map(optionValue).find(Boolean) ?? ''
}

function imageToSrc(image: GeneratedImage): string | null {
  const raw =
    typeof image === 'string'
      ? image
    : image.url ?? image.src ?? image.data ?? image.base64 ?? image.image ?? image.history_image_url

  if (!raw || typeof raw !== 'string') return null
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw
  if (raw.startsWith('/api/')) return raw
  if (raw.startsWith('/')) return `/api${raw}`

  const mime = typeof image === 'object' && image.mime_type ? image.mime_type : 'image/png'
  return `data:${mime};base64,${raw}`
}

function imageCaption(image: GeneratedImage, index: number): string {
  if (typeof image === 'string') return `Image ${index + 1}`
  const seed = image.seed ? `seed ${image.seed}` : undefined
  const size = image.width && image.height ? `${image.width}x${image.height}` : undefined
  return [image.filename, seed, size].filter(Boolean).join(' - ') || `Image ${index + 1}`
}

function mergeSettings(settings?: Partial<GenerationSettings>): GenerationSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    loras: settings?.loras ?? DEFAULT_SETTINGS.loras,
  }
}

export default function ImageGenerationPage() {
  const persisted = useMemo(readPersistedState, [])
  const initialProvider: GenerationProvider = persisted.provider === 'sdforge' ? 'sdforge' : 'comfyui'
  const [provider, setProvider] = useState<GenerationProvider>(initialProvider)
  const [baseUrl, setBaseUrl] = useState(persisted.baseUrl ?? DEFAULT_BASE_URL[initialProvider])
  const [prompt, setPrompt] = useState(persisted.prompt ?? '')
  const [negativePrompt, setNegativePrompt] = useState(persisted.negativePrompt ?? '')
  const [resolutionPreset, setResolutionPreset] = useState<ResolutionPresetId>(persisted.resolutionPreset ?? 'square')
  const [settings, setSettings] = useState<GenerationSettings>(() => mergeSettings(persisted.settings))
  const [capabilities, setCapabilities] = useState<GenerationCapabilities | null>(null)
  const [selectedLora, setSelectedLora] = useState('')
  const [loraWeight, setLoraWeight] = useState(1)
  const [runs, setRuns] = useState<LocalRun[]>([])

  const [processedPreview, setProcessedPreview] = useState('')
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  
  // Debounce API call for processed prompt preview
  useEffect(() => {
    if (!prompt.trim()) {
      setProcessedPreview('')
      return
    }
    
    setPreviewLoading(true)
    const timer = setTimeout(() => {
      generatorApi.processPrompt(prompt, 1)
        .then((res) => {
          if (res.processed.length > 0) {
            setProcessedPreview(res.processed[0])
          }
        })
        .catch(() => {})
        .finally(() => setPreviewLoading(false))
    }, 300)
    
    return () => clearTimeout(timer)
  }, [prompt])

  const handleRegeneratePreview = () => {
    if (!prompt.trim()) return
    setPreviewLoading(true)
    generatorApi.processPrompt(prompt, 1)
      .then((res) => {
        if (res.processed.length > 0) {
          setProcessedPreview(res.processed[0])
        }
      })
      .catch(() => {})
      .finally(() => setPreviewLoading(false))
  }

  const handleApplyPreview = () => {
    if (processedPreview) {
      setPrompt(processedPreview)
      toast.success('Prompt appliqué !')
    }
  }

  const models = capabilities?.models ?? []
  const samplers = capabilities?.samplers ?? []
  const schedulers = capabilities?.schedulers ?? []
  const loras = capabilities?.loras ?? []
  const connectorReady = Boolean(
    capabilities?.reachable && models.length > 0 && samplers.length > 0 && (provider === 'sdforge' || schedulers.length > 0),
  )
  const supportsBatchSize = capabilities?.supports_batch_size ?? true
  const supportsBatchCount = capabilities?.supports_batch_count ?? true

  useEffect(() => {
    const payload: PersistedGenerationState = {
      provider,
      baseUrl,
      prompt,
      negativePrompt,
      resolutionPreset,
      settings,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [provider, baseUrl, prompt, negativePrompt, resolutionPreset, settings])

  const updateSetting = <K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const applyCapabilities = (data: GenerationCapabilities) => {
    setCapabilities(data)
    setSettings((current) => ({
      ...current,
      model: current.model || data.defaults?.model || firstOption(data.models),
      sampler: current.sampler || data.defaults?.sampler || firstOption(data.samplers),
      scheduler: current.scheduler || data.defaults?.scheduler || firstOption(data.schedulers),
      steps: data.defaults?.steps ?? current.steps,
      cfg: data.defaults?.cfg ?? data.defaults?.cfg_scale ?? current.cfg,
      width: data.defaults?.width ?? current.width,
      height: data.defaults?.height ?? current.height,
      batch_size: data.defaults?.batch_size ?? current.batch_size,
      batch_count: data.defaults?.batch_count ?? current.batch_count,
    }))
  }

  const discoverMutation = useMutation({
    mutationFn: () => generationApi.capabilities({ provider, base_url: baseUrl.trim() }),
    onSuccess: (data) => {
      applyCapabilities(data)
      if (data.reachable === false) {
        toast.error(data.errors?.[0] ?? 'Connecteur inaccessible')
      } else if (!data.models?.length || !data.samplers?.length || (provider === 'comfyui' && !data.schedulers?.length)) {
        toast.error(data.errors?.[0] ?? 'Connecteur detecte, mais options introuvables')
      } else {
        toast.success('Connecteur detecte')
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const generateMutation = useMutation({
    mutationFn: () =>
      generationApi.txt2img({
        provider,
        base_url: baseUrl.trim(),
        prompt,
        negative_prompt: negativePrompt,
        model: settings.model,
        sampler: settings.sampler,
        scheduler: settings.scheduler,
        steps: settings.steps,
        cfg: settings.cfg,
        cfg_scale: settings.cfg,
        seed: settings.seed ?? -1,
        width: settings.width,
        height: settings.height,
        batch_size: settings.batch_size,
        batch_count: settings.batch_count,
        loras: settings.loras,
      }),
    onSuccess: (result) => {
      const run: LocalRun = {
        id: `${Date.now()}`,
        createdAt: new Date().toISOString(),
        provider,
        prompt,
        settings,
        result,
      }
      setRuns((current) => [run, ...current].slice(0, 12))
      toast.success('Generation terminee')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const applyPreset = (presetId: ResolutionPresetId) => {
    const preset = SDXL_PRESETS.find((item) => item.id === presetId) ?? SDXL_PRESETS[0]
    setResolutionPreset(presetId)
    if (preset.id !== 'custom') {
      setSettings((current) => ({ ...current, width: preset.width, height: preset.height }))
    }
  }

  const addLora = () => {
    if (!selectedLora) return
    if (settings.loras.some((item) => item.name === selectedLora)) {
      toast.error('LoRA deja ajoute')
      return
    }
    updateSetting('loras', [...settings.loras, { name: selectedLora, weight: loraWeight }])
    setSelectedLora('')
    setLoraWeight(1)
  }

  const removeLora = (name: string) => {
    updateSetting('loras', settings.loras.filter((item) => item.name !== name))
  }

  const latestImages = generateMutation.data?.images ?? []
  const backendHistory = generateMutation.data?.history ?? []

  return (
    <div className="generation-page flex flex-col h-full p-5 gap-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-500 font-mono uppercase tracking-wider">
            <ImageIcon size={14} />
            F11 - Connecteur ComfyUI / SD-Forge
          </div>
          <h2 className="font-display text-xl font-semibold text-white mt-1">Generation d'images</h2>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Provider</label>
            <select
              className="input w-40"
              value={provider}
              onChange={(event) => {
                const nextProvider = event.target.value as GenerationProvider
                setProvider(nextProvider)
                setBaseUrl(DEFAULT_BASE_URL[nextProvider])
                setCapabilities(null)
              }}
            >
              <option value="comfyui">ComfyUI</option>
              <option value="sdforge">SD-Forge</option>
            </select>
          </div>
          <div className="min-w-[280px]">
            <label className="text-xs text-gray-500 mb-1 block">Base URL</label>
            <input
              className="input"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={DEFAULT_BASE_URL[provider]}
            />
          </div>
          <button
            className="btn-primary h-[38px]"
            onClick={() => discoverMutation.mutate()}
            disabled={!baseUrl.trim() || discoverMutation.isPending}
          >
            {discoverMutation.isPending ? <Spinner size={14} /> : <PlugZap size={14} />}
            Connecter
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-4 min-h-0 flex-1">
        <section className="flex flex-col gap-4 min-h-0">
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">Prompt</p>
                <p className="text-xs text-gray-500">Testez une idee avec les reglages du connecteur actif.</p>
              </div>
              {connectorReady ? (
                <span className="badge bg-studio-success/15 text-studio-success">Connecte</span>
              ) : capabilities ? (
                <span className="badge bg-studio-warn/15 text-studio-warn">A verifier</span>
              ) : (
                <span className="badge bg-studio-muted text-gray-400">Non connecte</span>
              )}
            </div>
            <PromptEditor
              className="card border border-studio-border bg-studio-surface/50"
              value={prompt}
              onChange={setPrompt}
              placeholder="masterpiece, best quality, cinematic lighting, __wildcard__..."
              rows={4}
            />
            <textarea
              className="input min-h-20 resize-y font-mono text-xs leading-relaxed"
              value={negativePrompt}
              onChange={(event) => setNegativePrompt(event.target.value)}
              placeholder="Negative prompt: low quality, blurry, watermark..."
            />
            {/* Processed prompt preview panel */}
            {prompt.trim() && (
              <div className="border border-studio-border bg-studio-elevated/20 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsPreviewExpanded(!isPreviewExpanded)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 bg-studio-surface/40 hover:bg-studio-surface/60 transition-colors text-xs font-semibold text-gray-400"
                >
                  <span className="flex items-center gap-1.5">
                    {previewLoading ? <Spinner size={10} /> : <span>✨</span>}
                    Aperçu du prompt traité
                  </span>
                  {isPreviewExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                
                {isPreviewExpanded && (
                  <div className="p-3.5 space-y-3 bg-studio-bg/40 border-t border-studio-border/60">
                    <div className="p-3 bg-studio-bg font-mono text-xs text-gray-300 break-words leading-relaxed rounded border border-studio-border/40 select-all min-h-16 relative">
                      {processedPreview || 'Résolution en cours...'}
                    </div>
                    
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        className="btn-ghost py-1 px-2.5 text-[11px]"
                        onClick={handleRegeneratePreview}
                        disabled={previewLoading}
                      >
                        🔄 Régénérer
                      </button>
                      <button
                        type="button"
                        className="btn-ghost py-1 px-2.5 text-[11px] hover:text-studio-accent-glow"
                        onClick={handleApplyPreview}
                        disabled={!processedPreview}
                      >
                        📋 Appliquer au prompt
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {capabilities && (
            <ConnectorStatus capabilities={capabilities} />
          )}

          <div className="card p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Settings2 size={15} />
              Reglages
            </div>

            <div className="generation-settings-grid">
              <SelectField
                label="Modele"
                value={settings.model}
                options={models}
                emptyLabel="Connectez pour lister les modeles"
                onChange={(value) => updateSetting('model', value)}
              />
              <SelectField
                label="Sampler"
                value={settings.sampler}
                options={samplers}
                emptyLabel="Connectez pour lister les samplers"
                onChange={(value) => updateSetting('sampler', value)}
              />
              <SelectField
                label="Scheduler"
                value={settings.scheduler}
                options={schedulers}
                emptyLabel="Automatique / defaut backend"
                onChange={(value) => updateSetting('scheduler', value)}
              />
              <NumberField
                label="Steps"
                value={settings.steps}
                min={1}
                max={150}
                onChange={(value) => value !== '' && updateSetting('steps', value)}
              />
              <NumberField
                label="CFG"
                value={settings.cfg}
                min={0}
                max={30}
                step={0.5}
                onChange={(value) => value !== '' && updateSetting('cfg', value)}
              />
              <NumberField
                label="Seed"
                value={settings.seed ?? ''}
                placeholder="random"
                onChange={(value) => updateSetting('seed', value === '' ? null : value)}
              />
              {supportsBatchSize && (
                <NumberField
                  label="Batch size"
                  value={settings.batch_size}
                  min={1}
                  max={16}
                  onChange={(value) => value !== '' && updateSetting('batch_size', value)}
                />
              )}
              {supportsBatchCount && (
                <NumberField
                  label="Batch count"
                  value={settings.batch_count}
                  min={1}
                  max={16}
                  onChange={(value) => value !== '' && updateSetting('batch_count', value)}
                />
              )}
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-2 block">Resolution SDXL</label>
              <div className="flex flex-wrap gap-2">
                {SDXL_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                      resolutionPreset === preset.id
                        ? 'border-studio-accent/50 bg-studio-accent/15 text-studio-accent-glow'
                        : 'border-studio-border text-gray-500 hover:text-white'
                    }`}
                    onClick={() => applyPreset(preset.id)}
                  >
                    {preset.label}
                    {preset.id !== 'custom' ? ` ${preset.width}x${preset.height}` : ''}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3 max-w-sm">
                <NumberField
                  label="Width"
                  value={settings.width}
                  min={64}
                  max={4096}
                  step={64}
                  onChange={(value) => {
                    if (value === '') return
                    setResolutionPreset('custom')
                    updateSetting('width', value)
                  }}
                />
                <NumberField
                  label="Height"
                  value={settings.height}
                  min={64}
                  max={4096}
                  step={64}
                  onChange={(value) => {
                    if (value === '') return
                    setResolutionPreset('custom')
                    updateSetting('height', value)
                  }}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-2 block">LoRA</label>
              <div className="flex gap-2 flex-wrap">
                <select
                  className="input min-w-[260px] flex-1"
                  value={selectedLora}
                  onChange={(event) => setSelectedLora(event.target.value)}
                  disabled={loras.length === 0}
                >
                  <option value="">{loras.length === 0 ? 'Aucun LoRA expose par le connecteur' : 'Selectionner un LoRA'}</option>
                  {loras.map((item) => {
                    const value = optionValue(item)
                    return (
                      <option key={value} value={value}>
                        {optionLabel(item)}
                      </option>
                    )
                  })}
                </select>
                <NumberField
                  label="Poids"
                  value={loraWeight}
                  min={-2}
                  max={2}
                  step={0.05}
                  onChange={(value) => value !== '' && setLoraWeight(value)}
                  compact
                />
                <button className="btn-ghost" disabled={!selectedLora} onClick={addLora}>
                  <Plus size={13} />
                  Ajouter
                </button>
              </div>
              {settings.loras.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  {settings.loras.map((item) => (
                    <span key={item.name} className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-studio-elevated border border-studio-border text-xs">
                      <span className="font-mono text-gray-300">{item.name}</span>
                      <span className="text-studio-accent-glow">{item.weight}</span>
                      <button className="text-gray-600 hover:text-studio-danger" onClick={() => removeLora(item.name)}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-600 mt-2">Aucun LoRA actif pour cette generation.</p>
              )}
            </div>
          </div>

          {(discoverMutation.error || generateMutation.error) && (
            <div className="border border-studio-danger/40 bg-studio-danger/10 text-studio-danger rounded-md px-3 py-2 text-sm flex items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{(discoverMutation.error as Error | null)?.message ?? (generateMutation.error as Error | null)?.message}</span>
            </div>
          )}

          <button
            className="btn-primary justify-center h-11"
            onClick={() => generateMutation.mutate()}
            disabled={!prompt.trim() || !baseUrl.trim() || generateMutation.isPending}
          >
            {generateMutation.isPending ? <Spinner size={16} /> : <Wand2 size={16} />}
            Generer
          </button>
        </section>

        <aside className="card flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-studio-border flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <ImageIcon size={15} />
              Resultats
            </div>
            <button className="text-gray-600 hover:text-white transition-colors" onClick={() => generateMutation.reset()} title="Vider le resultat courant">
              <RefreshCcw size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {generateMutation.isPending ? (
              <EmptyPanel icon={<Spinner size={24} />} title="Generation en cours" text="Le backend contacte le connecteur actif." />
            ) : latestImages.length > 0 ? (
              <ImageGrid images={latestImages} />
            ) : (
              <EmptyPanel
                icon={<ImageIcon size={28} className="opacity-30" />}
                title="Aucune image generee"
                text="Connectez un provider, ajustez les reglages, puis lancez une generation."
              />
            )}

            <div className="border-t border-studio-border pt-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white mb-3">
                <History size={15} />
                Historique
              </div>
              <HistoryList backendHistory={backendHistory} localRuns={runs} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function ConnectorStatus({ capabilities }: { capabilities: GenerationCapabilities }) {
  const errors = capabilities.errors ?? []
  const missing = [
    !capabilities.models?.length ? 'modeles' : null,
    !capabilities.samplers?.length ? 'samplers' : null,
    capabilities.provider === 'comfyui' && !capabilities.schedulers?.length ? 'schedulers' : null,
  ].filter(Boolean)
  if (capabilities.reachable && errors.length === 0 && missing.length === 0) {
    return (
      <div className="border border-studio-success/30 bg-studio-success/10 text-studio-success rounded-md px-3 py-2 text-xs flex items-start gap-2">
        <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
        <span>
          Connecte via {capabilities.effective_base_url ?? capabilities.base_url ?? 'connecteur'}.
        </span>
      </div>
    )
  }

  return (
    <div className="border border-studio-warn/40 bg-studio-warn/10 text-studio-warn rounded-md px-3 py-2 text-xs space-y-1">
      <div className="flex items-start gap-2">
        <AlertCircle size={15} className="mt-0.5 shrink-0" />
        <span>
          Connecteur non complet via {capabilities.effective_base_url ?? capabilities.base_url ?? 'URL inconnue'}.
        </span>
      </div>
      {errors.slice(0, 4).map((error, index) => (
        <p key={index} className="pl-6 leading-relaxed opacity-90">{error}</p>
      ))}
      {missing.length > 0 && (
        <p className="pl-6 leading-relaxed opacity-90">
          Listes manquantes: {missing.join(', ')}.
        </p>
      )}
      {!capabilities.reachable && (
        <p className="pl-6 leading-relaxed opacity-90">
          Dans Docker sous Linux, lancez ComfyUI avec une ecoute reseau, par exemple <span className="font-mono">--listen 0.0.0.0</span>, puis reconnectez.
        </p>
      )}
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  emptyLabel,
  onChange,
}: {
  label: string
  value: string
  options: CapabilityOption[]
  emptyLabel: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{emptyLabel}</option>
        {options.map((item) => {
          const itemValue = optionValue(item)
          return (
            <option key={itemValue} value={itemValue}>
              {optionLabel(item)}
            </option>
          )
        })}
      </select>
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  placeholder,
  compact = false,
  onChange,
}: {
  label: string
  value: number | ''
  min?: number
  max?: number
  step?: number
  placeholder?: string
  compact?: boolean
  onChange: (value: number | '') => void
}) {
  return (
    <div className={compact ? 'w-24' : undefined}>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      <input
        className="input"
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value
          onChange(next === '' ? '' : Number(next))
        }}
      />
    </div>
  )
}

function ImageGrid({ images }: { images: GeneratedImage[] }) {
  return (
    <div className="generation-image-grid">
      {images.map((image, index) => {
        const src = imageToSrc(image)
        return (
          <figure key={`${src ?? 'image'}-${index}`} className="generation-image-tile">
            {src ? (
              <img src={src} alt={imageCaption(image, index)} />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-gray-600">Image non lisible</div>
            )}
            <figcaption>{imageCaption(image, index)}</figcaption>
          </figure>
        )
      })}
    </div>
  )
}

function HistoryList({
  backendHistory,
  localRuns,
}: {
  backendHistory: GenerationHistoryItem[]
  localRuns: LocalRun[]
}) {
  if (backendHistory.length === 0 && localRuns.length === 0) {
    return <p className="text-xs text-gray-600">L'historique apparaitra apres une generation retournee par le backend.</p>
  }

  return (
    <div className="space-y-3">
      {backendHistory.map((item, index) => (
        <HistoryCard
          key={`backend-${item.id ?? index}`}
          title={item.created_at ? new Date(item.created_at).toLocaleString('fr') : `Backend #${index + 1}`}
          prompt={item.prompt}
          provider={item.provider}
          images={item.images ?? []}
        />
      ))}
      {localRuns.map((run) => (
        <HistoryCard
          key={run.id}
          title={new Date(run.createdAt).toLocaleString('fr')}
          prompt={run.prompt}
          provider={run.provider}
          images={run.result.images ?? []}
        />
      ))}
    </div>
  )
}

function HistoryCard({
  title,
  provider,
  prompt,
  images,
}: {
  title: string
  provider?: GenerationProvider
  prompt?: string
  images: GeneratedImage[]
}) {
  const firstImage = images[0]
  const firstSrc = firstImage ? imageToSrc(firstImage) : null

  return (
    <div className="rounded-md border border-studio-border bg-studio-elevated/50 p-2 flex gap-3">
      <div className="w-16 h-16 rounded bg-studio-bg border border-studio-border overflow-hidden shrink-0">
        {firstSrc ? <img className="w-full h-full object-cover" src={firstSrc} alt={title} /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 truncate">{title}</span>
          {provider && <span className="badge bg-studio-muted text-gray-400">{provider}</span>}
        </div>
        {prompt && <p className="text-xs text-gray-500 line-clamp-2 mt-1">{prompt}</p>}
        <p className="text-xs text-gray-700 mt-1">{images.length} image(s)</p>
      </div>
    </div>
  )
}

function EmptyPanel({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-64 text-center text-gray-600">
      <div className="mb-3">{icon}</div>
      <p className="text-sm text-gray-400">{title}</p>
      <p className="text-xs max-w-xs mt-1">{text}</p>
    </div>
  )
}
