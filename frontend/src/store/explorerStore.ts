import { create } from 'zustand'
import type { TreeNode } from '@/api/explorer'

interface ExplorerState {
  selectedPath: string | null
  expandedPaths: Set<string>
  searchQuery: string
  setSelectedPath: (path: string | null) => void
  toggleExpanded: (path: string) => void
  setSearchQuery: (q: string) => void
}

export const useExplorerStore = create<ExplorerState>((set) => ({
  selectedPath: null,
  expandedPaths: new Set(),
  searchQuery: '',
  setSelectedPath: (path) => set({ selectedPath: path }),
  toggleExpanded: (path) =>
    set((s) => {
      const next = new Set(s.expandedPaths)
      next.has(path) ? next.delete(path) : next.add(path)
      return { expandedPaths: next }
    }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}))
