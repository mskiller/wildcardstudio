import { api } from './client'

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  format?: string
  prompt_style?: string
  entry_count?: number
  children?: TreeNode[]
}

export interface WildcardFile {
  path: string
  content: string
  format: string
  prompt_style: string
  entry_count: number
  category?: string | null
  status?: string | null
  favorite?: boolean | number | null
  notes?: string | null
  classification_override?: string | null
  classification?: string | null
  effective_classification?: string | null
  classification_score?: number | null
  classification_reasons?: string[] | null
  line_count?: number | null
  blank_count?: number | null
  comment_count?: number | null
  wildcard_refs_count?: number | null
  variants_count?: number | null
  yaml_keys_count?: number | null
  size?: number | null
}

export const explorerApi = {
  getTree: () => api.get<TreeNode>('/explorer/tree').then((r) => r.data),

  getFile: (path: string) =>
    api.get<WildcardFile>('/explorer/file', { params: { path } }).then((r) => r.data),

  saveFile: (path: string, content: string) =>
    api.put('/explorer/file', { content }, { params: { path } }).then((r) => r.data),

  deleteFile: (path: string) =>
    api.delete('/explorer/file', { params: { path } }).then((r) => r.data),

  createFile: (path: string, content = '') =>
    api.post('/explorer/file', { path, content }).then((r) => r.data),

  preview: (path: string, n = 5) =>
    api.get<{ samples: string[] }>('/explorer/preview', { params: { path, n } }).then((r) => r.data),

  search: (q: string) =>
    api.get<{ results: { path: string; matches: { content: string; line: number }[] }[] }>(
      '/explorer/search', { params: { q } }
    ).then((r) => r.data),
}
