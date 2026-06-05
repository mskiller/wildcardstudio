import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Download, Upload, GitBranch, Archive, ArrowLeftRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { syncApi } from '@/api/sync'
import Spinner from '@/components/shared/Spinner'

export default function SyncPage() {
  const [convertText, setConvertText] = useState('')
  const [convertDir, setConvertDir] = useState<'impact_to_dynamic' | 'dynamic_to_impact'>('impact_to_dynamic')
  const [gitMsg, setGitMsg] = useState('WildcardStudio: update wildcards')
  const [gitDiff, setGitDiff] = useState('')
  const [commitA, setCommitA] = useState('')
  const [commitB, setCommitB] = useState('')

  const { data: gitLog } = useQuery({
    queryKey: ['git-log'],
    queryFn: () => syncApi.gitLog(15),
    retry: false,
  })

  const convertMutation = useMutation({
    mutationFn: () => syncApi.convert(convertText, convertDir, 'wildcard', 'file'),
    onError: (e: Error) => toast.error(e.message),
  })

  const exportMutation = useMutation({
    mutationFn: () => syncApi.export(),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `wildcards_${Date.now()}.zip`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Export téléchargé')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const backupMutation = useMutation({
    mutationFn: syncApi.backup,
    onSuccess: () => toast.success('Backup créé'),
    onError: (e: Error) => toast.error(e.message),
  })

  const commitMutation = useMutation({
    mutationFn: () => syncApi.gitCommit(gitMsg),
    onSuccess: (d) => toast.success(d.ok ? `Commit ${d.hash}` : 'Rien à committer'),
    onError: (e: Error) => toast.error(e.message),
  })

  const diffMutation = useMutation({
    mutationFn: () => syncApi.gitDiff(commitA || undefined, commitB || undefined),
    onSuccess: (d) => setGitDiff(d.diff),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="flex flex-col h-full p-5 gap-5 overflow-y-auto">
      <div className="grid grid-cols-2 gap-5">
        {/* Export / Backup */}
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-medium text-white flex items-center gap-2"><Download size={14} className="text-studio-accent" />Export & Backup</h3>
          <button className="btn-primary w-full justify-center" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            {exportMutation.isPending ? <Spinner size={14} /> : <Download size={14} />}
            Exporter tous les wildcards (ZIP)
          </button>
          <button className="btn-ghost w-full justify-center" onClick={() => backupMutation.mutate()} disabled={backupMutation.isPending}>
            {backupMutation.isPending ? <Spinner size={14} /> : <Archive size={14} />}
            Backup local
          </button>
        </div>

        {/* Git */}
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-medium text-white flex items-center gap-2"><GitBranch size={14} className="text-studio-accent" />Versioning Git</h3>
          <div className="flex gap-2">
            <input
              className="input flex-1 text-xs"
              placeholder="Message de commit"
              value={gitMsg}
              onChange={(e) => setGitMsg(e.target.value)}
            />
            <button className="btn-primary text-xs shrink-0" onClick={() => commitMutation.mutate()} disabled={commitMutation.isPending}>
              {commitMutation.isPending ? <Spinner size={12} /> : null}
              Commit
            </button>
          </div>
          <div className="flex gap-2">
            <input className="input flex-1 text-xs font-mono" placeholder="Hash A" value={commitA} onChange={(e) => setCommitA(e.target.value)} />
            <input className="input flex-1 text-xs font-mono" placeholder="Hash B" value={commitB} onChange={(e) => setCommitB(e.target.value)} />
            <button className="btn-ghost text-xs shrink-0" onClick={() => diffMutation.mutate()}>Diff</button>
          </div>
        </div>
      </div>

      {/* Syntax converter */}
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-medium text-white flex items-center gap-2"><ArrowLeftRight size={14} className="text-studio-accent" />Convertisseur de syntaxe</h3>
        <div className="flex gap-2 mb-2">
          {([['impact_to_dynamic', 'Impact → Dynamic Prompts'], ['dynamic_to_impact', 'Dynamic Prompts → Impact']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setConvertDir(v)}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${convertDir === v ? 'border-studio-accent/50 bg-studio-accent/15 text-studio-accent-glow' : 'border-studio-border text-gray-500 hover:text-white'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Source</label>
            <textarea className="input h-32 resize-none font-mono text-xs leading-relaxed" value={convertText} onChange={(e) => setConvertText(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Résultat</label>
            <pre className="input h-32 overflow-auto font-mono text-xs leading-relaxed text-gray-300 whitespace-pre-wrap">
              {convertMutation.data?.result ?? <span className="text-gray-600">…</span>}
            </pre>
          </div>
        </div>
        <button className="btn-primary text-xs" onClick={() => convertMutation.mutate()} disabled={!convertText.trim()}>
          Convertir
        </button>
      </div>

      {/* Git log */}
      {gitLog?.commits && gitLog.commits.length > 0 && (
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-medium text-white">Journal Git</h3>
          <div className="space-y-1.5">
            {gitLog.commits.map((c) => (
              <div key={c.hash} className="flex items-center gap-3 text-xs">
                <span className="font-mono text-studio-accent">{c.hash}</span>
                <span className="text-gray-400 flex-1 truncate">{c.message}</span>
                <span className="text-gray-600 shrink-0">{new Date(c.date).toLocaleDateString('fr')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Git diff */}
      {gitDiff && (
        <div className="card p-4">
          <h3 className="text-sm font-medium text-white mb-3">Diff</h3>
          <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap max-h-80 overflow-auto leading-relaxed">
            {gitDiff}
          </pre>
        </div>
      )}
    </div>
  )
}
