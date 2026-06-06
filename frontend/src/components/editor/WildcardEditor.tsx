import Editor, { type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { useEffect, useMemo, useRef } from 'react'
import { EditorMode, modeNotes, registerWildcardLanguage, updateWildcardMarkers } from '@/lib/wildcardLanguage'
import { useEditorStore } from '@/store/editorStore'

export type EditorViewOptions = {
  wordWrap: boolean
  minimap: boolean
  whitespace: boolean
  stickyScroll: boolean
}

export type EditorTabState = {
  path: string
  name: string
  extension: string
  content: string
  dirty: boolean
  mode: EditorMode
  revealLine?: number
  revealToken?: number
}

export type EditorLinePayload = {
  file_path: string
  line_number: number
  raw: string
}

function languageFor(path: string) {
  return /\.(ya?ml)$/i.test(path) ? 'wildcard-yaml' : 'wildcard'
}

export default function WildcardEditor({
  tab,
  onChange,
  onSendLine,
  onSendToImageGeneration,
  onModeChange,
  viewOptions,
  onViewOptionsChange,
}: {
  tab: EditorTabState
  onChange: (content: string) => void
  onSendLine: (payload: EditorLinePayload) => void
  onSendToImageGeneration: (prompt: string) => void
  onModeChange: (mode: EditorMode) => void
  viewOptions: EditorViewOptions
  onViewOptionsChange: (next: Partial<EditorViewOptions>) => void
}) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const targetDecorationsRef = useRef<string[]>([])
  const language = useMemo(() => languageFor(tab.path), [tab.path])

  const pendingInsertText = useEditorStore((s) => s.pendingInsertText)
  const consumeInsertText = useEditorStore((s) => s.consumeInsertText)

  useEffect(() => {
    useEditorStore.getState().setSelectedText('')
  }, [tab.path])

  useEffect(() => {
    if (pendingInsertText) {
      const editor = editorRef.current
      if (editor) {
        const selection = editor.getSelection()
        const text = consumeInsertText()
        if (text !== null) {
          if (selection && !selection.isEmpty()) {
            editor.executeEdits('assistant', [{
              range: selection,
              text: text,
              forceMoveMarkers: true
            }])
          } else {
            const model = editor.getModel()
            if (model) {
              editor.executeEdits('assistant', [{
                range: model.getFullModelRange(),
                text: text,
                forceMoveMarkers: true
              }])
            }
          }
          editor.focus()
        }
      }
    }
  }, [pendingInsertText, consumeInsertText])

  const revealAndSelectLine = (lineNumber?: number) => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    if (!lineNumber) {
      targetDecorationsRef.current = editor.deltaDecorations(targetDecorationsRef.current, [])
      return
    }
    const safeLine = Math.max(1, Math.min(lineNumber, model.getLineCount()))
    const endColumn = model.getLineMaxColumn(safeLine)
    editor.revealLineInCenter(safeLine)
    editor.setSelection({ startLineNumber: safeLine, startColumn: 1, endLineNumber: safeLine, endColumn })
    editor.setPosition({ lineNumber: safeLine, column: 1 })
    if (monaco) {
      targetDecorationsRef.current = editor.deltaDecorations(targetDecorationsRef.current, [{
        range: new monaco.Range(safeLine, 1, safeLine, endColumn),
        options: { isWholeLine: true, className: 'target-line-decoration' },
      }])
    }
    editor.focus()
  }

  const sendSelectedOrActiveLine = () => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    const selection = editor.getSelection()
    if (!model || !selection) return
    const start = selection.startLineNumber
    const end = selection.endLineNumber
    const raw = Array.from({ length: end - start + 1 }, (_, o) => model.getLineContent(start + o)).join('\n').trim()
    if (raw) onSendLine({ file_path: tab.path, line_number: start, raw })
  }

  const sendSelectedOrActiveLineToImageGeneration = () => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    const selection = editor.getSelection()
    if (!model || !selection) return
    const start = selection.startLineNumber
    const end = selection.endLineNumber
    const raw = Array.from({ length: end - start + 1 }, (_, o) => model.getLineContent(start + o)).join('\n').trim()
    if (raw) onSendToImageGeneration(raw)
  }

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    registerWildcardLanguage(monaco)
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection()
      if (selection) {
        const model = editor.getModel()
        if (model) {
          const text = model.getValueInRange(selection)
          useEditorStore.getState().setSelectedText(text)
        }
      }
    })
    editor.addAction({
      id: 'send-wildcard-line-to-comparer',
      label: 'Send line to comparer',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: sendSelectedOrActiveLine,
    })
    editor.addAction({
      id: 'send-wildcard-line-to-image-generation',
      label: 'Send prompt to Image Generator',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.6,
      run: sendSelectedOrActiveLineToImageGeneration,
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, sendSelectedOrActiveLine)
    updateWildcardMarkers(monaco, editor.getModel()!, tab.mode)
    window.setTimeout(() => revealAndSelectLine(tab.revealLine), 0)
  }

  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel()
    if (!editor || !monaco || !model) return
    updateWildcardMarkers(monaco, model, tab.mode)
  }, [tab.content, tab.mode])

  useEffect(() => {
    window.setTimeout(() => revealAndSelectLine(tab.revealLine), 0)
  }, [tab.revealLine, tab.revealToken, tab.path])

  return (
    <div className="vscode-editor-shell">
      <div className="editor-mode-bar">
        <div className="editor-file-status">
          <strong>{tab.path}</strong>
          <span>{tab.dirty ? 'Unsaved changes' : 'Saved'}</span>
        </div>
        <label>
          Mode
          <select value={tab.mode} onChange={(event) => onModeChange(event.target.value as EditorMode)}>
            <option value="impact">ComfyUI Impact</option>
            <option value="forge">SD Forge / Dynamic Prompts</option>
          </select>
        </label>
        <div className="editor-option-switches">
          <label className="switch-row"><input type="checkbox" checked={viewOptions.wordWrap} onChange={(e) => onViewOptionsChange({ wordWrap: e.target.checked })} />Word Wrap</label>
          <label className="switch-row"><input type="checkbox" checked={viewOptions.minimap} onChange={(e) => onViewOptionsChange({ minimap: e.target.checked })} />Minimap</label>
          <label className="switch-row"><input type="checkbox" checked={viewOptions.whitespace} onChange={(e) => onViewOptionsChange({ whitespace: e.target.checked })} />Espaces</label>
          <label className="switch-row"><input type="checkbox" checked={viewOptions.stickyScroll} onChange={(e) => onViewOptionsChange({ stickyScroll: e.target.checked })} />Sticky</label>
        </div>
      </div>
      <Editor
        beforeMount={registerWildcardLanguage}
        height="100%"
        language={language}
        theme="wildcard-dark"
        value={tab.content}
        onChange={(value) => onChange(value || '')}
        onMount={handleMount}
        wrapperProps={{ className: 'editor-monaco-wrapper' }}
        options={{
          automaticLayout: true,
          contextmenu: true,
          glyphMargin: true,
          minimap: { enabled: viewOptions.minimap, side: 'right' },
          renderWhitespace: viewOptions.whitespace ? 'all' : 'selection',
          stickyScroll: { enabled: viewOptions.stickyScroll },
          wordWrap: viewOptions.wordWrap ? 'on' : 'off',
          smoothScrolling: true,
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: "JetBrains Mono, Consolas, 'Courier New', monospace",
        }}
      />
      <div className="editor-rules">
        {modeNotes[tab.mode].map((note) => <span key={note}>{note}</span>)}
      </div>
    </div>
  )
}
