import { api } from './client'

const LONG_TAG_IMPORT_TIMEOUT_MS = 300_000

export interface Tag {
  id: number
  name: string
  category_id: number | null
  aliases: string | null
  weight: number
  usage_count: number
  created_at: string
  source?: string
}

export interface TagCategory {
  id: number
  name: string
  parent_id: number | null
  color: string | null
  icon: string | null
  position: number
}

export const tagsApi = {
  list: (params?: { category?: number; q?: string }) =>
    api.get<Tag[]>('/tags/', { params }).then((r) => r.data),

  create: (body: { name: string; category_id?: number; aliases?: string[]; weight?: number }) =>
    api.post<Tag>('/tags/', body).then((r) => r.data),

  update: (id: number, body: Partial<{ name: string; category_id: number; aliases: string[]; weight: number }>) =>
    api.put<Tag>(`/tags/${id}`, body).then((r) => r.data),

  delete: (id: number) =>
    api.delete(`/tags/${id}`).then((r) => r.data),

  listCategories: () =>
    api.get<TagCategory[]>('/tags/categories').then((r) => r.data),

  createCategory: (body: { name: string; color?: string; icon?: string; position?: number }) =>
    api.post<TagCategory>('/tags/categories', body).then((r) => r.data),

  updateCategory: (id: number, body: Partial<TagCategory>) =>
    api.put<TagCategory>(`/tags/categories/${id}`, body).then((r) => r.data),

  deleteCategory: (id: number) =>
    api.delete(`/tags/categories/${id}`).then((r) => r.data),

  merge: (keep_id: number, remove_id: number) =>
    api.post('/tags/merge', { keep_id, remove_id }).then((r) => r.data),

  importFromWildcards: () =>
    api.post<{ imported: number; updated: number; tags: string[] }>(
      '/tags/import-from-wildcards',
      undefined,
      { timeout: LONG_TAG_IMPORT_TIMEOUT_MS },
    ).then((r) => r.data),
}
