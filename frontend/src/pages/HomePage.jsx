import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import logo from '../assets/icegraph.png'
import JSONbig from 'json-bigint'

export default function HomePage() {
  const [tableName, setTableName] = useState('')
  const [history, setHistory] = useState([])
  const [catalogTables, setCatalogTables] = useState(null)
  const [catalogFilter, setCatalogFilter] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const savedHistory = localStorage.getItem('tableHistory')
    if (savedHistory) {
      setHistory(JSONbig({ storeAsString: true }).parse(savedHistory))
    }
  }, [])

  function handleSubmit(e) {
    e.preventDefault()

    const updatedHistory = [...new Set([tableName, ...history])].slice(0, 5)
    setHistory(updatedHistory)
    localStorage.setItem('tableHistory', JSON.stringify(updatedHistory))

    const params = new URLSearchParams({ table: tableName })
    navigate(`/snapshots-selection?${params.toString()}`)
  }

  const filteredCatalogTables = catalogTables?.filter(name =>
    name.toLowerCase().includes(catalogFilter.trim().toLowerCase()),
  ) ?? []

  async function fetchCatalogTables() {
    setCatalogLoading(true)
    setCatalogError(null)
    setCatalogFilter('')

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

  function selectCatalogTable(name) {
    setTableName(name)
  }

  return (
    <div className="flex-1 flex flex-col">
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="bg-surface rounded-2xl shadow-xl p-10 w-full max-w-lg border border-edge">
          <div className="flex flex-col items-center mb-6">
            <img src={logo} alt="IceGraph" className="h-20 w-20 object-contain mb-3" />
            <h1 className="text-2xl font-bold text-ink">IceGraph</h1>
          </div>

          <h2 className="text-xl font-bold text-ink mb-1">Visualize a Table</h2>
          <p className="text-slate-400 text-sm mb-7">
            Enter an Iceberg table name to explore its metadata graph.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Table Name
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
                list="table-history"
                type="text"
                required
                value={tableName}
                onChange={e => setTableName(e.target.value)}
                placeholder="default.my_table"
                className="w-full border border-edge bg-edge rounded-lg px-4 py-2.5 text-sm text-ink placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
              />
              <datalist id="table-history">
                {history.map(item => (
                  <option key={item} value={item} />
                ))}
              </datalist>

              {catalogError && (
                <p className="mt-2 text-xs text-rose-400">{catalogError}</p>
              )}

              {catalogTables && (
                <div className="mt-3 border border-edge rounded-lg overflow-hidden">
                  {catalogTables.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-400">No tables found in the catalog.</p>
                  ) : (
                    <>
                      <div className="px-3 py-2 border-b border-edge bg-surface-hover">
                        <input
                          type="text"
                          value={catalogFilter}
                          onChange={e => setCatalogFilter(e.target.value)}
                          placeholder="Filter tables…"
                          className="w-full border border-edge bg-edge rounded-md px-3 py-1.5 text-xs text-ink placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
                        />
                      </div>
                      {filteredCatalogTables.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-slate-400">No tables match your filter.</p>
                      ) : (
                    <ul className="max-h-48 overflow-y-auto divide-y divide-edge">
                      {filteredCatalogTables.map(name => (
                        <li key={name}>
                          <button
                            type="button"
                            onClick={() => selectCatalogTable(name)}
                            className={`w-full text-left px-3 py-2 text-sm font-mono transition ${
                              tableName === name
                                ? 'bg-accent-muted text-ink'
                                : 'text-slate-300 hover:bg-surface-hover hover:text-ink'
                            }`}
                          >
                            {name}
                          </button>
                        </li>
                      ))}
                    </ul>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              type="submit"
              className="bg-accent hover:bg-accent-dark active:bg-accent-dark text-white font-bold py-2.5 rounded-lg transition text-sm tracking-wide mt-1"
            >
              Continue
            </button>
          </form>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-500 py-4">
        IceGraph — Apache Iceberg Metadata Visualizer
      </footer>
    </div>
  )
}
