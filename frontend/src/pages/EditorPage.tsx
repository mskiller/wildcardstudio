import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, Save, Wand2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { editorApi } from '@/api/editor'
import Spinner from '@/components/shared/Spinner'
import WildcardEditor, { EditorLinePayload, EditorTabState, EditorViewOptions } from '@/components/editor/WildcardEditor'
import AssistantPanel from '@/components/editor/AssistantPanel'
import type { EditorMode } from '@/lib/wildcardLanguage'
import { useEditorStore } from '@/store/editorStore'

type FileContentResponse = {
  path: string
  name: string
  extension: string
  content: string
  line_count?: number
  size?: number
  modified_at?: string
  writable?: boolean
}

const defaultEditorViewOptions: EditorViewOptions = {
  wordWrap: false,
  minimap: true,
  whitespace: false,
  stickyScroll: true,
}

const editorSessionStorageKey = 'wildcard-editor-session-v1'

type PersistedEditorSession = {
  version: 1
  activePath: string
  tabs: EditorTabState[]
}

function loadEditorViewOptions(): EditorViewOptions {
  try {
    const stored = localStorage.getItem('wildcard-editor-view-options')
    return stored ? { ...defaultEditorViewOptions, ...JSON.parse(stored) } : defaultEditorViewOptions
  } catch {
    return defaultEditorViewOptions
  }
}

function isPersistedTab(value: unknown): value is EditorTabState {
  if (!value || typeof value !== 'object') return false
  const tab = value as Partial<EditorTabState>
  return (
    typeof tab.path === 'string' &&
    typeof tab.name === 'string' &&
    typeof tab.extension === 'string' &&
    typeof tab.content === 'string' &&
    typeof tab.dirty === 'boolean' &&
    (tab.mode === 'impact' || tab.mode === 'forge')
  )
}

function loadEditorSession(): PersistedEditorSession {
  try {
    const stored = localStorage.getItem(editorSessionStorageKey)
    if (!stored) return { version: 1, activePath: '', tabs: [] }
    const parsed = JSON.parse(stored) as Partial<PersistedEditorSession>
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter(isPersistedTab) : []
    const normalizedTabs = tabs.map((tab) => ({ ...tab, path: tab.path.replace(/\\/g, '/') }))
    const activePathVal = parsed.activePath
    const activePath =
      typeof activePathVal === 'string' && normalizedTabs.some((tab) => tab.path === activePathVal.replace(/\\/g, '/'))
        ? activePathVal.replace(/\\/g, '/')
        : normalizedTabs[0]?.path || ''
    return { version: 1, activePath, tabs: normalizedTabs }
  } catch {
    return { version: 1, activePath: '', tabs: [] }
  }
}

function saveEditorSession(tabs: EditorTabState[], activePath: string) {
  try {
    const session: PersistedEditorSession = {
      version: 1,
      activePath: tabs.some((tab) => tab.path === activePath) ? activePath : tabs[0]?.path || '',
      tabs,
    }
    localStorage.setItem(editorSessionStorageKey, JSON.stringify(session))
  } catch {
    // Session restore is a convenience; editor actions still work if browser storage is unavailable.
  }
}

