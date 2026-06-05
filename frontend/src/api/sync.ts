import { api } from './client'

export const syncApi = {
  convert: (text: string, direction: string, wildcard_name = 'wildcard', mode = 'file') =>
    api.post<{ result: string; direction: string }>('/sync/convert', { text, direction, wildcard_name, mode })
      .then((r) => r.data),

  export: (folder?: string, style_filter?: string) =>
    api.post('/sync/export', { folder, style_filter }, { responseType: 'blob' }).then((r) => r.data),

  gitCommit: (message: string) =>
    api.post<{ ok: boolean; hash?: string; message?: string }>('/sync/git/commit', { message }).then((r) => r.data),

  gitLog: (n = 20) =>
    api.get<{ commits: { hash: string; message: string; date: string; author: string }[] }>(
      '/sync/git/log', { params: { n } }
    ).then((r) => r.data),

  gitDiff: (commit_a?: string, commit_b?: string) =>
    api.post<{ diff: string }>('/sync/git/diff', { commit_a, commit_b }).then((r) => r.data),

  backup: () =>
    api.post<{ ok: boolean; backup_path: string }>('/sync/backup').then((r) => r.data),
}
