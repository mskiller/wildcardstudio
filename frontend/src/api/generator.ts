import { api } from './client'

export const generatorApi = {
  suggestions: (category?: string, format = 'impact') =>
    api.get<{ suggestions: { content: string; file: string }[] }>(
      '/generator/suggestions', { params: { category, format } }
    ).then((r) => r.data),

  preview: (body: { name: string; format: string; style: string; entries: string[] }) =>
    api.post<{ name: string; format: string; preview: string }>(
      '/generator/preview', body
    ).then((r) => r.data),

  create: (body: { name: string; format: string; style: string; entries: string[]; target_folder: string }) =>
    api.post<{ ok: boolean; path: string; entry_count: number }>(
      '/generator/create', body
    ).then((r) => r.data),
}
