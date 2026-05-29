import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { FileType } from '../graphConstants'
import JSONbig from 'json-bigint'
import { parseUtcDate } from '../utils/dateUtils'

const COLOR_A = '#1964B9'
const COLOR_B = '#6437D2'
const COLOR_C = '#D97706'
const COLOR_INIT = '#4a5568'


function parseSummary(summary) {
  if (!summary) return []
  return summary
    .split('\n')
    .map(line => {
      const idx = line.indexOf(':')
      if (idx === -1) return null
      return { key: line.substring(0, idx).trim(), value: line.substring(idx + 1).trim() }
    })
    .filter(Boolean)
}

function formatTs(tsStr) {
  if (!tsStr) return null
  try {
    const d = new Date(tsStr)
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + `.${ms}`
    return {
      date: d.toLocaleDateString(),
      time,
      full: `${d.toLocaleDateString()} ${time}`,
    }
  } catch (e) {
    console.error(e)
    return null
  }
}

function parseProperties(propertiesStr) {
  if (!propertiesStr) return []
  return propertiesStr
    .split('\n')
    .map(line => {
      const match = line.match(/^"([^"]+)":\s*"([^"]*)"$/)
      if (!match) return null
      return { key: match[1], value: match[2] }
    })
    .filter(Boolean)
}

function shortFileName(filePath) {
  if (!filePath) return '—'
  const base = filePath.split('/').pop() || filePath
  return base
}

function formatDuration(tsA, tsB) {
  const dA = parseUtcDate(tsA)
  const dB = parseUtcDate(tsB)
  if (!dA || !dB) return '—'
  const diff = Math.abs(dA - dB)
  if (diff >= 86400000) return `${Math.round(diff / 86400000)}d`
  if (diff >= 3600000) return `${Math.round(diff / 3600000)}h`
  if (diff >= 60000) return `${Math.round(diff / 60000)}m`
  return `${Math.round(diff / 1000)}s`
}

function colorFor(type) {
  if (type === 'A') return COLOR_A
  if (type === 'B') return COLOR_B
  if (type === 'C') return COLOR_C
  return COLOR_INIT
}

function labelFor(type) {
  if (type === 'A') return 'Write'
  if (type === 'B') return 'Metadata Op'
  if (type === 'C') return 'Branch Write'
  return 'Init'
}

