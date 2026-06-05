import type * as Monaco from 'monaco-editor'

export type EditorMode = 'impact' | 'forge'

let registered = false

const sharedTokenizer: Monaco.languages.IMonarchLanguage = {
  defaultToken: 'wildcard-text',
  tokenizer: {
    root: [
      [/^\s*#.*$/, 'wildcard-comment'],
      [/\bBREAK\b/, 'wildcard-special'],
      [/\[(?:ASC|DSC|ASC-SIZE|DSC-SIZE|RND|LAB|CONCAT|SEP|SKIP|STOP|ALL|[A-Za-z][^\]\r\n]{0,32})\]/, 'wildcard-detailer'],
      [/<lora:[^>]+>/, 'wildcard-lora'],
      [/\b(?:LBW|A|B)=[^;]+;/, 'wildcard-lbw'],
      [/__[@~]?[A-Za-z0-9_./* -]+(?:\([^)]*\))?__/, 'wildcard-ref'],
      [/\$\{[^}\r\n]+\}/, 'wildcard-variable'],
      [/\d+(?:\.\d+)?::/, 'wildcard-weight'],
      [/\d+#(?=__)/, 'wildcard-quantifier'],
      [/\d*-\d*\$\$|\d+\$\$|\$\$/, 'wildcard-multiselect'],
      [/[{}]/, 'wildcard-bracket'],
      [/\|/, 'wildcard-pipe'],
      [/^\s*-\s*/, 'wildcard-list'],
      [/^\s*[A-Za-z0-9_ .'"()/-]+(?=\s*:)/, 'wildcard-yaml-key'],
      [/\s+/, 'white'],
      [/[^{}\s|]+/, 'wildcard-text'],
    ],
  },
}

function foldingRanges(model: Monaco.editor.ITextModel): Monaco.languages.FoldingRange[] {
  const ranges: Monaco.languages.FoldingRange[] = []
  const stack: Array<{ indent: number; line: number }> = []
  for (let line = 1; line <= model.getLineCount(); line += 1) {
    const text = model.getLineContent(line)
    if (!text.trim()) continue
    const indent = text.match(/^\s*/)?.[0].length || 0
    while (stack.length && indent <= stack[stack.length - 1].indent) {
      const item = stack.pop()
      if (item && line - 1 > item.line) ranges.push({ start: item.line, end: line - 1 })
    }
    if (/:\s*(?:#.*)?$/.test(text) || /^\s*-\s*[>|]\s*$/.test(text)) stack.push({ indent, line })
  }
  const last = model.getLineCount()
  while (stack.length) {
    const item = stack.pop()
    if (item && last > item.line) ranges.push({ start: item.line, end: last })
  }
  return ranges
}

export function registerWildcardLanguage(monaco: typeof Monaco) {
  if (registered) return
  registered = true

  for (const language of ['wildcard', 'wildcard-yaml']) {
    monaco.languages.register({ id: language })
    monaco.languages.setMonarchTokensProvider(language, sharedTokenizer)
    monaco.languages.registerFoldingRangeProvider(language, { provideFoldingRanges: foldingRanges })
  }

  monaco.editor.defineTheme('wildcard-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'wildcard-comment', foreground: '5ecf68' },
      { token: 'wildcard-yaml-key', foreground: '4aa3ff', fontStyle: 'bold' },
      { token: 'wildcard-list', foreground: 'b8c7dc' },
      { token: 'wildcard-text', foreground: 'f5a97f' },
      { token: 'wildcard-ref', foreground: 'ffd166', fontStyle: 'bold' },
      { token: 'wildcard-variable', foreground: 'c792ea' },
      { token: 'wildcard-lora', foreground: '82aaff' },
      { token: 'wildcard-lbw', foreground: 'ffcb6b' },
      { token: 'wildcard-special', foreground: 'ff5370', fontStyle: 'bold' },
      { token: 'wildcard-detailer', foreground: '89ddff' },
      { token: 'wildcard-weight', foreground: 'f78c6c' },
      { token: 'wildcard-quantifier', foreground: 'f78c6c' },
      { token: 'wildcard-multiselect', foreground: 'c3e88d' },
      { token: 'wildcard-bracket', foreground: 'd7ba7d' },
      { token: 'wildcard-pipe', foreground: 'b8c7dc' },
    ],
    colors: {
      'editor.background': '#111317',
      'editor.foreground': '#f5a97f',
      'editorLineNumber.foreground': '#8b949e',
      'editorLineNumber.activeForeground': '#e6edf3',
      'editor.selectionBackground': '#264f78',
      'editor.lineHighlightBackground': '#171b22',
      'editorGutter.background': '#0f1318',
      'editorIndentGuide.background1': '#2a3342',
      'editorIndentGuide.activeBackground1': '#4c5c72',
    },
  })
}

function addMarker(
  markers: Monaco.editor.IMarkerData[],
  line: number,
  message: string,
  severity: Monaco.MarkerSeverity,
) {
  markers.push({
    severity,
    message,
    startLineNumber: line,
    startColumn: 1,
    endLineNumber: line,
    endColumn: 200,
  })
}

export function updateWildcardMarkers(monaco: typeof Monaco, model: Monaco.editor.ITextModel, mode: EditorMode) {
  const text = model.getValue()
  const markers: Monaco.editor.IMarkerData[] = []
  const lines = text.split(/\r?\n/)
  const openBraces = (text.match(/\{/g) || []).length
  const closeBraces = (text.match(/\}/g) || []).length
  const doubleUnderscores = (text.match(/__/g) || []).length

  if (openBraces !== closeBraces) {
    addMarker(markers, 1, 'Unbalanced variant braces: check { ... | ... } blocks.', monaco.MarkerSeverity.Warning)
  }
  if (doubleUnderscores % 2 !== 0) {
    addMarker(markers, 1, 'Unbalanced wildcard marker: expected pairs like __name__.', monaco.MarkerSeverity.Warning)
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    if (/\{\s*\d+(?:\.\d+)?:[^:|}]/.test(line)) {
      addMarker(markers, lineNumber, 'Use modern weight syntax n::value instead of n:value.', monaco.MarkerSeverity.Warning)
    }
    if (mode === 'impact' && /\$\{[^}]+}/.test(line)) {
      addMarker(markers, lineNumber, 'Forge/Dynamic Prompts variable syntax is not part of Impact mode.', monaco.MarkerSeverity.Info)
    }
    if (mode === 'forge' && /\b(?:LBW=|BREAK\b|\[SEP]|\[SKIP]|\[STOP])/.test(line)) {
      addMarker(markers, lineNumber, 'This is ComfyUI Impact-specific syntax; keep Forge mode only if intentional.', monaco.MarkerSeverity.Info)
    }
  })

  monaco.editor.setModelMarkers(model, 'wildcard-rules', markers)
}

export const modeNotes: Record<EditorMode, string[]> = {
  impact: [
    'Impact: __folder/name__, nested {a|b}, weights n::, multi-select $$, glob *, quantifier count#wildcard.',
    'Special Impact tokens: <lora:name:model:clip>, LBW=...;, BREAK, [ASC]/[SEP]/[SKIP]/[STOP].',
  ],
  forge: [
    'Forge/Dynamic Prompts: shared variants, weights, multi-select, wildcards and globbing.',
    'Forge extras: ${var=value}, ${var:default}, __template(arg=value)__, sampler prefixes ~ and @.',
  ],
}
