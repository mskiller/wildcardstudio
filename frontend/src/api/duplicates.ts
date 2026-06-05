import { api } from './client'

export interface DuplicateMember {
  entry_id: number
  file: string
  content: string
  similarity: number
}

export interface DuplicateGroup {
  id: number
  type: 'exact' | 'fuzzy'
  status: 'pending' | 'merged' | 'ignored'
  members: DuplicateMember[]
}

export const duplicatesApi = {
  scan: (threshold = 85, scope?: string) =>
    api.post<{ groups_found: number; entries_scanned: number; threshold: number }>(
      '/duplicates/scan', { threshold, scope }
    ).then((r) => r.data),

  groups: () =>
    api.get<DuplicateGroup[]>('/duplicates/groups').then((r) => r.data),

  ignore: (id: number) =>
    api.post(`/duplicates/groups/${id}/ignore`).then((r) => r.data),

  merge: (id: number) =>
    api.post(`/duplicates/groups/${id}/merge`).then((r) => r.data),

  batch: (group_ids: number[], action: 'merged' | 'ignored') =>
    api.post('/duplicates/batch', { group_ids, action }).then((r) => r.data),
}
