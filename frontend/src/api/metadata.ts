import { api } from './client'

export type ReviewClassification = 'tag' | 'nl' | 'mixed' | 'unknown' | 'tags' | 'natural'

export interface MetadataPayload {
  target_type?: 'file' | 'entry'
  target_id: string
  category?: string | null
  status?: string | null
  favorite?: boolean | number
  notes?: string | null
  classification_override?: ReviewClassification | null
}

export interface MetadataResponse extends MetadataPayload {
  scope?: 'file' | 'entry'
  path?: string
  indexed?: boolean
  updated_at?: string
}

export const metadataApi = {
  getFile: (filePath: string) =>
    api.get<MetadataResponse>('/metadata/file', { params: { path: filePath } }).then((r) => r.data),

  save: ({ target_type, target_id, ...payload }: MetadataPayload) => {
    if ((target_type ?? 'file') === 'entry') {
      return api.put<MetadataResponse>('/metadata/entry', {
        file_path: target_id,
        ...payload,
      }).then((r) => r.data)
    }

    return api.put<MetadataResponse>('/metadata/file', {
      path: target_id,
      ...payload,
    }).then((r) => r.data)
  },

  saveFile: (filePath: string, payload: Omit<MetadataPayload, 'target_type' | 'target_id'>) =>
    api.put<MetadataResponse>('/metadata/file', {
      path: filePath,
      ...payload,
    }).then((r) => r.data),
}
