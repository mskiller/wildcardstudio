import { create } from 'zustand'

export interface EditorNavigationRequest {
  file_path: string
  line_number?: number
  label?: string
  source?: 'explorer' | 'duplicates' | 'comparator'
}

export interface EditorLineToComparatorPayload {
  file_path: string
  line_number: number
  raw: string
}

interface EditorState {
  content: string
  path: string | null
  isDirty: boolean
  pendingNavigation: EditorNavigationRequest | null
  pendingComparatorLine: EditorLineToComparatorPayload | null
  selectedText: string
  pendingInsertText: string | null
  setContent: (c: string) => void
  setPath: (p: string | null) => void
  markSaved: () => void
  requestOpenInEditor: (request: EditorNavigationRequest) => void
  consumeOpenInEditor: () => EditorNavigationRequest | null
  requestCompareLine: (payload: EditorLineToComparatorPayload) => void
  consumeCompareLine: () => EditorLineToComparatorPayload | null
  setSelectedText: (t: string) => void
  requestInsertText: (text: string) => void
  consumeInsertText: () => string | null
}

export const useEditorStore = create<EditorState>((set, get) => ({
  content: '',
  path: null,
  isDirty: false,
  pendingNavigation: null,
  pendingComparatorLine: null,
  selectedText: '',
  pendingInsertText: null,
  setContent: (content) => set({ content, isDirty: true }),
  setPath: (path) => set({ path }),
  markSaved: () => set({ isDirty: false }),
  requestOpenInEditor: (request) => set({ pendingNavigation: request }),
  consumeOpenInEditor: () => {
    const current = get().pendingNavigation
    set({ pendingNavigation: null })
    return current
  },
  requestCompareLine: (payload) => set({ pendingComparatorLine: payload }),
  consumeCompareLine: () => {
    const current = get().pendingComparatorLine
    set({ pendingComparatorLine: null })
    return current
  },
  setSelectedText: (selectedText) => set({ selectedText }),
  requestInsertText: (text) => set({ pendingInsertText: text }),
  consumeInsertText: () => {
    const current = get().pendingInsertText
    set({ pendingInsertText: null })
    return current
  },
}))
