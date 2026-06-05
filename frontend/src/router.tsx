import { createBrowserRouter, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import ExplorerPage    from './pages/ExplorerPage'
import ComparatorPage  from './pages/ComparatorPage'
import EditorPage      from './pages/EditorPage'
import TagsPage        from './pages/TagsPage'
import DuplicatesPage  from './pages/DuplicatesPage'
import ScannerPage     from './pages/ScannerPage'
import LibraryPage     from './pages/LibraryPage'
import GeneratorPage   from './pages/GeneratorPage'
import ImageGenerationPage from './pages/ImageGenerationPage'
import MergePage       from './pages/MergePage'
import SyncPage        from './pages/SyncPage'
import ActionsPage     from './pages/ActionsPage'
import GalleryPage     from './pages/GalleryPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true,          element: <Navigate to="/explorer" replace /> },
      { path: 'explorer',     element: <ExplorerPage /> },
      { path: 'comparator',   element: <ComparatorPage /> },
      { path: 'editor',       element: <EditorPage /> },
      { path: 'tags',         element: <TagsPage /> },
      { path: 'duplicates',   element: <DuplicatesPage /> },
      { path: 'scanner',      element: <ScannerPage /> },
      { path: 'library',      element: <LibraryPage /> },
      { path: 'generator',    element: <GeneratorPage /> },
      { path: 'generation',   element: <ImageGenerationPage /> },
      { path: 'merge',        element: <MergePage /> },
      { path: 'actions',      element: <ActionsPage /> },
      { path: 'sync',         element: <SyncPage /> },
      { path: 'gallery',      element: <GalleryPage /> },
    ],
  },
])
