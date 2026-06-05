# Wildcard Processing & Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement recursive server-side wildcard and brace variant resolution, integrate it into the Image Generation page for live preview and generation, build an interactive wildcard tester in the Generator page, and implement three UX improvements (Autocomplete, Syntax Highlighting, and Batch Processing).

**Architecture:** Create a backend wildcard processor service that resolves `__wildcard__` and `{option1|option2}` choices recursively, expose a `/generator/process-prompt` endpoint, update `/generation/txt2img` to resolve wildcards before calling connectors, build a reusable `PromptEditor` React component supporting autocomplete and overlay syntax highlighting, and add tabs + tester in `GeneratorPage.tsx` and live previews in `ImageGenerationPage.tsx`.

**Tech Stack:** Python 3, FastAPI, SQLModel, React, TypeScript, TailwindCSS, Lucide React

---

### Task 1: Backend Wildcard Processor Service

**Files:**
- Create: `backend/services/wildcard_processor.py`
- Create: `backend/tests/test_wildcard_processor.py`

- [ ] **Step 1: Create the wildcard processor service**
  Create `backend/services/wildcard_processor.py` containing recursive wildcard resolving and curly braces selection logic:

```python
import os
import re
import random
from typing import List
from sqlmodel import Session, select
from models.wildcard import WildcardFile, WildcardEntry

WILDCARD_PATTERN = re.compile(r"__([A-Za-z0-9_./\\-]+)__")
BRACE_PATTERN = re.compile(r"\{([^{}]+)\}")

def resolve_wildcard(session: Session, wildcard_name: str) -> str:
    name_clean = wildcard_name.strip().lower().replace("\\", "/")
    
    # Query all WildcardFiles to find the best match
    files = session.exec(select(WildcardFile)).all()
    matching_file = None
    
    # 1. Exact relative path match without extension
    for f in files:
        path_no_ext, _ = os.path.splitext(f.path.lower())
        if path_no_ext == name_clean:
            matching_file = f
            break
            
    # 2. Filename match without extension
    if not matching_file:
        for f in files:
            filename_no_ext, _ = os.path.splitext(f.filename.lower())
            if filename_no_ext == name_clean:
                matching_file = f
                break
                
    # 3. Partial path match
    if not matching_file:
        for f in files:
            if name_clean in f.path.lower():
                matching_file = f
                break
                
    if not matching_file:
        # Keep original reference if not found
        return f"__{wildcard_name}__"
        
    # Query all entries for this file
    entries = session.exec(
        select(WildcardEntry).where(WildcardEntry.file_id == matching_file.id)
    ).all()
    
    if not entries:
        return ""
        
    weights = [e.weight for e in entries]
    total_weight = sum(weights)
    if total_weight <= 0:
        weights = [1.0] * len(entries)
        
    chosen = random.choices(entries, weights=weights, k=1)[0]
    return chosen.content

def resolve_braces(text: str) -> str:
    iterations = 0
    while iterations < 100:
        match = BRACE_PATTERN.search(text)
        if not match:
            break
        inner = match.group(1)
        separator = ", "
        count_val = 1
        
        parts = inner.split("$$", 1)
        if len(parts) == 2:
            prefix, options_str = parts
            options = options_str.split("|")
            if "-" in prefix:
                try:
                    low, high = map(int, prefix.split("-"))
                    count_val = random.randint(low, high)
                except ValueError:
                    count_val = 1
            else:
                try:
                    count_val = int(prefix)
                except ValueError:
                    count_val = 1
        else:
            options = inner.split("|")
            
        if not options:
            replacement = ""
        else:
            count_val = min(count_val, len(options))
            chosen = random.sample(options, count_val) if count_val > 1 else [random.choice(options)]
            replacement = separator.join(chosen)
            
        text = text[:match.start()] + replacement + text[match.end():]
        iterations += 1
        
    return text

def process_prompt(session: Session, prompt: str, max_depth: int = 5) -> str:
    current_prompt = prompt
    for _ in range(max_depth):
        has_changes = False
        
        # 1. Resolve wildcards
        matches = list(WILDCARD_PATTERN.finditer(current_prompt))
        if matches:
            for match in reversed(matches):
                wildcard_name = match.group(1)
                replacement = resolve_wildcard(session, wildcard_name)
                current_prompt = current_prompt[:match.start()] + replacement + current_prompt[match.end():]
            has_changes = True
            
        # 2. Resolve braces
        if "{" in current_prompt and "}" in current_prompt:
            before = current_prompt
            current_prompt = resolve_braces(current_prompt)
            if current_prompt != before:
                has_changes = True
                
        if not has_changes:
            break
            
    return current_prompt
```

