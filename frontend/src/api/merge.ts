import { api } from './client'

export const mergeApi = {
  prepare: (sources: string[], target: string) =>
    api.post<{
      prepare_token: string
      source_entry_counts: Record<string, number>
      merged_entry_count: number
      duplicate_groups: number
      diff_summary: object | null
      preview: string
    }>('/merge/prepare', { sources, target }).then((r) => r.data),

  execute: (prepare_token: string, delete_sources = false) =>
    api.post<{ ok: boolean; history_id: number; merged_entries: number }>(
      '/merge/execute', { prepare_token, delete_sources, confirm: true }
    ).then((r) => r.data),

  history: () =>
    api.get<{
      id: number
      merged_at: string
      source_files: string[]
      result_file: string
      summary: string
      status: string
    }[]>('/merge/history').then((r) => r.data),

  rollback: (id: number) =>
    api.post<{ ok: boolean }>(`/merge/rollback/${id}`).then((r) => r.data),
}