function baseName(path: string) {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

export default function EditorPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const consumeOpenInEditor = useEditorStore((s) => s.consumeOpenInEditor)
  const requestCompareLine = useEditorStore((s) => s.requestCompareLine)
  const restoredSession = useMemo(loadEditorSession, [])
  const [editorTabs, setEditorTabs] = useState<EditorTabState[]>(restoredSession.tabs)
  const [activeEditorPath, setActiveEditorPath] = useState(restoredSession.activePath)
  const [editorViewOptions, setEditorViewOptions] = useState<EditorViewOptions>(loadEditorViewOptions)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(restoredSession.tabs.length ? 'Restored editor session' : 'Ready')

  const activeEditor = useMemo(
    () => editorTabs.find((item) => item.path === activeEditorPath) || null,
    [editorTabs, activeEditorPath],
  )

  const validateMutation = useMutation({
    mutationFn: (prompt: string) => editorApi.validate(prompt),
  })

  const resolveMutation = useMutation({
    mutationFn: (prompt: string) => editorApi.resolve(prompt, 3),
  })

  const openEditor = async (filePath: string, revealLine?: number) => {
    const normalizedPath = filePath.replace(/\\/g, '/')
    const existing = editorTabs.find((item) => item.path.replace(/\\/g, '/') === normalizedPath)
    if (existing) {
      setEditorTabs((current) =>
        current.map((item) =>
          item.path.replace(/\\/g, '/') === normalizedPath ? { ...item, revealLine, revealToken: Date.now() } : item,
        ),
      )
      setActiveEditorPath(existing.path)
      return
    }
    setBusy(true)
    try {
      const response = await api.get<FileContentResponse>('/files/content', { params: { file: normalizedPath } })
      const data = response.data
      const nextTab: EditorTabState = {
        path: data.path.replace(/\\/g, '/'),
        name: data.name || baseName(data.path),
        extension: data.extension || '',
        content: data.content || '',
        dirty: false,
        mode: 'impact',
        revealLine,
        revealToken: Date.now(),
      }
      setEditorTabs((current) => {
        const normalizedCurrent = current.map(item => ({ ...item, path: item.path.replace(/\\/g, '/') }))
        if (normalizedCurrent.some(item => item.path === nextTab.path)) {
          return current.map(item => item.path.replace(/\\/g, '/') === nextTab.path ? { ...item, ...nextTab, path: nextTab.path } : item)
        }
        return [...current, nextTab]
      })
      setActiveEditorPath(nextTab.path)
      setMessage(`Opened ${nextTab.path}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cannot open file')
      toast.error(error instanceof Error ? error.message : 'Cannot open file')
    } finally {
      setBusy(false)
    }
  }

  const saveActiveEditor = async () => {
    if (!activeEditor) return
    setBusy(true)
    try {
      const response = await api.put<FileContentResponse>('/files/content', {
        file: activeEditor.path.replace(/\\/g, '/'),
        content: activeEditor.content,
        backup: true,
      })
      const saved = response.data
      const savedPath = saved.path.replace(/\\/g, '/')
      setEditorTabs((current) =>
        current.map((item) =>
          item.path.replace(/\\/g, '/') === savedPath ? { ...item, content: saved.content, dirty: false } : item,
        ),
      )
      setMessage(`Saved ${savedPath}`)
      toast.success('Saved')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed')
      toast.error(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const exportActiveEditor = () => {
    if (!activeEditor) return
    const url = `/api/files/export?file=${encodeURIComponent(activeEditor.path.replace(/\\/g, '/'))}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const closeEditor = (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/')
    const nextTabs = editorTabs.filter((item) => item.path.replace(/\\/g, '/') !== normalizedPath)
    setEditorTabs(nextTabs)
    if (activeEditorPath.replace(/\\/g, '/') === normalizedPath) {
      setActiveEditorPath(nextTabs[0]?.path || '')
    }
  }

  const updateEditorContent = (filePath: string, content: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/')
    setEditorTabs((current) =>
      current.map((item) => (item.path.replace(/\\/g, '/') === normalizedPath ? { ...item, content, dirty: true, revealLine: undefined } : item)),
    )
  }

  const updateEditorMode = (filePath: string, mode: EditorMode) => {
    const normalizedPath = filePath.replace(/\\/g, '/')
    setEditorTabs((current) => current.map((item) => (item.path.replace(/\\/g, '/') === normalizedPath ? { ...item, mode } : item)))
  }

  const onSendLine = (payload: EditorLinePayload) => {
    requestCompareLine(payload)
    toast.success(`Line ${payload.line_number} sent to comparator`)
    navigate('/comparator', { state: { fromEditorLine: payload } })
  }

  useEffect(() => {
    localStorage.setItem('wildcard-editor-view-options', JSON.stringify(editorViewOptions))
  }, [editorViewOptions])

  useEffect(() => {
    saveEditorSession(editorTabs, activeEditorPath)
  }, [editorTabs, activeEditorPath])

  useEffect(() => {
    const request = consumeOpenInEditor()
    if (request?.file_path) {
      void openEditor(request.file_path, request.line_number)
      return
    }
    const params = new URLSearchParams(location.search)
    const filePath = params.get('file_path')
    const lineNumber = Number(params.get('line_number') || '')
    if (filePath) {
      void openEditor(filePath, Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : undefined)
    }
  }, [location.search])

  return (
    <div className="editor-page-root">
      <div className="editor-toolbar">
        <div className="editor-tab-strip">
          {editorTabs.length === 0 ? <span className="empty-tabs">Open a wildcard from Explorer.</span> : null}
          {editorTabs.map((item) => (
            <button key={item.path} className={`editor-tab ${activeEditorPath === item.path ? 'active' : ''}`} onClick={() => setActiveEditorPath(item.path)}>
              {item.dirty ? '● ' : ''}{item.name}
              <span onClick={(event) => { event.stopPropagation(); closeEditor(item.path) }}><X size={12} /></span>
            </button>
          ))}
        </div>
        <div className="editor-actions">
          <button className="btn-ghost text-xs" onClick={saveActiveEditor} disabled={!activeEditor || busy}>
            {busy ? <Spinner size={12} /> : <Save size={12} />} Save
          </button>
          <button className="btn-ghost text-xs" onClick={exportActiveEditor} disabled={!activeEditor}>
            <Download size={12} /> Export
          </button>
          <button className="btn-ghost text-xs" onClick={() => activeEditor && validateMutation.mutate(activeEditor.content)} disabled={!activeEditor || validateMutation.isPending}>
            {validateMutation.isPending ? <Spinner size={12} /> : <Wand2 size={12} />} Validate
          </button>
          <button className="btn-primary text-xs" onClick={() => activeEditor && resolveMutation.mutate(activeEditor.content)} disabled={!activeEditor || resolveMutation.isPending}>
            {resolveMutation.isPending ? <Spinner size={12} /> : <Wand2 size={12} />} Resolve
          </button>
        </div>
      </div>

      {activeEditor ? (
        <div className="editor-body" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <WildcardEditor
              key={activeEditor.path}
              tab={activeEditor}
              onChange={(content) => updateEditorContent(activeEditor.path, content)}
              onSendLine={onSendLine}
              onModeChange={(mode) => updateEditorMode(activeEditor.path, mode)}
              viewOptions={editorViewOptions}
              onViewOptionsChange={(next) => setEditorViewOptions((current) => ({ ...current, ...next }))}
            />
          </div>
          <AssistantPanel 
            currentContent={activeEditor.content}
            onApply={(text) => updateEditorContent(activeEditor.path, text)}
          />
          {(validateMutation.data || resolveMutation.data) && (
            <aside className="editor-sidepanel">
              {validateMutation.data && (
                <div className="panel-block">
                  <h4>Validation</h4>
                  <p>Style: {validateMutation.data.style}</p>
                  <p>Warnings: {validateMutation.data.warnings.length}</p>
                </div>
              )}
              {resolveMutation.data && (
                <div className="panel-block">
                  <h4>Variants</h4>
                  {resolveMutation.data.variants.map((v, i) => (
                    <button key={i} className="variant-btn" onClick={() => updateEditorContent(activeEditor.path, v)}>Use variant {i + 1}</button>
                  ))}
                </div>
              )}
            </aside>
          )}
        </div>
      ) : (
        <section className="editor-empty">
          <h2>No file open</h2>
          <p>{message}</p>
        </section>
      )}
    </div>
  )
}