- [ ] **Step 2: Create unit tests for the processor**
  Create `backend/tests/test_wildcard_processor.py` to test simple resolution, braces selection, nested variables, and DB wildcards:

```python
import pytest
from sqlmodel import Session
from models.wildcard import WildcardFile, WildcardEntry
from services.wildcard_processor import process_prompt, resolve_braces

def test_resolve_braces_simple():
    res = resolve_braces("A {red|red} cat")
    assert res == "A red cat"

def test_resolve_braces_range():
    res = resolve_braces("{2$$red|red}")
    assert res == "red, red"

def test_process_prompt_with_db(session: Session):
    wf = WildcardFile(path="colors.yaml", filename="colors.yaml", format="impact", entry_count=2)
    session.add(wf)
    session.flush()
    
    session.add(WildcardEntry(file_id=wf.id, content="blue", weight=1.0))
    session.add(WildcardEntry(file_id=wf.id, content="green", weight=0.0))
    session.commit()
    
    res = process_prompt(session, "A __colors__ shirt")
    assert res == "A blue shirt"
```

- [ ] **Step 3: Run pytest on the new tests**
  Run: `pytest backend/tests/test_wildcard_processor.py -v`
  Expected: tests PASS.

- [ ] **Step 4: Commit**
  Run:
  ```bash
  git add backend/services/wildcard_processor.py backend/tests/test_wildcard_processor.py
  git commit -m "feat: implement wildcard processor service and tests"
  ```

---

### Task 2: Backend API Router Integration

**Files:**
- Modify: `backend/routers/generator.py`
- Modify: `backend/routers/generation.py`
- Create: `backend/tests/test_wildcard_routes.py`

- [ ] **Step 1: Add prompt-processing route to generator router**
  Add `ProcessPromptRequest` and the new endpoint `POST /process-prompt` to `backend/routers/generator.py`:

```python
# Add imports at the top
from services.wildcard_processor import process_prompt

class ProcessPromptRequest(BaseModel):
    prompt: str
    count: int = 1

# Add endpoint to generator.py router
@router.post("/process-prompt")
def process_prompt_endpoint(req: ProcessPromptRequest, session: Session = Depends(get_session)):
    """Resolve wildcards and curly braces in the given prompt."""
    results = []
    for _ in range(req.count):
        results.append(process_prompt(session, req.prompt))
    return {"original": req.prompt, "processed": results}
```

- [ ] **Step 2: Add wildcard resolution to txt2img generation router**
  Modify `backend/routers/generation.py` inside the `txt2img` function to resolve wildcards before calling ComfyUI or SD-Forge:

```python
# Add import at the top of backend/routers/generation.py
from services.wildcard_processor import process_prompt

# Inside txt2img function (around line 74):
    # Retrieve body prompt and resolve wildcards
    original_prompt = body.prompt
    processed_prompt = process_prompt(session, original_prompt)
    
    request_data = body.model_dump()
    request_data["prompt"] = processed_prompt # Use processed prompt for connector call
    provider = request_data["provider"]
    base_url = generation_connector.normalize_base_url(provider, request_data.get("base_url"))
```
  Also update `GenerationHistory` database record insertion (around line 82) to record the original prompt and store the processed prompt in the metadata:
