import { api } from './client'

export const editorApi = {
  autocomplete: (prefix: string, limit = 10) =>
    api.post<{ suggestions: { path: string; format: string; entry_count: number }[] }>(
      '/editor/autocomplete', { prefix, limit }
    ).then((r) => r.data),

  resolve: (prompt: string, n = 3, max_depth = 3) =>
    api.post<{ variants: string[] }>('/editor/resolve', { prompt, n, max_depth }).then((r) => r.data),

  tokenCount: (text: string) =>
    api.post<{ clip_tokens: number; t5_tokens: number; clip_limit: number; over_limit: boolean; text_length: number }>(
      '/editor/tokencount', { text }
    ).then((r) => r.data),

  validate: (prompt: string) =>
    api.post<{
      style: string
      tag_score: number
      nl_score: number
      tokens: { clip_tokens: number; over_limit: boolean }
      wildcards_referenced: string[]
      warnings: string[]
      valid: boolean
    }>('/editor/validate', { prompt }).then((r) => r.data),
}