function DiffRow({ label, before, after }) {
  const tryParse = (val) => {
    if (!val) return null
    try {
      const p = JSONbig({ storeAsString: true }).parse(val)
      return (typeof p === 'object' && p !== null) ? p : null
    } catch { return null }
  }

  const beforeObj = tryParse(before)
  const afterObj = tryParse(after)

  if (beforeObj && afterObj) {
    const allKeys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])).sort()
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[0.65rem] font-bold text-slate-500 uppercase tracking-widest">
          {label.replace(/_/g, ' ')}
        </span>
        <div className="bg-[#13171f] border border-[#2d3748] rounded-lg py-3 font-mono text-[0.7rem] overflow-x-auto shadow-2xl flex flex-col">
          <div className="px-4 py-0.5 text-slate-500 opacity-40">{"{"}</div>
          <div className="flex flex-col">
            {allKeys.map(key => {
              const bVal = beforeObj[key]
              const aVal = afterObj[key]
              const bStr = JSON.stringify(bVal)
              const aStr = JSON.stringify(aVal)

              if (bVal !== undefined && aVal === undefined) {
                return (
                  <div key={key} className="bg-red-500/8 text-red-400 px-8 py-0.5 flex gap-2">
                    <span className="w-3 shrink-0 opacity-50 text-center">-</span>
                    <span className="break-all">"{key}": {bStr}</span>
                  </div>
                )
              }
              if (bVal === undefined && aVal !== undefined) {
                return (
                  <div key={key} className="bg-green-500/8 text-green-400 px-8 py-0.5 flex gap-2">
                    <span className="w-3 shrink-0 opacity-50 text-center">+</span>
                    <span className="break-all">"{key}": {aStr}</span>
                  </div>
                )
              }
              if (bStr !== aStr) {
                return (
                  <div key={key}>
                    <div className="bg-red-500/8 text-red-400 px-8 py-0.5 flex gap-2">
                      <span className="w-3 shrink-0 opacity-40 text-center">-</span>
                      <span className="break-all">"{key}": {bStr}</span>
                    </div>
                    <div className="bg-green-500/8 text-green-400 px-8 py-0.5 flex gap-2">
                      <span className="w-3 shrink-0 opacity-50 text-center">+</span>
                      <span className="break-all">"{key}": {aStr}</span>
                    </div>
                  </div>
                )
              }
              return (
                <div key={key} className="px-8 py-0.5 text-slate-300 flex gap-2">
                  <span className="w-3 shrink-0 opacity-20 text-center"> </span>
                  <span className="break-all">"{key}": {bStr}</span>
                </div>
              )
            })}
          </div>
          <div className="px-4 py-0.5 text-slate-500 opacity-40">{"}"}</div>
        </div>
      </div>
    )
  }

  const tryFormat = (val) => {
    if (!val) return val
    try {
      const parsed = JSONbig({ storeAsString: true }).parse(val)
      if (typeof parsed === 'object' && parsed !== null) {
        return JSON.stringify(parsed, null, 2)
      }
    } catch { }
    return val
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.65rem] font-bold text-slate-500 uppercase tracking-wider">
        {label.replace(/_/g, ' ')}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[0.55rem] text-red-400 font-bold uppercase mb-0.5">Before</div>
          <pre className="text-xs bg-red-950/30 border border-red-900/40 text-red-300 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all min-h-[32px]">
            {tryFormat(before) ?? '—'}
          </pre>
        </div>
        <div>
          <div className="text-[0.55rem] text-green-400 font-bold uppercase mb-0.5">After</div>
          <pre className="text-xs bg-green-950/30 border border-green-900/40 text-green-300 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all min-h-[32px]">
            {tryFormat(after) ?? '—'}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default function TimelinePage() {
  const { nodes } = useOutletContext()
  const [selected, setSelected] = useState(null)
  const selectedRef = useRef(null)
  const eventsRef = useRef([])
  const itemRefs = useRef([])
  const popupScrollRef = useRef(null)
  const popupScrollTargetRef = useRef(0)
  const popupScrollRafRef = useRef(null)

  useEffect(() => {
    const animatePopupScroll = () => {
      const el = popupScrollRef.current
      if (!el) { popupScrollRafRef.current = null; return }
      const diff = popupScrollTargetRef.current - el.scrollTop
      if (Math.abs(diff) < 0.5) {
        el.scrollTop = popupScrollTargetRef.current
        popupScrollRafRef.current = null
        return
      }
      el.scrollTop += diff * 0.14
      popupScrollRafRef.current = requestAnimationFrame(animatePopupScroll)
    }

    const scrollPopup = (delta) => {
      const el = popupScrollRef.current
      if (!el) return
      popupScrollTargetRef.current = Math.max(0, Math.min(popupScrollTargetRef.current + delta, el.scrollHeight - el.clientHeight))
      if (!popupScrollRafRef.current) popupScrollRafRef.current = requestAnimationFrame(animatePopupScroll)
    }

    const handleKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') { setSelected(null); return }
      if (selectedRef.current && (e.key === 'ArrowDown' || e.key === 'j')) {
        e.preventDefault()
        scrollPopup(80)
        return
      }
      if (selectedRef.current && (e.key === 'ArrowUp' || e.key === 'k')) {
        e.preventDefault()
        scrollPopup(-80)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'h') {
        e.preventDefault()
        const evts = eventsRef.current
        if (!evts.length) return
        const idx = evts.indexOf(selectedRef.current)
        if (idx < 0) setSelected(evts[0])
        else if (idx > 0) setSelected(evts[idx - 1])
      }
      if (e.key === 'ArrowRight' || e.key === 'l') {
        e.preventDefault()
        const evts = eventsRef.current
        if (!evts.length) return
        const idx = evts.indexOf(selectedRef.current)
        if (idx < 0) setSelected(evts[evts.length - 1])
        else if (idx < evts.length - 1) setSelected(evts[idx + 1])
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      if (popupScrollRafRef.current) cancelAnimationFrame(popupScrollRafRef.current)
    }
  }, [])

  const { events, snapshotMap } = useMemo(() => {
    const allNodes = nodes || []

    const metaNodes = allNodes
      .filter(n => n.type === FileType.METADATA || n.type === FileType.MAIN_METADATA)
      .filter(n => n.details.timestamp)
      .sort((a, b) => new Date(a.details.timestamp) - new Date(b.details.timestamp))

    const snapMap = {}
    allNodes
      .filter(n => n.type === FileType.SNAPSHOT)
      .forEach(n => {
        const d = n.details
        if (d.snapshot_id) snapMap[d.snapshot_id] = d
      })

    const timeline = metaNodes.map(({ details }, i) => {
      const prev = i > 0 ? metaNodes[i - 1].details : null
      let type = !prev
        ? 'init'
        : details.snapshot_id !== prev.snapshot_id
          ? 'A'
          : 'B'

      let branchSnapId = null
      let branchName = null

      if (prev && details.refs && prev.refs) {
        try {
          const currentRefs = JSONbig({ storeAsString: true }).parse(details.refs)
          const prevRefs = JSONbig({ storeAsString: true }).parse(prev.refs)

          for (const key of Object.keys(prevRefs)) {
            if (currentRefs[key] && prevRefs[key]) {
              const currentSnapId = currentRefs[key]['snapshot-id']
              const prevSnapId = prevRefs[key]['snapshot-id']
              if (currentSnapId !== prevSnapId) {
                branchSnapId = currentSnapId
                branchName = key
                break
              }
            }
          }
        } catch (e) {
          console.error("Failed to parse refs", e)
        }
      }

      if (type === 'B' && branchSnapId) {
        type = 'C'
      }

      const diff =
        (type === 'B' || type === 'C') && prev
          ? Object.keys(details)
            .filter(k => details[k] !== prev[k])
            .map(k => ({ key: k, before: prev[k], after: details[k] }))
          : []

      return {
        details,
        type,
        diff,
        snapshotId: type === 'C' ? branchSnapId : details.snapshot_id,
        branchName
      }
    })

    return { events: timeline, snapshotMap: snapMap }
  }, [nodes])

  useEffect(() => {
    selectedRef.current = selected
    popupScrollTargetRef.current = 0
    if (popupScrollRef.current) popupScrollRef.current.scrollTop = 0
  }, [selected])
  useEffect(() => { eventsRef.current = events }, [events])
  useEffect(() => {
    if (!selected) return
    const idx = eventsRef.current.indexOf(selected)
    if (idx >= 0 && itemRefs.current[idx]) {
      itemRefs.current[idx].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [selected])

  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117]">
        <p className="text-slate-500 text-sm italic">No metadata history available.</p>
      </div>
    )
  }

  const selectedSnap = selected ? snapshotMap[selected.snapshotId] : null

  const scrollRef = useRef(null)
  const targetScrollRef = useRef(0)
  const rafRef = useRef(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    targetScrollRef.current = el.scrollLeft
    const onWheel = (e) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      targetScrollRef.current = Math.max(
        0,
        Math.min(targetScrollRef.current + e.deltaY, el.scrollWidth - el.clientWidth)
      )
      if (rafRef.current) return
      const animate = () => {
        const diff = targetScrollRef.current - el.scrollLeft
        if (Math.abs(diff) < 0.5) {
          el.scrollLeft = targetScrollRef.current
          rafRef.current = null
          return
        }
        el.scrollLeft += diff * 0.12
        rafRef.current = requestAnimationFrame(animate)
      }
      rafRef.current = requestAnimationFrame(animate)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div className="flex-1 flex flex-col bg-[#0d1117] overflow-hidden">

      <div className="shrink-0 px-8 pt-5 flex items-center gap-5">
        {[['A', 'Write'], ['C', 'Branch Write'], ['B', 'Metadata Op'], ['init', 'Initial State']].map(([type, lbl]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorFor(type) }} />
            <span className="text-xs text-slate-400">{lbl}</span>
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="flex-1 flex items-center overflow-x-auto">
        <div className="flex items-start min-w-max px-16 py-12">
          {events.map((event, i) => {
            const ts = formatTs(event.details.timestamp)
            const fileName = shortFileName(event.details.file_path)
            return (
              <div key={i} className="flex items-center" ref={el => { itemRefs.current[i] = el }}>
                {i > 0 && (
                  <div className="flex flex-col items-center shrink-0">
                    <div className="text-[0.6rem] text-slate-500 mb-1">
                      {formatDuration(events[i - 1].details.timestamp, events[i].details.timestamp)}
                    </div>
                    <div className="flex items-center">
                      <div className="w-14 h-px bg-[#2d3748]" />
                      <div style={{
                        width: 0, height: 0,
                        borderTop: '4px solid transparent',
                        borderBottom: '4px solid transparent',
                        borderLeft: '7px solid #2d3748',
                      }} />
                    </div>
                  </div>
                )}
                <div
                  className="flex flex-col items-center gap-2 cursor-pointer group select-none"
                  onClick={() => setSelected(event)}
                >
                  <div className="text-center max-w-[160px]">
                    <div
                      className="text-xs font-mono font-bold leading-tight break-all"
                      style={{ color: colorFor(event.type) }}
                      title={event.details.file_path ?? ''}
                    >
                      {fileName}
                    </div>
                  </div>
                  <div
                    className={`w-11 h-11 rounded-full border-2 shadow-lg transition-transform group-hover:scale-110 shrink-0 ${selected === event ? 'scale-110' : ''}`}
                    style={{ backgroundColor: colorFor(event.type), borderColor: colorFor(event.type), ...(selected === event ? { outline: '2px solid white', outlineOffset: '3px' } : {}) }}
                  />
                  <div className="text-center max-w-[160px]">
                    {ts && (
                      <>
                        <div className="text-[0.7rem] text-slate-500 leading-tight">{ts.date}</div>
                        <div className="text-[0.7rem] text-slate-600 leading-tight">{ts.time}</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center font-sans"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-[50vw] min-w-[360px] max-w-[680px] bg-[#1a202c] rounded-xl shadow-2xl border border-[#2d3748] max-h-[80vh] flex flex-col overflow-hidden"
            style={{ borderLeft: `4px solid ${colorFor(selected.type)}` }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d3748] shrink-0">
              <div className="min-w-0 pr-4">
                <div className="font-bold text-sm" style={{ color: colorFor(selected.type) }}>
                  {labelFor(selected.type)}
                </div>
                <div className="text-xs font-mono text-[#e2e8f0] mt-0.5 break-all">
                  {selected.details.file_path}
                </div>
                {formatTs(selected.details.timestamp) && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    {formatTs(selected.details.timestamp).full}
                  </div>
                )}
              </div>
              <button
                className="w-7 h-7 rounded-full bg-[#2d3748] text-slate-400 flex items-center justify-center text-sm cursor-pointer hover:bg-[#3d4a5c] hover:text-slate-200 transition"
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>

            <div ref={popupScrollRef} className="overflow-y-auto px-6 py-5 flex flex-col gap-5">

              {selected.type === 'A' && (
                <>
                  <div className="flex justify-between items-center py-1.5 border-b border-[#2d3748]">
                    <span className="text-xs text-slate-400">Snapshot ID</span>
                    <span className="text-xs font-mono text-[#e2e8f0]">{selected.snapshotId ?? '—'}</span>
                  </div>
                  {selectedSnap && (
                    <>
                      <div>
                        <div className="text-[0.65rem] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Operation</div>
                        <span className="text-xs font-mono text-[#2E86C1] bg-[#1e3a5f] px-2.5 py-1 rounded">
                          {selectedSnap.operation ?? '—'}
                        </span>
                      </div>
                      {parseSummary(selectedSnap.summary).length > 0 && (
                        <div>
                          <div className="text-[0.65rem] font-bold text-slate-500 uppercase tracking-wider mb-2">Summary</div>
                          <div className="flex flex-col">
                            {parseSummary(selectedSnap.summary).map(({ key, value }) => (
                              <div key={key} className="flex justify-between items-center py-1.5 border-b border-[#2d3748] last:border-0">
                                <span className="text-xs text-slate-400">{key}</span>
                                <span className="text-xs font-mono text-[#e2e8f0]">{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {selected.type === 'C' && (
                <>
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-center py-1.5 border-b border-[#2d3748]">
                      <span className="text-xs text-slate-400">Branch Name</span>
                      <span className="text-xs font-bold text-[#D97706] bg-[#3a200a] px-2 py-0.5 rounded">{selected.branchName ?? '—'}</span>
                    </div>
                    <div className="flex justify-between items-center py-1.5 border-b border-[#2d3748]">
                      <span className="text-xs text-slate-400">Snapshot ID</span>
                      <span className="text-xs font-mono text-[#e2e8f0]">{selected.snapshotId ?? '—'}</span>
                    </div>
                    {selectedSnap && (
                      <>
                        <div>
                          <div className="text-[0.65rem] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Operation</div>
                          <span className="text-xs font-mono text-[#2E86C1] bg-[#1e3a5f] px-2.5 py-1 rounded">
                            {selectedSnap.operation ?? '—'}
                          </span>
                        </div>
                        {parseSummary(selectedSnap.summary).length > 0 && (
                          <div>
                            <div className="text-[0.65rem] font-bold text-slate-500 uppercase tracking-wider mb-2">Summary</div>
                            <div className="flex flex-col">
                              {parseSummary(selectedSnap.summary).map(({ key, value }) => (
                                <div key={key} className="flex justify-between items-center py-1.5 border-b border-[#2d3748] last:border-0">
                                  <span className="text-xs text-slate-400">{key}</span>
                                  <span className="text-xs font-mono text-[#e2e8f0]">{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="mt-4 border-t border-[#2d3748] pt-4">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Metadata Changes</div>
                    {selected.diff.length > 0
                      ? selected.diff.map(({ key, before, after }) => (
                        <DiffRow key={key} label={key} before={before} after={after} />
                      ))
                      : <p className="text-sm text-slate-400 italic">No tracked field changes detected.</p>
                    }
                  </div>
                </>
              )}

              {selected.type === 'B' && (
                selected.diff.length > 0
                  ? selected.diff.map(({ key, before, after }) => (
                    <DiffRow key={key} label={key} before={before} after={after} />
                  ))
                  : <p className="text-sm text-slate-400 italic">No tracked field changes detected.</p>
              )}

              {selected.type === 'init' && (
                <>
                  <div className="flex flex-col">
                    {[
                      ['Snapshot ID', selected.details.snapshot_id],
                      ['Schema ID', selected.details.current_schema_id],
                      ['Spec ID', selected.details.partition_spec_id],
                      ['Sort Order ID', selected.details.sort_order_id],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between items-center py-1.5 border-b border-[#2d3748] last:border-0">
                        <span className="text-xs text-slate-400">{label}</span>
                        <span className="text-xs font-mono text-[#e2e8f0]">{value ?? '—'}</span>
                      </div>
                    ))}
                  </div>

                  {selectedSnap && (
                    <>
                      <div>
                        <div className="text-[0.65rem] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Operation</div>
                        <span className="text-xs font-mono text-[#2E86C1] bg-[#1e3a5f] px-2.5 py-1 rounded">
                          {selectedSnap.operation ?? '—'}
                        </span>
                      </div>
                      {parseSummary(selectedSnap.summary).length > 0 && (
                        <div>
                          <div className="text-[0.65rem] font-bold text-slate-500 uppercase tracking-wider mb-2">Summary</div>
                          <div className="flex flex-col">
                            {parseSummary(selectedSnap.summary).map(({ key, value }) => (
                              <div key={key} className="flex justify-between items-center py-1.5 border-b border-[#2d3748] last:border-0">
                                <span className="text-xs text-slate-400">{key}</span>
                                <span className="text-xs font-mono text-[#e2e8f0]">{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {parseProperties(selected.details.properties).length > 0 && (
                    <div>
                      <div className="text-[0.65rem] font-bold text-slate-500 uppercase tracking-wider mb-2">Properties</div>
                      <div className="flex flex-col">
                        {parseProperties(selected.details.properties).map(({ key, value }) => (
                          <div key={key} className="flex justify-between items-start gap-4 py-1.5 border-b border-[#2d3748] last:border-0">
                            <span className="text-xs font-mono text-[#2E86C1] shrink-0">{key}</span>
                            <span className="text-xs text-[#e2e8f0] text-right break-all">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