```python
        record = GenerationHistory(
            provider=provider,
            base_url=base_url,
            prompt=original_prompt, # Keep original wildcard prompt in main column
            negative_prompt=body.negative_prompt,
            # ... keep other fields ...
            metadata_json=json.dumps(
                {
                    "request": _public_request_metadata(request_data, base_url),
                    "response": _public_response_metadata(connector_response),
                    "processed_prompt": processed_prompt, # Add processed prompt here
                }
            ),
            status="completed",
            created_at=utc_now(),
        )
```

- [ ] **Step 3: Write route integration tests**
  Create `backend/tests/test_wildcard_routes.py` using `TestClient` to verify the routes:

```python
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

from database import get_session
from models.wildcard import WildcardFile, WildcardEntry
from routers import generator as generator_router
from fastapi import FastAPI

def test_process_prompt_endpoint(tmp_path: Path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    
    def override_session():
        with Session(engine) as session:
            yield session
            
    app = FastAPI()
    app.dependency_overrides[get_session] = override_session
    app.include_router(generator_router.router, prefix="/generator")
    client = TestClient(app)
    
    # Seed
    with Session(engine) as session:
        wf = WildcardFile(path="outfits.txt", filename="outfits.txt", format="impact", entry_count=1)
        session.add(wf)
        session.flush()
        session.add(WildcardEntry(file_id=wf.id, content="maid uniform", weight=1.0))
        session.commit()
        
    resp = client.post("/generator/process-prompt", json={"prompt": "wearing a __outfits__", "count": 2})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["processed"] == ["wearing a maid uniform", "wearing a maid uniform"]
```

- [ ] **Step 4: Run route tests**
  Run: `pytest backend/tests/test_wildcard_routes.py -v`
  Expected: tests PASS.

- [ ] **Step 5: Commit changes**
  Run:
  ```bash
  git add backend/routers/generator.py backend/routers/generation.py backend/tests/test_wildcard_routes.py
  git commit -m "feat: expose process-prompt route and resolve wildcards in txt2img"
  ```

---

### Task 3: Reusable Frontend PromptEditor with Autocomplete & Highlight

**Files:**
- Create: `frontend/src/components/shared/PromptEditor.tsx`

- [ ] **Step 1: Write the PromptEditor component**
  Create `frontend/src/components/shared/PromptEditor.tsx` containing autocomplete suggestion logic and text editor overlay:

