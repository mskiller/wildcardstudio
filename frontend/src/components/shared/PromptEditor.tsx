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
          <span key={matchIdx} className="text-cyan-400 font-semibold bg-cyan-400/10 px-0.5 rounded">
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

  const commonStyles: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '12px',
    lineHeight: '1.625',
    padding: '8px 12px',
    border: 'none',
    margin: '0',
    boxSizing: 'border-box',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  }
  
  return (
    <div className={`relative ${className} w-full bg-studio-elevated border border-studio-border rounded-md focus-within:border-studio-accent transition-colors`} style={{ minHeight: `${rows * 26}px` }}>
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none select-none overflow-y-auto overflow-x-hidden text-gray-500 w-full h-full"
        style={{
          ...commonStyles,
          minHeight: 'inherit',
        }}
      >
        {renderHighlightedText()}
      </div>
      
      {/* Transparent Textarea */}
      <textarea
        ref={textareaRef}
        className="w-full bg-transparent resize-y relative z-10 focus:outline-none placeholder-transparent text-transparent caret-white"
        style={{
          ...commonStyles,
          color: 'transparent',
          caretColor: 'white',
          minHeight: 'inherit',
          display: 'block',
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

