import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { MOCK_HOME_ROUTE, IS_MOCK } from './appConstants'
import NavBar from './components/NavBar'
import { TableSpecsProvider } from './context/TableSpecsContext'
import { UI_BODY_MUTED_CLASS } from './uiTypography'

const HomePage = lazy(() => import('./pages/HomePage'))
const SnapshotSelectionPage = lazy(() => import('./pages/SnapshotSelectionPage'))
const DocsPage = lazy(() => import('./pages/DocsPage'))
const TableLayout = lazy(() => import('./pages/TableLayout'))
const GraphPage = lazy(() => import('./pages/GraphPage'))
const MetadataPage = lazy(() => import('./pages/MetadataPage'))
const TimelinePage = lazy(() => import('./pages/TimelinePage'))
const FileTreePage = lazy(() => import('./pages/FileTreePage'))

function PageLoader() {
  return (
    <div className={`flex-1 flex items-center justify-center ${UI_BODY_MUTED_CLASS}`}>
      Loading…
    </div>
  )
}

function Layout({ children }) {
  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <NavBar />
      {children}
    </div>
  )
}

export default function App() {
  return (
    <TableSpecsProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route
            path="/"
            element={
              IS_MOCK
                ? <Navigate to={MOCK_HOME_ROUTE} replace />
                : <Layout><HomePage /></Layout>
            }
          />
          <Route path="snapshots-selection" element={
            IS_MOCK
              ? <Navigate to={MOCK_HOME_ROUTE} replace />
              : <Layout><SnapshotSelectionPage /></Layout>
          } />
          <Route path="/docs" element={<Layout><DocsPage /></Layout>} />
          <Route
            path="/table"
            element={
              <Layout>
                <TableLayout />
              </Layout>
            }
          >
            <Route path="graph" element={<GraphPage />} />
            <Route path="metadata" element={<MetadataPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="filetree" element={<FileTreePage />} />
          </Route>
        </Routes>
      </Suspense>
    </TableSpecsProvider>
  )
}