```tsx
import React, { useState, useEffect, useRef } from 'react'
import { explorerApi } from '@/api/explorer'

interface PromptEditorProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  className?: string
  rows?: number
}

export default function PromptEditor({ value, onChange, placeholder = '', className = '', rows = 4 }: PromptEditorProps) {
  const [wildcards, setWildcards] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [cursorPosition, setCursorPosition] = useState(0)
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    explorerApi.getTree().then((tree) => {
      const list: string[] = []
      const traverse = (node: any) => {
        if (node.type === 'file') {
          const cleanPath = node.path.replace(/\.(yaml|yml|txt)$/i, '')
          list.push(cleanPath)
          const nameNoExt = node.name.replace(/\.(yaml|yml|txt)$/i, '')
          if (!list.includes(nameNoExt)) {
            list.push(nameNoExt)
          }
        }
        if (node.children) {
          node.children.forEach(traverse)
        }
      }
      traverse(tree)
      setWildcards(list.sort())
    }).catch(() => {})
  }, [])
  
  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }
  
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    onChange(val)
    
    const pos = e.target.selectionStart
    setCursorPosition(pos)
    
    const textBeforeCursor = val.substring(0, pos)
    const lastDoubleUnder = textBeforeCursor.lastIndexOf('__')
    
    if (lastDoubleUnder !== -1 && lastDoubleUnder >= textBeforeCursor.length - 20) {
      const searchWord = textBeforeCursor.substring(lastDoubleUnder + 2)
      if (!searchWord.includes(' ') && !searchWord.includes('\n') && !searchWord.includes('__')) {
        const filtered = wildcards.filter((w) => w.toLowerCase().includes(searchWord.toLowerCase()))
        setSuggestions(filtered)
        setSuggestionIndex(0)
        setShowSuggestions(filtered.length > 0)
        return
      }
    }
    setShowSuggestions(false)
  }
  
  const insertSuggestion = (suggestion: string) => {
    if (!textareaRef.current) return
    const val = value
    const pos = cursorPosition
    const textBeforeCursor = val.substring(0, pos)
    const lastDoubleUnder = textBeforeCursor.lastIndexOf('__')
    
    if (lastDoubleUnder !== -1) {
      const newVal = val.substring(0, lastDoubleUnder) + `__${suggestion}__` + val.substring(pos)
      onChange(newVal)
      setShowSuggestions(false)
      
      const newPos = lastDoubleUnder + suggestion.length + 4
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(newPos, newPos)
        }
      }, 50)
    }
  }
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSuggestionIndex((prev) => (prev + 1) % suggestions.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertSuggestion(suggestions[suggestionIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setShowSuggestions(false)
      }
    }
  }
  
  const renderHighlightedText = () => {
    if (!value) return <span className="text-gray-600">{placeholder}</span>
    
    const parts: React.ReactNode[] = []
    let lastIdx = 0
    const regex = /(__[A-Za-z0-9_./\\-]+__|\{[^{}]+\})/g
    let match
    
    while ((match = regex.exec(value)) !== null) {
      const matchIdx = match.index
      const matchText = match[0]
      
      if (matchIdx > lastIdx) {
        parts.push(value.substring(lastIdx, matchIdx))
      }
      
      if (matchText.startsWith('__') && matchText.endsWith('__')) {
        parts.push(
          <span key={matchIdx} className="text-studio-accent font-semibold bg-studio-accent/10 px-0.5 rounded">
            {matchText}
          </span>
        )
      } else {
        parts.push(
          <span key={matchIdx} className="text-orange-400 font-medium bg-orange-400/10 px-0.5 rounded">
            {matchText}
          </span>
        )
      }
      
      lastIdx = regex.lastIndex
    }
    
    if (lastIdx < value.length) {
      parts.push(value.substring(lastIdx))
    }
    
    return parts
  }
  
  return (
    <div className={`relative ${className} w-full`} style={{ minHeight: `${rows * 24}px` }}>
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none border border-transparent font-mono text-xs select-none overflow-y-auto overflow-x-hidden p-3.5 whitespace-pre-wrap break-words leading-relaxed text-gray-500 w-full h-full"
        style={{
          fontFamily: 'monospace',
          borderWidth: '1px',
          boxSizing: 'border-box',
          minHeight: 'inherit',
        }}
      >
        {renderHighlightedText()}
      </div>
      
      {/* Transparent Textarea */}
      <textarea
        ref={textareaRef}
        className="input w-full bg-transparent font-mono text-xs leading-relaxed resize-y relative z-10 focus:outline-none placeholder-transparent text-transparent caret-white"
        style={{
          fontFamily: 'monospace',
          color: 'transparent',
          caretColor: 'white',
          boxSizing: 'border-box',
          minHeight: 'inherit',
        }}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
      />
      
      {/* Suggestions Overlay */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute left-4 z-50 mt-1 max-h-48 w-64 overflow-y-auto rounded-md border border-studio-border bg-studio-surface shadow-lg">
          {suggestions.map((s, idx) => (
            <button
              key={s}
              onClick={() => insertSuggestion(s)}
              className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors ${
                idx === suggestionIndex ? 'bg-studio-accent/20 text-studio-accent-glow font-bold' : 'text-gray-400 hover:bg-studio-elevated hover:text-white'
              }`}
            >
              __{s}__
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build verification**
  Run: `npm run build` inside `frontend` directory.
  Expected: Passes without compilation issues.

- [ ] **Step 3: Commit changes**
  Run:
  ```bash
  git add frontend/src/components/shared/PromptEditor.tsx
  git commit -m "feat: add reusable PromptEditor component with syntax highlighting and autocomplete"
  ```

---

### Task 4: Redesign GeneratorPage with Wildcard Tester

**Files:**
- Modify: `frontend/src/api/generator.ts`
- Modify: `frontend/src/pages/GeneratorPage.tsx`

