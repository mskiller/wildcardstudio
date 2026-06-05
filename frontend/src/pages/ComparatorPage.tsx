import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { GitCompare, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { comparatorApi } from '@/api/comparator'
import DiffPanel from '@/components/comparator/DiffPanel'
import Spinner from '@/components/shared/Spinner'
import TokenCounter from '@/components/editor/TokenCounter'
import { useEditorStore } from '@/store/editorStore'
import type { EditorLineToComparatorPayload } from '@/store/editorStore'
import { buildEditorNavigationUrl } from '@/store/editorNavigation'

const MODES = [
  { value: 'auto',  label: 'Auto' },
  { value: 'tag',   label: 'TAG / Booru' },
  { value: 'nl',    label: 'Natural Language' },
]

type CompareSide = 'left' | 'right'

type ComparatorDraft = {
  version: 1
  left: string
  right: string
  mode: string
  activeSide: CompareSide
  leftSourcePath: string
  rightSourcePath: string
  leftLine: string
  rightLine: string
}

type ComparatorLocationState = {
  fromEditorLine?: unknown
  targetSide?: unknown
  comparatorTargetSide?: unknown
}

const comparatorDraftStorageKey = 'wildcard-comparator-draft-v1'

const emptyComparatorDraft: ComparatorDraft = {
  version: 1,
  left: '',
  right: '',
  mode: 'auto',
  activeSide: 'left',
  leftSourcePath: '',
  rightSourcePath: '',
  leftLine: '',
  rightLine: '',
}

function isCompareSide(value: unknown): value is CompareSide {
  return value === 'left' || value === 'right'
}

function loadComparatorDraft(): ComparatorDraft {
  try {
    const stored = localStorage.getItem(comparatorDraftStorageKey)
    if (!stored) return emptyComparatorDraft
    const parsed = JSON.parse(stored) as Partial<ComparatorDraft>
    return {
      version: 1,
      left: typeof parsed.left === 'string' ? parsed.left : '',
      right: typeof parsed.right === 'string' ? parsed.right : '',
      mode: typeof parsed.mode === 'string' && MODES.some((mode) => mode.value === parsed.mode) ? parsed.mode : 'auto',
      activeSide: isCompareSide(parsed.activeSide) ? parsed.activeSide : 'left',
      leftSourcePath: typeof parsed.leftSourcePath === 'string' ? parsed.leftSourcePath : '',
      rightSourcePath: typeof parsed.rightSourcePath === 'string' ? parsed.rightSourcePath : '',
      leftLine: typeof parsed.leftLine === 'string' ? parsed.leftLine : '',
      rightLine: typeof parsed.rightLine === 'string' ? parsed.rightLine : '',
    }
  } catch {
    return emptyComparatorDraft
  }
}

function saveComparatorDraft(draft: ComparatorDraft) {
  try {
    localStorage.setItem(comparatorDraftStorageKey, JSON.stringify(draft))
  } catch {
    // Draft restore is best effort only.
  }
}

function normalizeEditorLinePayload(value: unknown): EditorLineToComparatorPayload | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as Partial<EditorLineToComparatorPayload>
  const lineNumber = Number(payload.line_number)
  if (
    typeof payload.file_path !== 'string' ||
    typeof payload.raw !== 'string' ||
    !payload.raw.trim() ||
    !Number.isFinite(lineNumber) ||
    lineNumber <= 0
  ) {
    return null
  }
  return {
    file_path: payload.file_path,
    line_number: lineNumber,
    raw: payload.raw,
  }
}

function chooseTargetSide(requestedSide: CompareSide | undefined, left: string, right: string, activeSide: CompareSide): CompareSide {
  if (requestedSide) return requestedSide
  if (!left.trim()) return 'left'
  if (!right.trim()) return 'right'
  return activeSide
}

