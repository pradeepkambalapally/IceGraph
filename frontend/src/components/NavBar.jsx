import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import logo from '../assets/icegraph.png'
import { useTableSpecs } from '../context/TableSpecsContext'
import { cacheData, clearCachedData } from '../utils/cacheUtils'
import { BASE_PATH, IS_MOCK, MOCK_HOME, MOCK_HOME_ROUTE } from '../appConstants'

export default function NavBar() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isTablePage = useMatch('/table/*')
  const tableName = searchParams.get('table')
  const { detailsOpen, setDetailsOpen, rawData, errors, warnings, issuesOpen, setIssuesOpen } = useTableSpecs()
  const [aboutOpen, setAboutOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [pickerTableName, setPickerTableName] = useState('')
  const [catalogTables, setCatalogTables] = useState(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState(null)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const navRef = useRef(null)
  const tablePickerRef = useRef(null)

  useEffect(() => {
    if (!aboutOpen) return
    const handleKey = (e) => { if (e.key === 'Escape') setAboutOpen(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [aboutOpen])

  useEffect(() => {
    if (!menuOpen && !tablePickerOpen) return
    const handler = (e) => {
      if (menuOpen && navRef.current && !navRef.current.contains(e.target)) setMenuOpen(false)
      if (tablePickerOpen && tablePickerRef.current && !tablePickerRef.current.contains(e.target)) setTablePickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen, tablePickerOpen])

  useEffect(() => {
    setMenuOpen(false)
    setTablePickerOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!tablePickerOpen) return
    const handleKey = (e) => { if (e.key === 'Escape') setTablePickerOpen(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [tablePickerOpen])

  useEffect(() => {
    if (!isTablePage) return
    const handleKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return
      const tabs = ['graph', 'metadata', 'timeline', 'filetree']
      const idx = parseInt(e.key) - 1
      if (idx >= 0 && idx < tabs.length) {
        e.preventDefault()
        navigate(`/table/${tabs[idx]}${location.search}`)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isTablePage, navigate, location.search])

  const tabSearch = location.search

  function openTablePicker() {
    setPickerTableName(tableName || '')
    setCatalogTables(null)
    setCatalogError(null)
    setTablePickerOpen(true)
  }

  async function fetchCatalogTables() {
    setCatalogLoading(true)
    setCatalogError(null)

    try {
      const res = await fetch('/api/v1/tables')
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to fetch tables')
      setCatalogTables(data.tables ?? [])
    } catch (e) {
      setCatalogError(e.message)
      setCatalogTables(null)
    } finally {
      setCatalogLoading(false)
    }
  }

  function changeTable(newName) {
    const trimmed = newName.trim()
    if (!trimmed) return

    const savedHistory = localStorage.getItem('tableHistory')
    const history = savedHistory ? JSON.parse(savedHistory) : []
    const updatedHistory = [...new Set([trimmed, ...history])].slice(0, 5)
    localStorage.setItem('tableHistory', JSON.stringify(updatedHistory))

    const tableParam = encodeURIComponent(trimmed)
    let targetUrl
    if (IS_MOCK) {
      const tab = location.pathname.match(/\/table\/([^/]+)/)?.[1] || 'graph'
      targetUrl = `${BASE_PATH}/table/${tab}?table=${tableParam}`
    } else {
      targetUrl = `${BASE_PATH}/snapshots-selection?table=${tableParam}`
    }

    window.open(targetUrl, '_blank', 'noopener,noreferrer')

    setTablePickerOpen(false)
    setMenuOpen(false)
  }

  function handleTablePickerSubmit(e) {
    e.preventDefault()
    changeTable(pickerTableName)
  }

  const tableNameButtonClass =
    'text-sm font-mono px-3 py-1 rounded-md border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 hover:bg-surface-hover transition cursor-pointer'

  const tablePickerPanel = (
    <form onSubmit={handleTablePickerSubmit} className="flex flex-col gap-3">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
            Change table
          </label>
          <button
            type="button"
            onClick={fetchCatalogTables}
            disabled={catalogLoading}
            className="text-xs font-bold text-accent hover:text-accent-dark disabled:text-slate-500 disabled:cursor-not-allowed transition"
          >
            {catalogLoading ? 'Loading…' : 'Browse catalog'}
          </button>
        </div>
        <input
          type="text"
          required
          value={pickerTableName}
          onChange={e => setPickerTableName(e.target.value)}
          placeholder="default.my_table"
          className="w-full border border-edge bg-edge rounded-lg px-3 py-2 text-sm text-ink placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
          autoFocus
        />
        {catalogError && (
          <p className="mt-2 text-xs text-rose-400">{catalogError}</p>
        )}
        {catalogTables && (
          <ul className="mt-2 max-h-40 overflow-y-auto border border-edge rounded-lg divide-y divide-edge">
            {catalogTables.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">No tables found in the catalog.</li>
            ) : (
              catalogTables.map(name => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => setPickerTableName(name)}
                    className={`w-full text-left px-3 py-2 text-sm font-mono transition ${
                      pickerTableName === name
                        ? 'bg-accent-muted text-ink'
                        : 'text-slate-300 hover:bg-surface-hover hover:text-ink'
                    }`}
                  >
                    {name}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <button
        type="submit"
        className="bg-accent hover:bg-accent-dark text-white font-bold py-2 rounded-lg transition text-sm"
      >
        Continue
      </button>
    </form>
  )

  const handleDuplicateTab = async () => {
    if (isDuplicating || !rawData) return
    setIsDuplicating(true)

    const url = new URL(window.location.href)
    url.searchParams.set('dup', '1')
    url.searchParams.set('cache_id', crypto.randomUUID())

    const cacheKey = url.toString()
    const newTab = window.open('about:blank', '_blank')

    try {
      await cacheData(cacheKey, rawData)
      if (newTab) {
        newTab.location.href = url.toString()
      }
    } catch (err) {
      console.error('Failed to duplicate tab:', err)
      if (newTab) newTab.close()
    }

    setTimeout(async () => {
      await clearCachedData(cacheKey).catch(console.error)
      setIsDuplicating(false)
    }, 2000)
  }

  const tabClass = ({ isActive }) =>
    `text-sm font-medium px-1 py-0.5 border-b-2 transition ${isActive
      ? 'border-accent text-white'
      : 'border-transparent text-slate-400 hover:text-white hover:border-slate-500'
    }`

  const mobileTabClass = ({ isActive }) =>
    `text-sm font-medium px-3 py-2 rounded-md transition text-left ${isActive
      ? 'bg-accent-muted text-white'
      : 'text-slate-400 hover:text-white hover:bg-surface-hover'
    }`

  return (
    <>
      <nav ref={navRef} className="h-16 bg-surface text-white shadow-lg shrink-0 sticky top-0 z-500">

        <div className="px-4 sm:px-6 py-3 flex items-center gap-4">

          <button
            type="button"
            className="flex items-center gap-2 select-none shrink-0 cursor-pointer rounded-md px-1 -ml-1 hover:bg-surface-hover transition"
            onClick={() => setAboutOpen(true)}
            title="About IceGraph"
          >
            <img src={logo} alt="" className="h-10 w-10 object-contain pointer-events-none" aria-hidden="true" />
            <span className="text-lg font-bold tracking-tight">IceGraph</span>
          </button>

          {!isTablePage && (
            <>
              <NavLink to={IS_MOCK ? MOCK_HOME_ROUTE : '/'} end className={tabClass}>
                Home
              </NavLink>
              <NavLink to="/docs" className={tabClass}>
                Docs
              </NavLink>
            </>
          )}

          {isTablePage && (
            <div className="hidden md:flex items-center gap-4 flex-1">
              {tableName && (
                <div className="relative" ref={tablePickerRef}>
                  <button
                    type="button"
                    onClick={() => (tablePickerOpen ? setTablePickerOpen(false) : openTablePicker())}
                    className={tableNameButtonClass}
                    title="Change table"
                    aria-expanded={tablePickerOpen}
                  >
                    {tableName}
                  </button>
                  {tablePickerOpen && (
                    <div className="absolute top-full left-0 mt-2 w-80 p-4 rounded-lg border border-edge bg-surface shadow-xl z-[70]">
                      {tablePickerPanel}
                    </div>
                  )}
                </div>
              )}

              <div className="w-px h-4 bg-slate-700" />

              <NavLink to={`/table/graph${tabSearch}`} className={tabClass}>Graph</NavLink>
              <NavLink to={`/table/metadata${tabSearch}`} className={tabClass}>Metadata</NavLink>
              <NavLink to={`/table/timeline${tabSearch}`} className={tabClass}>Timeline</NavLink>
              <NavLink to={`/table/filetree${tabSearch}`} className={tabClass}>FileTree</NavLink>

              {((errors && Object.keys(errors).length > 0) || (warnings && Object.keys(warnings).length > 0)) && (
                <button
                  onClick={() => setIssuesOpen(p => !p)}
                  className={`text-sm font-bold px-3 py-1 rounded-md transition border ${issuesOpen
                    ? (Object.keys(errors || {}).length > 0 ? 'bg-red-600 border-red-600 text-white' : 'bg-amber-600 border-amber-600 text-white')
                    : (Object.keys(errors || {}).length > 0 ? 'border-red-900/50 text-red-500 hover:bg-red-950/30' : 'border-amber-900/50 text-amber-500 hover:bg-amber-950/30')
                    }`}
                >
                  Issues ({Object.keys(errors || {}).length + Object.keys(warnings || {}).length})
                </button>
              )}

              <button
                className={`text-sm font-medium px-3 py-1 rounded-md border transition ${detailsOpen
                  ? 'bg-accent border-accent text-white'
                  : 'border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white'
                  }`}
                onClick={() => setDetailsOpen(p => !p)}
              >
                Specs
              </button>

              <div className="ml-auto flex items-center gap-3">
                <button
                  className={`text-sm font-medium border border-slate-600 px-3 py-1 rounded-md transition ${(isDuplicating || !rawData)
                    ? 'opacity-50 cursor-not-allowed text-slate-500'
                    : 'text-slate-400 hover:text-white hover:border-slate-400'
                    }`}
                  title={!rawData ? "Wait for data to load..." : "Opens this view in a new tab using cached data, no backend request is made"}
                  onClick={handleDuplicateTab}
                  disabled={isDuplicating || !rawData}
                >
                  {isDuplicating ? 'Duplicating...' : 'Duplicate tab'}
                </button>

                <div className="w-px h-4 bg-slate-700" />

                <NavLink
                  to="/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 px-3 py-1 rounded-md transition"
                >
                  Docs
                </NavLink>

                <button
                  className="text-sm font-medium text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 px-3 py-1 rounded-md transition"
                  onClick={() => window.open(IS_MOCK ? MOCK_HOME : '/', '_blank')}
                >
                  ← Home
                </button>
              </div>
            </div>
          )}

          {isTablePage && (
            <button
              className="md:hidden ml-auto flex flex-col justify-center items-center w-8 h-8 gap-1.5 rounded transition hover:bg-surface-hover cursor-pointer"
              onClick={() => setMenuOpen(p => !p)}
              aria-label="Toggle menu"
            >
              <span className={`block w-5 h-0.5 bg-slate-400 transition-all origin-center ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} />
              <span className={`block w-5 h-0.5 bg-slate-400 transition-all ${menuOpen ? 'opacity-0' : ''}`} />
              <span className={`block w-5 h-0.5 bg-slate-400 transition-all origin-center ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
            </button>
          )}
        </div>

        {isTablePage && menuOpen && (
          <div className="md:hidden border-t border-edge px-4 py-3 flex flex-col gap-1 bg-surface absolute top-16 left-0 w-full z-[60] shadow-xl">
            {tableName && (
              <div ref={tablePickerRef}>
                <button
                  type="button"
                  onClick={() => (tablePickerOpen ? setTablePickerOpen(false) : openTablePicker())}
                  className={`${tableNameButtonClass} w-full text-left`}
                  title="Change table"
                  aria-expanded={tablePickerOpen}
                >
                  {tableName}
                </button>
                {tablePickerOpen && (
                  <div className="mt-2 p-4 rounded-lg border border-edge bg-surface-hover">
                    {tablePickerPanel}
                  </div>
                )}
              </div>
            )}

            <div className="h-px bg-edge my-1" />

            <NavLink to={`/table/graph${tabSearch}`} className={mobileTabClass}>Graph</NavLink>
            <NavLink to={`/table/metadata${tabSearch}`} className={mobileTabClass}>Metadata</NavLink>
            <NavLink to={`/table/timeline${tabSearch}`} className={mobileTabClass}>Timeline</NavLink>
            <NavLink to={`/table/filetree${tabSearch}`} className={mobileTabClass}>FileTree</NavLink>

            {((errors && Object.keys(errors).length > 0) || (warnings && Object.keys(warnings).length > 0)) && (
              <button
                onClick={() => { setIssuesOpen(p => !p); setMenuOpen(false) }}
                className={`text-sm font-bold px-3 py-2 rounded-md transition text-left ${issuesOpen
                  ? (Object.keys(errors || {}).length > 0 ? 'bg-red-600 text-white' : 'bg-amber-600 text-white')
                  : (Object.keys(errors || {}).length > 0 ? 'text-red-500 hover:bg-red-950/30' : 'text-amber-500 hover:bg-amber-950/30')
                  }`}
              >
                Issues ({Object.keys(errors || {}).length + Object.keys(warnings || {}).length})
              </button>
            )}

            <div className="h-px bg-edge my-1" />

            <button
              className={`text-sm font-medium px-3 py-2 rounded-md border transition text-left ${detailsOpen
                ? 'bg-accent border-accent text-white'
                : 'border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white'
                }`}
              onClick={() => { setDetailsOpen(p => !p); setMenuOpen(false) }}
            >
              Specs
            </button>

            <button
              className={`text-sm font-medium border border-slate-600 px-3 py-2 rounded-md transition text-left ${(isDuplicating || !rawData)
                ? 'opacity-50 cursor-not-allowed text-slate-500'
                : 'text-slate-400 hover:text-white hover:border-slate-400'
                }`}
              title={!rawData ? "Wait for data to load..." : "Opens this view in a new tab using cached data, no backend request is made"}
              onClick={() => {
                handleDuplicateTab()
                setMenuOpen(false)
              }}
              disabled={isDuplicating || !rawData}
            >
              {isDuplicating ? 'Duplicating...' : 'Duplicate tab'}
            </button>

            <NavLink
              to="/docs"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="text-sm font-medium text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 px-3 py-2 rounded-md transition text-left"
            >
              Docs
            </NavLink>

            <button
              className="text-sm font-medium text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 px-3 py-2 rounded-md transition text-left"
              onClick={() => { window.open(IS_MOCK ? MOCK_HOME : '/', '_blank'); setMenuOpen(false) }}
            >
              ← Home
            </button>
          </div>
        )}
      </nav>

      {aboutOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center font-sans"
          onClick={() => setAboutOpen(false)}
        >
          <div
            className="w-[480px] min-w-[320px] bg-surface rounded-xl shadow-2xl border border-edge flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
              <div className="flex items-center gap-3">
                <img src={logo} alt="IceGraph" className="h-8 w-8 object-contain" />
                <span className="font-bold text-ink text-base">IceGraph</span>
              </div>
              <button
                className="w-7 h-7 rounded-full bg-edge text-slate-400 flex items-center justify-center text-base cursor-pointer hover:bg-edge-hover hover:text-slate-200 transition"
                onClick={() => setAboutOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4 text-sm text-slate-300">
              <p className="leading-relaxed">
                <span className="font-semibold text-white">IceGraph</span> is an open source Apache Iceberg <span className="font-semibold text-white">debugging and visualization platform</span>. Trace production Iceberg tables through a graph based UI built for <span className="font-semibold text-white">debugging complex metadata states</span>, analyzing table evolution, and <span className="font-semibold text-white">learning how Iceberg works under the hood</span>.
              </p>
              <div className="border-t border-edge pt-4 flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-slate-500 uppercase tracking-wider text-tiny font-semibold">Source</span>
                  <a
                    href="https://github.com/YanivZalach/IceGraph"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-blue-400 transition font-mono"
                  >
                    github.com/YanivZalach/IceGraph
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