- [ ] **Step 1: Add processPrompt client function to generator api client**
  Modify `frontend/src/api/generator.ts` to include `processPrompt` API method:

```typescript
// Add processPrompt method inside generatorApi object:
  processPrompt: (prompt: string, count = 1) =>
    api.post<{ original: string; processed: string[] }>(
      '/generator/process-prompt', { prompt, count }
    ).then((r) => r.data),
```

- [ ] **Step 2: Refactor GeneratorPage to support Creator vs Tester tabs**
  Modify `frontend/src/pages/GeneratorPage.tsx`. Split the page using a tab selector state (`activeTab: 'create' | 'test'`), implement wildcard detection, show existing/missing tags, and add multiple variation output with copy handles:

```tsx
import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus, Trash2, Wand2, Download, Copy, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import { generatorApi } from '@/api/generator'
import Spinner from '@/components/shared/Spinner'
import { useTagStore } from '@/store/tagStore'
import PromptEditor from '@/components/shared/PromptEditor'
import { explorerApi } from '@/api/explorer'

export default function GeneratorPage() {
  const [activeTab, setActiveTab] = useState<'create' | 'test'>('create')
  
  // Existing Generator State
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [format, setFormat] = useState<'impact' | 'dynamic_prompts'>('impact')
  const [style, setStyle] = useState<'tag' | 'nl'>('tag')
  const [entries, setEntries] = useState<string[]>([''])

  // Tester State
  const [testPrompt, setTestPrompt] = useState('')
  const [testCount, setTestCount] = useState(3)
  const [wildcardFilesList, setWildcardFilesList] = useState<string[]>([])
  
  const pendingPromptForGenerator = useTagStore((s) => s.pendingPromptForGenerator)
  const clearPendingPrompt = useTagStore((s) => s.clearPendingPrompt)

  useEffect(() => {
    if (pendingPromptForGenerator) {
      setEntries((prev) => {
        if (prev.length === 1 && prev[0] === '') {
          return [pendingPromptForGenerator]
        }
        const cleaned = [...prev]
        while (cleaned.length > 0 && cleaned[cleaned.length - 1] === '') {
          cleaned.pop()
        }
        return [...cleaned, pendingPromptForGenerator]
      })
      toast.success('Prompt importé depuis le gestionnaire de tags !')
      clearPendingPrompt()
    }
  }, [pendingPromptForGenerator, clearPendingPrompt])

  // Fetch wildcard names list on mount for existence analysis in tester
  useEffect(() => {
    explorerApi.getTree().then((tree) => {
      const list: string[] = []
      const traverse = (node: any) => {
        if (node.type === 'file') {
          const cleanPath = node.path.replace(/\.(yaml|yml|txt)$/i, '').toLowerCase()
          list.push(cleanPath)
          const nameNoExt = node.name.replace(/\.(yaml|yml|txt)$/i, '').toLowerCase()
          if (!list.includes(nameNoExt)) {
            list.push(nameNoExt)
          }
        }
        if (node.children) {
          node.children.forEach(traverse)
        }
      }
      traverse(tree)
      setWildcardFilesList(list)
    }).catch(() => {})
  }, [activeTab])

  const previewMutation = useMutation({
    mutationFn: () => generatorApi.preview({ name, format, style, entries: entries.filter(Boolean) }),
  })

  const createMutation = useMutation({
    mutationFn: () => generatorApi.create({ name, format, style, entries: entries.filter(Boolean), target_folder: folder }),
    onSuccess: (d) => toast.success(`Créé : ${d.path} (${d.entry_count} entrées)`),
    onError: (e: Error) => toast.error(e.message),
  })

  const testMutation = useMutation({
    mutationFn: () => generatorApi.processPrompt(testPrompt, testCount),
    onSuccess: () => toast.success('Prompt traité avec succès !'),
    onError: (e: Error) => toast.error(e.message),
  })

  const addEntry = () => setEntries((e) => [...e, ''])
  const setEntry = (i: number, v: string) => setEntries((e) => e.map((x, j) => j === i ? v : x))
  const removeEntry = (i: number) => setEntries((e) => e.filter((_, j) => j !== i))

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Texte copié !')
  }

  // Detect wildcards in test prompt
  const detectedWildcards = Array.from(testPrompt.matchAll(/__([A-Za-z0-9_./\\-]+)__/g)).map(m => m[1])
  const uniqueWildcards = Array.from(new Set(detectedWildcards))

  return (
    <div className="flex flex-col h-full p-5 gap-4">
      {/* Segmented control tabs */}
      <div className="flex border-b border-studio-border pb-2 shrink-0">
        <button
          onClick={() => setActiveTab('create')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'create'
              ? 'border-studio-accent text-studio-accent-glow'
              : 'border-transparent text-gray-500 hover:text-white'
          }`}
        >
          Créateur de Wildcard
        </button>
        <button
          onClick={() => setActiveTab('test')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'test'
              ? 'border-studio-accent text-studio-accent-glow'
              : 'border-transparent text-gray-500 hover:text-white'
          }`}
        >
          Testeur de Wildcards
        </button>
      </div>

      {activeTab === 'create' ? (
        <div className="flex-1 flex gap-5 min-h-0">
          {/* Form */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">Nom du wildcard *</label>
                <input className="input" placeholder="lighting_styles" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">Dossier cible</label>
                <input className="input" placeholder="comfyui/" value={folder} onChange={(e) => setFolder(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">Format</label>
                <div className="flex rounded-md border border-studio-border overflow-hidden bg-studio-surface">
                  {([['impact', 'Impact (ComfyUI)'], ['dynamic_prompts', 'Dynamic Prompts']] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setFormat(v)}
                      className={`px-3 py-1.5 text-xs transition-colors ${format === v ? 'bg-studio-accent/20 text-studio-accent-glow font-bold' : 'text-gray-500 hover:text-white'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">Style des entrées</label>
                <div className="flex rounded-md border border-studio-border overflow-hidden bg-studio-surface">
                  {([['tag', 'TAG / Booru'], ['nl', 'Natural Language']] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setStyle(v)}
                      className={`px-3 py-1.5 text-xs transition-colors ${style === v ? 'bg-studio-accent/20 text-studio-accent-glow font-bold' : 'text-gray-500 hover:text-white'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Entries */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-500 font-semibold">Entrées ({entries.filter(Boolean).length})</label>
                <button className="btn-ghost text-xs" onClick={addEntry}><Plus size={12} /> Ajouter</button>
              </div>
              {entries.map((entry, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    className="input flex-1 font-mono text-xs"
                    placeholder={style === 'tag' ? 'dramatic side lighting, shadows' : 'A warm golden sunset glow…'}
                    value={entry}
                    onChange={(e) => setEntry(i, e.target.value)}
                  />
                  <button className="text-gray-600 hover:text-studio-danger transition-colors" onClick={() => removeEntry(i)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3 shrink-0">
              <button
                className="btn-ghost"
                onClick={() => previewMutation.mutate()}
                disabled={!name.trim() || entries.filter(Boolean).length === 0 || previewMutation.isPending}
              >
                {previewMutation.isPending ? <Spinner size={12} /> : <Wand2 size={12} />}
                Aperçu
              </button>
              <button
                className="btn-primary flex-1 justify-center"
                onClick={() => createMutation.mutate()}
                disabled={!name.trim() || entries.filter(Boolean).length === 0 || createMutation.isPending}
              >
                {createMutation.isPending ? <Spinner size={14} /> : <Download size={14} />}
                Créer le fichier
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="w-96 card flex flex-col shrink-0">
            <div className="px-4 py-3 border-b border-studio-border bg-studio-surface/60">
              <span className="text-xs text-gray-500 font-mono uppercase tracking-wider font-semibold">Aperçu fichier</span>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-studio-bg">
              {previewMutation.data ? (
                <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap leading-relaxed">
                  {previewMutation.data.preview}
                </pre>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm">
                  <Wand2 size={24} className="mb-2 opacity-30" />
                  Cliquez sur Aperçu pour voir le fichier généré
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* TESTER TAB */
        <div className="flex-1 flex gap-5 min-h-0">
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-semibold">Modèle de prompt à tester</label>
              <PromptEditor
                value={testPrompt}
                onChange={setTestPrompt}
                placeholder="A __subject__ wearing a {red|blue} shirt, __lighting_style__"
                rows={5}
                className="card border border-studio-border"
              />
            </div>

            <div className="flex gap-4 items-end">
              <div className="w-32">
                <label className="text-xs text-gray-500 mb-1 block font-semibold">Variations</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={10}
                  value={testCount}
                  onChange={(e) => setTestCount(Math.max(1, Math.min(10, Number(e.target.value))))}
                />
              </div>
              <button
                className="btn-primary flex-1 justify-center h-10"
                onClick={() => testMutation.mutate()}
                disabled={!testPrompt.trim() || testMutation.isPending}
              >
                {testMutation.isPending ? <Spinner size={14} /> : <Play size={14} />}
                Générer les variations
              </button>
            </div>

            {/* Analysis card for detected wildcards */}
            {uniqueWildcards.length > 0 && (
              <div className="card p-3 space-y-2">
                <p className="text-xs text-gray-500 font-semibold font-mono uppercase tracking-wide">Wildcards détectés</p>
                <div className="flex flex-wrap gap-2">
                  {uniqueWildcards.map((wc) => {
                    const exists = wildcardFilesList.includes(wc.toLowerCase())
                    return (
                      <span key={wc} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border ${
                        exists ? 'bg-studio-success/10 border-studio-success/30 text-studio-success' : 'bg-studio-danger/10 border-studio-danger/30 text-studio-danger'
                      }`}>
                        <span>{exists ? '🟢' : '🔴'}</span>
                        <span className="font-mono">{wc}</span>
                        <span className="text-[10px] opacity-75">({exists ? 'Indexé' : 'Inconnu'})</span>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Results Panel */}
          <div className="w-96 card flex flex-col shrink-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-studio-border bg-studio-surface/60 flex items-center justify-between">
              <span className="text-xs text-gray-500 font-mono uppercase tracking-wider font-semibold">Résultats ({testMutation.data?.processed.length || 0})</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-studio-bg">
              {testMutation.data ? (
                testMutation.data.processed.map((p, idx) => (
                  <div key={idx} className="p-3 bg-studio-elevated/40 border border-studio-border rounded-lg flex flex-col gap-2 group hover:border-studio-muted transition-colors">
                    <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono">
                      <span>Variation #{idx + 1}</span>
                      <button className="text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleCopy(p)}>
                        <Copy size={11} />
                      </button>
                    </div>
                    <p className="text-xs font-mono text-gray-300 break-words leading-relaxed select-all">
                      {p}
                    </p>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm">
                  <Play size={24} className="mb-2 opacity-30" />
                  Générez pour voir les prompts résolus
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Build verification**
  Run: `npm run build` inside `frontend` directory.
  Expected: Passes without compilation issues.

- [ ] **Step 4: Commit changes**
  Run:
  ```bash
  git add frontend/src/api/generator.ts frontend/src/pages/GeneratorPage.tsx
  git commit -m "feat: redesign GeneratorPage with Tabs and Wildcards Tester panel"
  ```

---

### Task 5: Integrate PromptEditor and Preview in ImageGenerationPage

**Files:**
- Modify: `frontend/src/pages/ImageGenerationPage.tsx`

- [ ] **Step 1: Replace textarea inputs with PromptEditor**
  Modify `frontend/src/pages/ImageGenerationPage.tsx`. Replace the main prompt `textarea` field with `PromptEditor` (keep negative prompt as standard textarea or standard styling).
  Add live preview card for processed prompt. Implement a 300ms debouncing logic that fetches processed version from `/generator/process-prompt`.
  Add a "Régénérer" button to re-run preview fetch, and an "Appliquer" button to overwrite main prompt text:

```tsx
// Around line 14: Add imports at the top
import PromptEditor from '@/components/shared/PromptEditor'
import { generatorApi } from '@/api/generator'
import { Copy, ChevronDown, ChevronUp } from 'lucide-react'

// Inside ImageGenerationPage (around line 143):
  const [processedPreview, setProcessedPreview] = useState('')
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  
  // Debounce API call for processed prompt preview
  useEffect(() => {
    if (!prompt.trim()) {
      setProcessedPreview('')
      return
    }
    
    setPreviewLoading(true)
    const timer = setTimeout(() => {
      generatorApi.processPrompt(prompt, 1)
        .then((res) => {
          if (res.processed.length > 0) {
            setProcessedPreview(res.processed[0])
          }
        })
        .catch(() => {})
        .finally(() => setPreviewLoading(false))
    }, 300)
    
    return () => clearTimeout(timer)
  }, [prompt])

  const handleRegeneratePreview = () => {
    if (!prompt.trim()) return
    setPreviewLoading(true)
    generatorApi.processPrompt(prompt, 1)
      .then((res) => {
        if (res.processed.length > 0) {
          setProcessedPreview(res.processed[0])
        }
      })
      .catch(() => {})
      .finally(() => setPreviewLoading(false))
  }

  const handleApplyPreview = () => {
    if (processedPreview) {
      setPrompt(processedPreview)
      toast.success('Prompt appliqué !')
    }
  }
```

  Now swap out the main textarea input at line 326:
```tsx
            {/* REPLACE this textarea:
            <textarea
              className="input min-h-32 resize-y font-mono text-xs leading-relaxed"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="masterpiece, best quality, cinematic lighting..."
            />
            */}
            {/* WITH PromptEditor: */}
            <PromptEditor
              className="card border border-studio-border bg-studio-surface/50"
              value={prompt}
              onChange={setPrompt}
              placeholder="masterpiece, best quality, cinematic lighting, __wildcard__..."
              rows={4}
            />
```

  And add the collapsible **Prompt Traité** preview card directly below the negative prompt textarea:
```tsx
            {/* Processed prompt preview panel */}
            {prompt.trim() && (
              <div className="border border-studio-border bg-studio-elevated/20 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsPreviewExpanded(!isPreviewExpanded)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 bg-studio-surface/40 hover:bg-studio-surface/60 transition-colors text-xs font-semibold text-gray-400"
                >
                  <span className="flex items-center gap-1.5">
                    {previewLoading ? <Spinner size={10} /> : <span>✨</span>}
                    Aperçu du prompt traité
                  </span>
                  {isPreviewExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                
                {isPreviewExpanded && (
                  <div className="p-3.5 space-y-3 bg-studio-bg/40 border-t border-studio-border/60">
                    <div className="p-3 bg-studio-bg font-mono text-xs text-gray-300 break-words leading-relaxed rounded border border-studio-border/40 select-all min-h-16 relative">
                      {processedPreview || 'Résolution en cours...'}
                    </div>
                    
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        className="btn-ghost py-1 px-2.5 text-[11px]"
                        onClick={handleRegeneratePreview}
                        disabled={previewLoading}
                      >
                        🔄 Régénérer
                      </button>
                      <button
                        type="button"
                        className="btn-ghost py-1 px-2.5 text-[11px] hover:text-studio-accent-glow"
                        onClick={handleApplyPreview}
                        disabled={!processedPreview}
                      >
                        📋 Appliquer au prompt
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
```

- [ ] **Step 2: Build verification**
  Run: `npm run build` inside `frontend` directory.
  Expected: Passes without compilation issues.

- [ ] **Step 3: Commit changes**
  Run:
  ```bash
  git add frontend/src/pages/ImageGenerationPage.tsx
  git commit -m "feat: add debounced live processed prompt preview and PromptEditor integration in ImageGenerationPage"
  ```

---

### Task 6: Final Verification

- [ ] **Step 1: Run complete test suite**
  Run: `pytest backend/tests`
  Expected: All 12+ tests pass successfully.

- [ ] **Step 2: Launch dev server**
  Run: `npm run dev` in `frontend` folder
  Wait for startup and manually verify autocomplete trigger (`__`), syntax colors, Generator page tabs + tester, and live preview in image generation.
