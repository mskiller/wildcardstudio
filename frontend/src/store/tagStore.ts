import { create } from 'zustand'
import { Tag } from '@/api/tags'

interface TagState {
  selectedTags: Tag[]
  pendingPromptForGenerator: string | null
  pendingPromptForImageGeneration: string | null
  toggleTag: (tag: Tag) => void
  removeTag: (tagId: number) => void
  reorderTags: (currentIndex: number, direction: 'up' | 'down') => void
  clearSelection: () => void
  sendToGenerator: () => void
  clearPendingPrompt: () => void
  sendToImageGeneration: () => void
  setPendingPromptForImageGeneration: (prompt: string | null) => void
  clearPendingImagePrompt: () => void
}

export const useTagStore = create<TagState>((set) => ({
  selectedTags: [],
  pendingPromptForGenerator: null,
  pendingPromptForImageGeneration: null,

  toggleTag: (tag) =>
    set((state) => {
      const exists = state.selectedTags.some((t) => t.id === tag.id)
      if (exists) {
        return { selectedTags: state.selectedTags.filter((t) => t.id !== tag.id) }
      } else {
        return { selectedTags: [...state.selectedTags, tag] }
      }
    }),

  removeTag: (tagId) =>
    set((state) => ({
      selectedTags: state.selectedTags.filter((t) => t.id !== tagId),
    })),

  reorderTags: (currentIndex, direction) =>
    set((state) => {
      const newTags = [...state.selectedTags]
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (
        currentIndex < 0 ||
        currentIndex >= newTags.length ||
        targetIndex < 0 ||
        targetIndex >= newTags.length
      ) {
        return {}
      }
      const temp = newTags[currentIndex]
      newTags[currentIndex] = newTags[targetIndex]
      newTags[targetIndex] = temp
      return { selectedTags: newTags }
    }),

  clearSelection: () => set({ selectedTags: [] }),

  sendToGenerator: () =>
    set((state) => {
      if (state.selectedTags.length === 0) return {}
      const prompt = state.selectedTags.map((t) => t.name).join(', ')
      return {
        pendingPromptForGenerator: prompt,
        selectedTags: [], // Clear selected tags after sending
      }
    }),

  clearPendingPrompt: () => set({ pendingPromptForGenerator: null }),

  sendToImageGeneration: () =>
    set((state) => {
      if (state.selectedTags.length === 0) return {}
      const prompt = state.selectedTags.map((t) => t.name).join(', ')
      return {
        pendingPromptForImageGeneration: prompt,
        selectedTags: [],
      }
    }),

  setPendingPromptForImageGeneration: (prompt) => set({ pendingPromptForImageGeneration: prompt }),

  clearPendingImagePrompt: () => set({ pendingPromptForImageGeneration: null }),
}))
