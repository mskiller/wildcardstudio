import { api } from './client'

export interface PromptItem {
  id: number
  title: string | null
  content: string
  prompt_style: string | null
  model_target: string | null
  rating: number | null
  notes: string | null
  image_path: string | null
  tags_json: string | null
  collection: string | null
  token_count: number | null
  created_at: string
  updated_at: string | null
}

export const libraryApi = {
  list: (params?: { page?: number; limit?: number; sort?: string; model?: string; collection?: string; q?: string }) =>
    api.get<{ total: number; page: number; items: PromptItem[] }>('/library/', { params }).then((r) => r.data),

  create: (body: Partial<PromptItem> & { content: string }) =>
    api.post<PromptItem>('/library/', body).then((r) => r.data),

  get: (id: number) =>
    api.get<PromptItem>(`/library/${id}`).then((r) => r.data),

  update: (id: number, body: Partial<PromptItem>) =>
    api.put<PromptItem>(`/library/${id}`, body).then((r) => r.data),

  delete: (id: number) =>
    api.delete(`/library/${id}`).then((r) => r.data),

  collections: () =>
    api.get<{ collections: string[] }>('/library/collections').then((r) => r.data),
}
