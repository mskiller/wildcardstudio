import type { EditorNavigationRequest } from './editorStore'

export function buildEditorNavigationUrl(request: EditorNavigationRequest): string {
  const params = new URLSearchParams()
  params.set('file_path', request.file_path)
  if (typeof request.line_number === 'number') {
    params.set('line_number', String(request.line_number))
  }
  if (request.label) {
    params.set('label', request.label)
  }
  return `/editor?${params.toString()}`
}

