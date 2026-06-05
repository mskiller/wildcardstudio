import { api } from './client'
import { BULK_OPERATION_TIMEOUT_MS } from './timeouts'

export interface ScannerSummary {
  tag: number
  nl: number
  mixed: number
  unknown: number
  total: number
  wildcard_refs?: number
  variants?: number
  yaml_files?: number
  txt_files?: number
  errors?: number
  classification?: Record<string, number>
}

export interface ScannerFile {
  path: string
  entry_count: number
  prompt_style: string
  format: string
  last_scanned: string | null
  line_count?: number | null
  blank_count?: number | null
  comment_count?: number | null
  wildcard_refs_count?: number | null
  refs_count?: number | null
  variants_count?: number | null
  yaml_keys_count?: number | null
  classification?: string | null
  effective_classification?: string | null
  classification_score?: number | null
  classification_reasons?: string[] | Record<string, unknown> | string | null
  error?: string | null
}

export interface ScannerEntry {
  content: string
  style: string
  tag_score: number
  nl_score: number
  line_number?: number | null
  yaml_path?: string | null
  classification?: string | null
  classification_score?: number | null
  classification_reasons?: string[] | Record<string, unknown> | string | null
  refs?: string[] | null
  syntax?: Record<string, number> | null
}

export interface ScannerResultsPage {
  summary: ScannerSummary
  files: ScannerFile[]
  page: number
  limit: number
  total: number
}

export const scannerApi = {
  scan: () =>
    api.post<{ scanned: number; pruned?: number; status?: 'completed' | 'already_running' }>(
      '/scanner/scan',
      undefined,
      { timeout: BULK_OPERATION_TIMEOUT_MS },
    ).then((r) => r.data),

  results: (params?: { page?: number; limit?: number }) =>
    api.get<ScannerResultsPage>('/scanner/results', {
      params,
      timeout: BULK_OPERATION_TIMEOUT_MS,
    }).then((r) => r.data),

  scanFile: (path: string) =>
    api.get<{
      path: string
      overall_style: string
      entry_total?: number
      limit?: number
      entries: ScannerEntry[]
    }>('/scanner/file', {
      params: { path, limit: 500 },
      timeout: BULK_OPERATION_TIMEOUT_MS,
    }).then((r) => r.data),

  convert: (text: string, direction: 'nl_to_tag' | 'tag_to_nl') =>
    api.post<{ result: string; note: string }>('/scanner/convert', { text, direction }).then((r) => r.data),
}
