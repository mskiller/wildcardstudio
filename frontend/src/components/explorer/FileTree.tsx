import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen } from 'lucide-react'
import type { TreeNode } from '@/api/explorer'
import { StyleBadge, FormatBadge } from '@/components/shared/Badge'
import { useExplorerStore } from '@/store/explorerStore'

interface Props {
  node: TreeNode
  depth?: number
}

export default function FileTree({ node, depth = 0 }: Props) {
  const { selectedPath, expandedPaths, setSelectedPath, toggleExpanded } = useExplorerStore()

  if (node.type === 'directory') {
    const isOpen = expandedPaths.has(node.path) || depth === 0
    return (
      <div>
        <button
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-studio-elevated text-gray-400 hover:text-white transition-colors text-sm group"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => toggleExpanded(node.path)}
        >
          {isOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
          {isOpen
            ? <FolderOpen size={14} className="text-studio-accent shrink-0" />
            : <Folder size={14} className="text-studio-accent-dim shrink-0" />}
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {isOpen && (
          <div>
            {(node.children ?? []).map((child) => (
              <FileTree key={child.path} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const isSelected = selectedPath === node.path
  return (
    <button
      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors group ${
        isSelected
          ? 'bg-studio-accent/15 text-studio-accent-glow'
          : 'text-gray-400 hover:text-white hover:bg-studio-elevated'
      }`}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={() => setSelectedPath(node.path)}
    >
      <FileText size={13} className="shrink-0" />
      <span className="flex-1 truncate text-left">{node.name}</span>
      <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
        {node.prompt_style && <StyleBadge style={node.prompt_style} />}
        {node.format && <FormatBadge format={node.format} />}
      </span>
    </button>
  )
}
