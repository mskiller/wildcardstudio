import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { explorerApi } from '@/api/explorer'
import toast from 'react-hot-toast'

/** Central hook for wildcard file operations */
export function useWildcards() {
  const qc = useQueryClient()

  const tree = useQuery({
    queryKey: ['tree'],
    queryFn: explorerApi.getTree,
    refetchInterval: 15_000,
    staleTime: 10_000,
  })

  const saveFile = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      explorerApi.saveFile(path, content),
    onSuccess: (_d, { path }) => {
      toast.success('Sauvegardé')
      qc.invalidateQueries({ queryKey: ['tree'] })
      qc.invalidateQueries({ queryKey: ['file', path] })
      qc.invalidateQueries({ queryKey: ['preview', path] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteFile = useMutation({
    mutationFn: (path: string) => explorerApi.deleteFile(path),
    onSuccess: () => {
      toast.success('Fichier supprimé')
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createFile = useMutation({
    mutationFn: ({ path, content = '' }: { path: string; content?: string }) =>
      explorerApi.createFile(path, content),
    onSuccess: () => {
      toast.success('Fichier créé')
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const useFile = (path: string | null) =>
    useQuery({
      queryKey: ['file', path],
      queryFn: () => explorerApi.getFile(path!),
      enabled: !!path,
      staleTime: 5_000,
    })

  const usePreview = (path: string | null, n = 5) =>
    useQuery({
      queryKey: ['preview', path, n],
      queryFn: () => explorerApi.preview(path!, n),
      enabled: !!path,
    })

  return { tree, saveFile, deleteFile, createFile, useFile, usePreview }
}
