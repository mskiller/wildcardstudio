import { api } from './client'

export interface ActionPreviewPayload {
  kind?: string
  action_count?: number
  actions?: Record<string, unknown>[]
  note?: string
}

export interface ActionPreviewSummary {
  groups?: number
  proposed_removals?: number
  entries_considered?: number
}

export interface ActionPreviewGroup {
  group_id?: number | string | null
  type?: string
  confidence?: number
  canonical_strategy?: string
  canonical?: Record<string, unknown>
  members?: Record<string, unknown>[]
  proposed_actions?: Record<string, unknown>[]
}

export interface ActionPreview {
  id?: number | string
  created_at?: number | string
  action?: string
  source?: string
  threshold?: number
  scope?: string | null
  summary?: ActionPreviewSummary
  groups?: ActionPreviewGroup[]
  kind?: string
  payload?: ActionPreviewPayload
  action_count?: number
  actions?: Record<string, unknown>[]
  note?: string
}

export interface ActionPreviewRequest {
  action?: 'dedupe_cleanup' | string
  threshold?: number
  scope?: string
  source?: 'auto' | 'persisted' | 'scan'
  max_groups?: number
}

export const actionsApi = {
  preview: (body: ActionPreviewRequest = { action: 'dedupe_cleanup', source: 'auto', threshold: 85, max_groups: 100 }) =>
    api.post<ActionPreview>('/actions/preview', body).then((r) => r.data),
}
