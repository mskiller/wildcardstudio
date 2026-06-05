import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useUIStore } from '@/store/uiStore'

export default function Layout() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  return (
    <div className="flex h-screen bg-studio-bg overflow-hidden">
      <Sidebar />
      <div
        className="flex flex-col flex-1 min-w-0 transition-all duration-200"
        style={{ marginLeft: collapsed ? 56 : 220 }}
      >
        <TopBar />
        <main className="flex-1 overflow-auto p-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
