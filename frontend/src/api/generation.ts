import { api } from './client'

export type GenerationProvider = 'comfyui' | 'sdforge'

export type CapabilityOption =
  | string
  | {
      name?: string
      value?: string
      label?: string
      title?: string
      filename?: string
      [key: string]: unknown
    }

export type GenerationCapabilities = {
  provider?: GenerationProvider
  base_url?: string
  effective_base_url?: string
  reachable?: boolean
  models?: CapabilityOption[]
  samplers?: CapabilityOption[]
  schedulers?: CapabilityOption[]
  loras?: CapabilityOption[]
  errors?: string[]
  supports_batch_size?: boolean
  supports_batch_count?: boolean
  defaults?: Partial<GenerationSettings> & { cfg_scale?: number }
  [key: string]: unknown
}

export type GenerationLora = {
  name: string
  weight: number
}

export type GenerationSettings = {
  model: string
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  seed: number | null
  width: number
  height: number
  batch_size: number
  batch_count: number
  loras: GenerationLora[]
}

export type GeneratedImage =
  | string
  | {
      url?: string
      src?: string
      data?: string
      base64?: string
      image?: string
      history_image_url?: string
      mime_type?: string
      filename?: string
      width?: number
      height?: number
      seed?: number
      metadata?: Record<string, unknown>
      [key: string]: unknown
    }

export type GenerationHistoryItem = {
  id?: string | number
  created_at?: string
  provider?: GenerationProvider
  prompt?: string
  negative_prompt?: string
  settings?: Partial<GenerationSettings> & Record<string, unknown>
  images?: GeneratedImage[]
  [key: string]: unknown
}

export type Txt2ImgRequest = GenerationSettings & {
  provider: GenerationProvider
  base_url: string
  prompt: string
  negative_prompt: string
  cfg_scale?: number
}

export type Txt2ImgResponse = {
  images?: GeneratedImage[]
  history?: GenerationHistoryItem[]
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export const generationApi = {
  capabilities: (params: { provider: GenerationProvider; base_url: string }) =>
    api.get<GenerationCapabilities>('/generation/capabilities', { params }).then((r) => r.data),

  txt2img: (body: Txt2ImgRequest) =>
    api.post<Txt2ImgResponse>('/generation/txt2img', body, { timeout: 300_000 }).then((r) => r.data),

  history: (params?: { limit?: number; provider?: GenerationProvider }) =>
    api.get<{ items: GenerationHistoryItem[] }>('/generation/history', { params }).then((r) => r.data),
}