export default function ComparatorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const restoredDraft = useMemo(loadComparatorDraft, [])
  const [left, setLeft]   = useState(restoredDraft.left)
  const [right, setRight] = useState(restoredDraft.right)
  const [mode, setMode]   = useState(restoredDraft.mode)
  const [leftSourcePath, setLeftSourcePath] = useState(restoredDraft.leftSourcePath)
  const [rightSourcePath, setRightSourcePath] = useState(restoredDraft.rightSourcePath)
  const [leftLine, setLeftLine] = useState(restoredDraft.leftLine)
  const [rightLine, setRightLine] = useState(restoredDraft.rightLine)
  const [activeSide, setActiveSide] = useState<CompareSide>(restoredDraft.activeSide)
  const requestOpenInEditor = useEditorStore((s) => s.requestOpenInEditor)
  const consumeCompareLine = useEditorStore((s) => s.consumeCompareLine)

  const { mutate, data, isPending } = useMutation({
    mutationFn: () => comparatorApi.diff(left, right, mode),
  })

  const openSourceInEditor = (
    filePath: string,
    lineRaw: string,
    label: string,
  ) => {
    const trimmed = filePath.trim()
    if (!trimmed) return
    const line = Number(lineRaw)
    const request = {
      file_path: trimmed,
      line_number: Number.isFinite(line) && line > 0 ? line : undefined,
      label,
      source: 'comparator' as const,
    }
    requestOpenInEditor(request)
    navigate(buildEditorNavigationUrl(request))
  }

  const receiveEditorLine = (payload: EditorLineToComparatorPayload, requestedSide?: CompareSide) => {
    const targetSide = chooseTargetSide(requestedSide, left, right, activeSide)
    const sourceLine = String(payload.line_number)
    if (targetSide === 'left') {
      setLeft(payload.raw.trim())
      setLeftSourcePath(payload.file_path)
      setLeftLine(sourceLine)
      setActiveSide(right.trim() ? 'left' : 'right')
    } else {
      setRight(payload.raw.trim())
      setRightSourcePath(payload.file_path)
      setRightLine(sourceLine)
      setActiveSide(left.trim() ? 'right' : 'left')
    }
    toast.success(`Line ${payload.line_number} loaded into ${targetSide === 'left' ? 'Prompt A' : 'Prompt B'}`)
  }

  useEffect(() => {
    saveComparatorDraft({
      version: 1,
      left,
      right,
      mode,
      activeSide,
      leftSourcePath,
      rightSourcePath,
      leftLine,
      rightLine,
    })
  }, [activeSide, left, leftLine, leftSourcePath, mode, right, rightLine, rightSourcePath])

  useEffect(() => {
    const routeState = (location.state || null) as ComparatorLocationState | null
    const routePayload = normalizeEditorLinePayload(routeState?.fromEditorLine)
    const storedPayload = consumeCompareLine()
    const payload = routePayload || storedPayload
    if (!payload) return

    const routeTargetSide = routeState?.targetSide
    const routeComparatorTargetSide = routeState?.comparatorTargetSide
    const requestedSide =
      isCompareSide(routeTargetSide) ? routeTargetSide
        : isCompareSide(routeComparatorTargetSide) ? routeComparatorTargetSide
          : undefined
    receiveEditorLine(payload, requestedSide)
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [location.key])

  return (
    <div className="flex flex-col h-full p-5 gap-5">
      {/* Mode selector */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">Mode :</span>
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              mode === m.value
                ? 'bg-studio-accent/20 text-studio-accent-glow border border-studio-accent/30'
                : 'text-gray-500 border border-studio-border hover:text-white'
            }`}
          >
            {m.label}
          </button>
        ))}
        <span className="text-xs text-gray-500 ml-2">Cible éditeur :</span>
        {(['left', 'right'] as CompareSide[]).map((side) => (
          <button
            key={side}
            onClick={() => setActiveSide(side)}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              activeSide === side
                ? 'bg-studio-accent/20 text-studio-accent-glow border border-studio-accent/30'
                : 'text-gray-500 border border-studio-border hover:text-white'
            }`}
          >
            {side === 'left' ? 'Prompt A' : 'Prompt B'}
          </button>
        ))}
        <button
          className="btn-primary ml-auto"
          onClick={() => mutate()}
          disabled={!left.trim() || !right.trim() || isPending}
        >
          {isPending ? <Spinner size={14} /> : <GitCompare size={14} />}
          Comparer
        </button>
      </div>

      {/* Editors */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {[
          {
            side: 'left' as CompareSide,
            label: 'Prompt A (gauche)',
            value: left,
            onChange: setLeft,
            sourcePath: leftSourcePath,
            onSourcePathChange: setLeftSourcePath,
            line: leftLine,
            onLineChange: setLeftLine,
            placeholder: 'masterpiece, best quality, 1girl, smile…',
          },
          {
            side: 'right' as CompareSide,
            label: 'Prompt B (droite)',
            value: right,
            onChange: setRight,
            sourcePath: rightSourcePath,
            onSourcePathChange: setRightSourcePath,
            line: rightLine,
            onLineChange: setRightLine,
            placeholder: 'A beautiful woman standing in a field…',
          },
        ].map(({ side, label, value, onChange, sourcePath, onSourcePathChange, line, onLineChange, placeholder }) => (
          <div key={label} className="flex flex-col card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-studio-border shrink-0">
              <span className={`text-xs ${activeSide === side ? 'text-studio-accent-glow' : 'text-gray-400'}`}>{label}</span>
              <TokenCounter text={value} />
            </div>
            <div className="px-4 py-2 border-b border-studio-border flex items-center gap-2">
              <input
                className="input text-xs flex-1"
                value={sourcePath}
                onFocus={() => setActiveSide(side)}
                onChange={(e) => onSourcePathChange(e.target.value)}
                placeholder="Chemin source optionnel (pour ouvrir dans l’éditeur)"
              />
              <input
                className="input text-xs w-20"
                value={line}
                onFocus={() => setActiveSide(side)}
                onChange={(e) => onLineChange(e.target.value)}
                placeholder="Ligne"
              />
              <button
                className="btn-ghost text-xs"
                onClick={() => openSourceInEditor(sourcePath, line, side === 'left' ? 'Comparator:A' : 'Comparator:B')}
                disabled={!sourcePath.trim()}
              >
                Ouvrir éditeur
              </button>
            </div>
            <textarea
              className="flex-1 bg-transparent text-gray-300 font-mono text-sm p-4 resize-none focus:outline-none leading-relaxed placeholder-gray-700"
              value={value}
              onFocus={() => setActiveSide(side)}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              spellCheck={false}
            />
          </div>
        ))}
      </div>

      {/* Results */}
      {data && (
        <div className="shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <RefreshCw size={13} className="text-studio-accent" />
            <span className="text-xs text-gray-400 font-mono uppercase tracking-wider">Résultats</span>
          </div>
          <DiffPanel result={data} />
        </div>
      )}

      {!data && !isPending && (
        <div className="flex-1 flex items-center justify-center text-gray-700 text-sm">
          Entrez deux prompts et cliquez sur Comparer
        </div>
      )}
    </div>
  )
}
