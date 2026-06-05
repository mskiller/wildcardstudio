import { api } from './client'

export interface DiffOp {
  op: 'equal' | 'insert' | 'delete'
  tokens: string[]
}

export interface DiffResult {
  similarity_jaccard: number
  similarity_levenshtein: number
  left_only: string[]
  right_only: string[]
  common: string[]
  left_token_count: number
  right_token_count: number
  diff: DiffOp[]
}

export const comparatorApi = {
  diff: (left: string, right: string, mode = 'auto') =>
    api.post<DiffResult>('/comparator/diff', { left, right, mode }).then((r) => r.data),

  similarity: (left: string, right: string, mode = 'auto') =>
    api.post('/comparator/similarity', { left, right, mode }).then((r) => r.data),
}
