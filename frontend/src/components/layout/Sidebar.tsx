import { NavLink } from 'react-router-dom'
import {
  FolderTree, GitCompare, PenLine, Tags, Copy,
  ScanSearch, BookOpen, Wand2, Merge, UploadCloud,
  ChevronLeft, ChevronRight, Sparkles, Image, ListChecks, History,
} from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { clsx } from '@/lib/utils'

const NAV = [
  { to: '/explorer',   icon: FolderTree,   label: 'Explorateur',  code: 'F01' },
  { to: '/comparator', icon: GitCompare,   label: 'Comparateur',  code: 'F02' },
  { to: '/editor',     icon: PenLine,      label: 'Éditeur',      code: 'F03' },
  { to: '/tags',       icon: Tags,         label: 'Tags',         code: 'F04' },
  { to: '/duplicates', icon: Copy,         label: 'Doublons',     code: 'F05' },
  { to: '/scanner',    icon: ScanSearch,   label: 'Scanner',      code: 'F06' },
  { to: '/library',    icon: BookOpen,     label: 'Bibliothèque', code: 'F07' },
  { to: '/generator',  icon: Wand2,        label: 'Générateur',   code: 'F08' },
  { to: '/merge',      icon: Merge,        label: 'Fusion',       code: 'F09' },
  { to: '/sync',       icon: UploadCloud,  label: 'Sync',         code: 'F10' },
  { to: '/generation', icon: Image,        label: 'Images',       code: 'F11' },
  { to: '/gallery',    icon: History,      label: 'Galerie',      code: 'F12' },
  { to: '/actions',    icon: ListChecks,   label: 'Actions',      code: 'F13' },
]

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore()

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 h-full z-20 flex flex-col bg-studio-surface border-r border-studio-border transition-all duration-200',
        sidebarCollapsed ? 'w-14' : 'w-[220px]',
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-3 h-14 border-b border-studio-border shrink-0">
        <div className="w-8 h-8 rounded-lg bg-studio-accent/20 flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-studio-accent" />
        </div>
        {!sidebarCollapsed && (
          <span className="font-display font-semibold text-white text-sm tracking-wide whitespace-nowrap">
            WildcardStudio
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        {NAV.map(({ to, icon: Icon, label, code }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 mx-2 my-0.5 px-2 py-2 rounded-md text-sm transition-all duration-150 group',
                isActive
                  ? 'bg-studio-accent/15 text-studio-accent-glow'
                  : 'text-gray-400 hover:text-white hover:bg-studio-elevated',
              )
            }
            title={sidebarCollapsed ? `${label} (${code})` : undefined}
          >
            <Icon size={16} className="shrink-0" />
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 whitespace-nowrap">{label}</span>
                <span className="text-xs font-mono text-gray-600 group-hover:text-gray-500">{code}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center h-10 border-t border-studio-border text-gray-500 hover:text-white hover:bg-studio-elevated transition-colors"
        title={sidebarCollapsed ? 'Expand' : 'Collapse'}
      >
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  )
}
