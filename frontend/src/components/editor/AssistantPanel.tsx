import { useState, useEffect } from 'react'
import { Send, CheckCircle2, Play, Image as ImageIcon, MessageSquare, Loader2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import { useEditorStore } from '@/store/editorStore'

interface AssistantPanelProps {
  currentContent: string
  onApply: (content: string) => void
}

const imageToSrc = (imgUrl: string) => {
  if (!imgUrl) return ''
  if (/^(https?:|data:|blob:)/i.test(imgUrl)) return imgUrl
  if (imgUrl.startsWith('/api/')) return imgUrl
  if (imgUrl.startsWith('/')) return `/api${imgUrl}`
  return `/api/${imgUrl}`
}

export default function AssistantPanel({ currentContent, onApply }: AssistantPanelProps) {
  const [activeTab, setActiveTab] = useState<'assistant' | 'generation'>('assistant')
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; text: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  // Editor states
  const selectedText = useEditorStore((s) => s.selectedText)
  const [posPrompt, setPosPrompt] = useState('')
  const [negPrompt, setNegPrompt] = useState(() => {
    try {
      const stored = localStorage.getItem('wildcardstudio.imageGeneration.v1')
      if (stored) {
        return JSON.parse(stored).negativePrompt || ''
      }
    } catch {}
    return ''
  })

  const [elapsedTime, setElapsedTime] = useState(0)
  const [genStatus, setGenStatus] = useState<any>(null)
  const queryClient = useQueryClient()

  // 1. Hook definitions (hoisted above useEffects)
  const genMutation = useMutation({
    mutationFn: async () => {
      let persistedSettings: any = {}
      try {
        const stored = localStorage.getItem('wildcardstudio.imageGeneration.v1')
        if (stored) {
          persistedSettings = JSON.parse(stored)
        }
      } catch (e) {
        console.error('Failed to parse generation settings', e)
      }

      const prov = persistedSettings.provider || 'comfyui'
      const baseurl = persistedSettings.baseUrl || ''
      const sets = persistedSettings.settings || {}

      const response = await api.post(
        '/generation/txt2img',
        {
          provider: prov,
          base_url: baseurl,
          prompt: posPrompt,
          negative_prompt: negPrompt,
          model: sets.model || undefined,
          sampler: sets.sampler || undefined,
          scheduler: sets.scheduler || undefined,
          steps: typeof sets.steps === 'number' ? sets.steps : 30,
          cfg_scale: typeof sets.cfg === 'number' ? sets.cfg : 7.0,
          seed: typeof sets.seed === 'number' ? sets.seed : -1,
          width: typeof sets.width === 'number' ? sets.width : 1024,
          height: typeof sets.height === 'number' ? sets.height : 1024,
          batch_size: typeof sets.batch_size === 'number' ? sets.batch_size : 1,
          batch_count: typeof sets.batch_count === 'number' ? sets.batch_count : 1,
          loras: Array.isArray(sets.loras) ? sets.loras : [],
        },
        {
          timeout: 300_000,
        },
      )
      return response.data
    },
    onSuccess: (data) => {
      setGenStatus(data)
      queryClient.invalidateQueries({ queryKey: ['generationHistory'] })
      toast.success('Generation complete!')
    },
    onError: (err: any) => {
      toast.error(err.message || 'Generation failed')
    },
  })

  // Sync positive prompt with editor selection/content
  useEffect(() => {
    setPosPrompt(selectedText || currentContent)
  }, [selectedText, currentContent])

  // Timer for generation progress
  useEffect(() => {
    let timer: any
    if (genMutation.isPending) {
      setElapsedTime(0)
      timer = setInterval(() => {
        setElapsedTime((prev) => prev + 1)
      }, 1000)
    } else {
      setElapsedTime(0)
    }
    return () => clearInterval(timer)
  }, [genMutation.isPending])

  // Save negative prompt changes to localStorage
  const handleNegPromptChange = (val: string) => {
    setNegPrompt(val)
    try {
      const stored = localStorage.getItem('wildcardstudio.imageGeneration.v1')
      const parsed = stored ? JSON.parse(stored) : {}
      parsed.negativePrompt = val
      localStorage.setItem('wildcardstudio.imageGeneration.v1', JSON.stringify(parsed))
    } catch {}
  }

  const handleChat = async () => {
    if (!chatInput.trim() || isStreaming) return
    const userMessage = chatInput.trim()
    setChatInput('')
    setChatHistory((prev) => [...prev, { role: 'user', text: userMessage }, { role: 'assistant', text: '' }])
    setIsStreaming(true)

    try {
      const promptContext = selectedText
        ? `Selected text to edit:\n"${selectedText}"\n\nFull context:\n${currentContent}`
        : `Full content of the prompt:\n${currentContent}`

      const fullPrompt = `${promptContext}\n\nInstruction: ${userMessage}\n\nPlease provide only the modified or expanded text. Do not include introductory text.`
      const baseUrl = api.defaults.baseURL || '/api'

      const response = await fetch(`${baseUrl}/llm/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt }),
      })

      if (!response.ok) throw new Error('Network error')

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '')
              try {
                const data = JSON.parse(dataStr)
                if (data.error) {
                  toast.error(data.error)
                  break
                }
                if (data.token) {
                  setChatHistory((prev) => {
                    const newHist = [...prev]
                    newHist[newHist.length - 1].text += data.token
                    return newHist
                  })
                }
              } catch (e) {
                // Ignore incomplete json chunks if any
              }
            }
          }
        }
      }
    } catch (e) {
      toast.error('Failed to connect to LLM')
    } finally {
      setIsStreaming(false)
    }
  }

  const getProgressStep = (time: number) => {
    if (time < 4) return 'Queueing generation...'
    if (time < 20) return 'Running ComfyUI inference...'
    return 'Processing and saving images...'
  }

  return (
    <div className="assistant-panel">
      <div className="assistant-tabs">
        <button className={activeTab === 'assistant' ? 'active' : ''} onClick={() => setActiveTab('assistant')}>
          <MessageSquare size={13} /> Assistant
        </button>
        <button className={activeTab === 'generation' ? 'active' : ''} onClick={() => setActiveTab('generation')}>
          <ImageIcon size={13} /> Generation
        </button>
      </div>

      <div className="assistant-content">
        {activeTab === 'assistant' && (
          <div className="chat-container">
            <div className="chat-messages">
              {chatHistory.map((msg, i) => (
                <div key={i} className={`chat-msg ${msg.role}`}>
                  <p className="whitespace-pre-wrap text-sm">{msg.text}</p>
                  {msg.role === 'assistant' && !isStreaming && i === chatHistory.length - 1 && (
                    <button
                      className="btn-ghost text-xs mt-2"
                      onClick={() => useEditorStore.getState().requestInsertText(msg.text)}
                    >
                      <CheckCircle2 size={12} /> Apply to Editor
                    </button>
                  )}
                </div>
              ))}
              {chatHistory.length === 0 && (
                <p className="text-muted text-sm p-4 text-center">Ask the assistant to modify or expand your prompt!</p>
              )}
            </div>
            <div className="chat-input-box">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                placeholder="e.g., make it more cyberpunk..."
                disabled={isStreaming}
              />
              <button onClick={handleChat} disabled={isStreaming || !chatInput.trim()}>
                {isStreaming ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'generation' && (
          <div className="gen-container flex flex-col gap-3 overflow-y-auto h-full p-4">
            <div>
              <label className="text-[11px] text-gray-500 font-mono uppercase tracking-wider block mb-1">
                Positive Prompt
              </label>
              <textarea
                className="input w-full min-h-24 resize-y font-mono text-xs leading-relaxed"
                value={posPrompt}
                onChange={(e) => setPosPrompt(e.target.value)}
                placeholder="masterpiece, best quality, cinematic..."
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 font-mono uppercase tracking-wider block mb-1">
                Negative Prompt
              </label>
              <textarea
                className="input w-full min-h-16 resize-y font-mono text-xs leading-relaxed"
                value={negPrompt}
                onChange={(e) => handleNegPromptChange(e.target.value)}
                placeholder="low quality, blurry, watermark..."
              />
            </div>

            <button
              className="btn-primary w-full justify-center h-10 mt-1"
              onClick={() => genMutation.mutate()}
              disabled={genMutation.isPending || !posPrompt.trim()}
            >
              {genMutation.isPending ? (
                <Loader2 className="animate-spin mr-2" size={14} />
              ) : (
                <Play className="mr-2" size={14} />
              )}
              Generate via ComfyUI
            </button>

            {genMutation.isPending && (
              <div className="rounded-md border border-studio-border bg-studio-elevated/40 p-4 mt-2 text-center">
                <Loader2 className="animate-spin text-studio-accent mx-auto mb-2" size={24} />
                <p className="text-sm font-medium text-white">{getProgressStep(elapsedTime)}</p>
                <p className="text-xs text-gray-500 mt-1">{elapsedTime}s elapsed</p>
              </div>
            )}

            {genStatus && genStatus.images && (
              <div className="border-t border-studio-border mt-3 pt-3">
                <h4 className="text-xs font-semibold text-white mb-2">Latest Results</h4>
                <div className="flex flex-col gap-3">
                  {genStatus.images.map((img: any, i: number) => (
                    <div key={i} className="rounded-md border border-studio-border overflow-hidden bg-studio-bg">
                      <img
                        src={imageToSrc(img.history_image_url)}
                        alt={`Generation ${i}`}
                        className="w-full h-auto max-h-[300px] object-contain"
                      />
                      <div className="p-2 border-t border-studio-border flex justify-between gap-2 bg-studio-surface">
                        <button
                          className="btn-ghost text-xs py-1 px-2"
                          onClick={() => useEditorStore.getState().requestInsertText(posPrompt)}
                        >
                          <CheckCircle2 size={12} /> Apply Prompt
                        </button>
                        <a
                          href={imageToSrc(img.history_image_url)}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-ghost text-xs py-1 px-2"
                        >
                          Open image
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
