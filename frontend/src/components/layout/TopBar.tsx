import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { api } from '@/api/client'

const ROUTE_TITLES: Record<string, string> = {
  '/explorer':   'Explorateur de wildcards',
  '/comparator': 'Comparateur de prompts',
  '/editor':     'Éditeur intelligent',
  '/tags':       'Gestionnaire de tags',
  '/duplicates': 'Détecteur de doublons',
  '/scanner':    'Scanner TAG / NL',
  '/library':    'Bibliothèque de prompts',
  '/generator':  'Générateur de wildcards',
  '/merge':      'Fusion & nettoyage',
  '/sync':       'Export / Import & Sync',
}

export default function TopBar() {
  const { pathname } = useLocation()
  const title = ROUTE_TITLES[pathname] ?? 'WildcardStudio'

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then((r) => r.data),
    refetchInterval: 15_000,
    retry: false,
  })

  return (
    <header className="h-14 border-b border-studio-border bg-studio-surface flex items-center px-5 gap-4 shrink-0">
      <h1 className="font-display font-semibold text-white text-base flex-1">{title}</h1>
      <div className="flex items-center gap-2 text-xs">
        <Activity
          size={13}
          className={health?.status === 'ok' ? 'text-studio-success' : 'text-studio-danger animate-pulse'}
        />
        <span className={health?.status === 'ok' ? 'text-studio-success' : 'text-studio-danger'}>
          {health?.status === 'ok' ? 'API en ligne' : 'API hors-ligne'}
        </span>
      </div>
    </header>
  )
}
