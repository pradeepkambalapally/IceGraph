import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import CopyIconButton from '../components/CopyIconButton'
import CopyableValue from '../components/CopyableValue'
import ResizableSidePanel from '../components/ResizableSidePanel'
import { FileType } from '../graphConstants'
import JSONbig from 'json-bigint'
import { parseUtcDate } from '../utils/dateUtils'
import { parseSummary } from '../utils/snapshotUtils'

const COLOR_A = '#1964B9'
const COLOR_B = '#6437D2'
const COLOR_C = '#D97706'
const COLOR_INIT = '#4a5568'

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

const ZOOM_MIN = 0.35
const ZOOM_MAX = 3
const DEFAULT_VIEW = { zoom: 1, panX: 0, panY: 0 }

function timelineSizes(zoom) {
  return {
    padY: 48 * zoom,
    padX: 64 * zoom,
    node: 44 * zoom,
    connector: 56 * zoom,
    gap: 8 * zoom,
    textMax: 160 * zoom,
    fontMicro: 9.6 * zoom,
    fontDetail: 11.2 * zoom,
    fontXs: 12 * zoom,
    arrowTop: 4 * zoom,
    arrowBottom: 4 * zoom,
    arrowLeft: 7 * zoom,
    nodeBorder: 2 * zoom,
    outline: 2 * zoom,
    outlineOffset: 3 * zoom,
    durMb: 4 * zoom,
  }
}

function contentNaturalSize(content, zoom) {
  return {
    width: content.offsetWidth / zoom,
    height: content.offsetHeight / zoom,
  }
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
        <span className="text-caption font-bold text-slate-500 uppercase tracking-widest">
          {label.replace(/_/g, ' ')}
        </span>
        <div className="bg-diff-bg border border-edge rounded-lg py-3 font-mono text-detail overflow-x-auto shadow-2xl flex flex-col">
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
      <span className="text-caption font-bold text-slate-500 uppercase tracking-wider">
        {label.replace(/_/g, ' ')}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-tiny text-red-400 font-bold uppercase mb-0.5">Before</div>
          <div className="relative">
            {before && <CopyIconButton text={tryFormat(before)} className="absolute top-1.5 right-1.5 z-10" />}
            <pre className="text-xs bg-red-950/30 border border-red-900/40 text-red-300 rounded p-2 pr-9 overflow-x-auto whitespace-pre-wrap break-all min-h-8">
              {tryFormat(before) ?? '—'}
            </pre>
          </div>
        </div>
        <div>
          <div className="text-tiny text-green-400 font-bold uppercase mb-0.5">After</div>
          <div className="relative">
            {after && <CopyIconButton text={tryFormat(after)} className="absolute top-1.5 right-1.5 z-10" />}
            <pre className="text-xs bg-green-950/30 border border-green-900/40 text-green-300 rounded p-2 pr-9 overflow-x-auto whitespace-pre-wrap break-all min-h-8">
              {tryFormat(after) ?? '—'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

function PanelCopyRow({ label, value, valueClassName = '' }) {
  return (
    <div className="flex flex-col gap-1 py-1.5 border-b border-edge last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <CopyableValue value={value} mono className={valueClassName} />
    </div>
  )
}

function SnapSummary({ summary }) {
  const rows = parseSummary(summary)
  if (rows.length === 0) return null
  return (
    <div>
      <div className="text-caption font-bold text-slate-500 uppercase tracking-wider mb-2">Summary</div>
      <div className="flex flex-col gap-2">
        {rows.map(({ key, value }) => (
          <PanelCopyRow key={key} label={key} value={value} />
        ))}
      </div>
    </div>
  )
}

function DiffList({ diff }) {
  const rows = diff.filter(({ key }) => key !== 'type')
  return rows.length > 0
    ? rows.map(({ key, before, after }) => <DiffRow key={key} label={key} before={before} after={after} />)
    : <p className="text-sm text-slate-400 italic">No tracked field changes detected.</p>
}

export default function TimelinePage() {
  const { nodes } = useOutletContext()
  const [selected, setSelected] = useState(null)
  const [view, setView] = useState(DEFAULT_VIEW)
  const [isDragging, setIsDragging] = useState(false)
  const selectedRef = useRef(null)
  const eventsRef = useRef([])
  const viewportRef = useRef(null)
  const contentRef = useRef(null)
  const dragRef = useRef(null)
  const didPanRef = useRef(false)
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

  const fitTimeline = () => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const padding = 48
    const { width, height } = contentNaturalSize(content, view.zoom)
    const fitZoom = Math.min(
      1,
      (viewport.clientWidth - padding) / width,
      (viewport.clientHeight - padding) / height,
    )
    setView({
      zoom: fitZoom,
      panX: (viewport.clientWidth - width * fitZoom) / 2,
      panY: (viewport.clientHeight - height * fitZoom) / 2,
    })
  }

  useEffect(() => {
    selectedRef.current = selected
    popupScrollTargetRef.current = 0
    if (popupScrollRef.current) popupScrollRef.current.scrollTop = 0
  }, [selected])
  useEffect(() => { eventsRef.current = events }, [events])

  useEffect(() => {
    if (events.length === 0) return
    const id = requestAnimationFrame(fitTimeline)
    return () => cancelAnimationFrame(id)
  }, [events.length])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const onWheel = (e) => {
      e.preventDefault()
      const rect = viewport.getBoundingClientRect()

      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setView(v => ({ ...v, panX: v.panX - e.deltaX }))
        return
      }
      if (e.shiftKey) {
        setView(v => ({ ...v, panX: v.panX - e.deltaY }))
        return
      }

      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.002)
      setView(v => {
        const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor))
        const scale = newZoom / v.zoom
        return {
          zoom: newZoom,
          panX: cx - (cx - v.panX) * scale,
          panY: cy - (cy - v.panY) * scale,
        }
      })
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.x
      const dy = e.clientY - dragRef.current.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPanRef.current = true
      setView(v => ({
        ...v,
        panX: dragRef.current.panX + dx,
        panY: dragRef.current.panY + dy,
      }))
    }
    const onMouseUp = () => { dragRef.current = null; setIsDragging(false) }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const startPan = (e) => {
    if (e.button !== 0) return
    dragRef.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY }
    didPanRef.current = false
    setIsDragging(true)
  }

  const selectEvent = (event) => {
    if (!didPanRef.current) setSelected(event)
  }

  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-canvas">
        <p className="text-slate-500 text-sm italic">No metadata history available.</p>
      </div>
    )
  }

  const selectedSnap = selected ? snapshotMap[selected.snapshotId] : null
  const closePanel = () => setSelected(null)
  const tl = timelineSizes(view.zoom)

  return (
    <div className="flex-1 flex flex-col bg-canvas overflow-hidden relative">

      <div className="shrink-0 px-8 pt-5 flex items-center gap-5">
        {[['A', 'Write'], ['C', 'Branch Write'], ['B', 'Metadata Op'], ['init', 'Initial State']].map(([type, lbl]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorFor(type) }} />
            <span className="text-xs text-slate-400">{lbl}</span>
          </div>
        ))}
      </div>

      <div
        ref={viewportRef}
        className={`flex-1 relative overflow-hidden ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={startPan}
      >
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${view.panX}px, ${view.panY}px)` }}
        >
          <div
            ref={contentRef}
            className="flex items-start min-w-max"
            style={{ padding: `${tl.padY}px ${tl.padX}px` }}
          >
          {events.map((event, i) => {
            const ts = formatTs(event.details.timestamp)
            const fileName = shortFileName(event.details.file_path)
            return (
              <div key={i} className="flex items-center">
                {i > 0 && (
                  <div className="flex flex-col items-center shrink-0">
                    <div
                      className="text-slate-500"
                      style={{ fontSize: tl.fontMicro, marginBottom: tl.durMb }}
                    >
                      {formatDuration(events[i - 1].details.timestamp, events[i].details.timestamp)}
                    </div>
                    <div className="flex items-center">
                      <div className="h-px bg-edge" style={{ width: tl.connector }} />
                      <div style={{
                        width: 0, height: 0,
                        borderTop: `${tl.arrowTop}px solid transparent`,
                        borderBottom: `${tl.arrowBottom}px solid transparent`,
                        borderLeft: `${tl.arrowLeft}px solid #2d3748`,
                      }} />
                    </div>
                  </div>
                )}
                <div
                  className="flex flex-col items-center cursor-pointer select-none"
                  style={{ gap: tl.gap }}
                  onClick={() => selectEvent(event)}
                >
                  <div className="text-center" style={{ maxWidth: tl.textMax }}>
                    <div
                      className="font-mono font-bold leading-tight break-all"
                      style={{ fontSize: tl.fontXs, color: colorFor(event.type) }}
                      title={event.details.file_path ?? ''}
                    >
                      {fileName}
                    </div>
                  </div>
                  <div
                    className="rounded-full shadow-lg shrink-0 transition-[outline]"
                    style={{
                      width: tl.node,
                      height: tl.node,
                      borderWidth: tl.nodeBorder,
                      borderStyle: 'solid',
                      backgroundColor: colorFor(event.type),
                      borderColor: colorFor(event.type),
                      ...(selected === event ? { outline: `${tl.outline}px solid white`, outlineOffset: tl.outlineOffset } : {}),
                    }}
                  />
                  <div className="text-center" style={{ maxWidth: tl.textMax }}>
                    {ts && (
                      <>
                        <div className="text-slate-500 leading-tight" style={{ fontSize: tl.fontDetail }}>{ts.date}</div>
                        <div className="text-slate-600 leading-tight" style={{ fontSize: tl.fontDetail }}>{ts.time}</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          </div>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 flex flex-col gap-2 z-10 font-sans w-52">
        <button
          type="button"
          className="w-full py-2.5 rounded-lg cursor-pointer font-bold text-xs uppercase tracking-wide shadow-md transition bg-surface text-accent border border-accent hover:bg-edge"
          onClick={fitTimeline}
          onMouseDown={e => e.preventDefault()}
        >
          Fit Timeline
        </button>
        <div className="text-center text-tiny text-slate-500 tabular-nums">
          {Math.round(view.zoom * 100)}%
        </div>
      </div>

      {selected && (
        <ResizableSidePanel
          ref={popupScrollRef}
          accentColor={colorFor(selected.type)}
          onClose={closePanel}
          header={(
            <div className="min-w-0 pr-4">
              <div className="font-semibold text-xs" style={{ color: colorFor(selected.type) }}>
                {labelFor(selected.type)}
              </div>
              <div className="text-xs font-mono text-ink mt-0.5 break-all">
                {selected.details.file_path}
              </div>
              {formatTs(selected.details.timestamp) && (
                <div className="text-xs text-slate-500 mt-0.5">
                  {formatTs(selected.details.timestamp).full}
                </div>
              )}
            </div>
          )}
        >
          {selected.type === 'A' && (
            <>
              <PanelCopyRow label="Snapshot ID" value={selected.snapshotId} />
              {selectedSnap && (
                <>
                  <PanelCopyRow label="Operation" value={selectedSnap.operation} />
                  <SnapSummary summary={selectedSnap.summary} />
                </>
              )}
            </>
          )}

          {selected.type === 'C' && (
            <>
              <PanelCopyRow label="Branch Name" value={selected.branchName} />
              <PanelCopyRow label="Snapshot ID" value={selected.snapshotId} />
              {selectedSnap && (
                <>
                  <PanelCopyRow label="Operation" value={selectedSnap.operation} />
                  <SnapSummary summary={selectedSnap.summary} />
                </>
              )}
              <div className="mt-2 border-t border-edge pt-4">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Metadata Changes</div>
                <DiffList diff={selected.diff} />
              </div>
            </>
          )}

          {selected.type === 'B' && <DiffList diff={selected.diff} />}

          {selected.type === 'init' && (
            <>
              <PanelCopyRow label="Snapshot ID" value={selected.details.snapshot_id} />
              <PanelCopyRow label="Schema ID" value={selected.details.current_schema_id} />
              <PanelCopyRow label="Spec ID" value={selected.details.partition_spec_id} />
              <PanelCopyRow label="Sort Order ID" value={selected.details.sort_order_id} />
              {selectedSnap && (
                <>
                  <PanelCopyRow label="Operation" value={selectedSnap.operation} />
                  <SnapSummary summary={selectedSnap.summary} />
                </>
              )}
              {parseProperties(selected.details.properties).length > 0 && (
                <div>
                  <div className="text-caption font-bold text-slate-500 uppercase tracking-wider mb-2">Properties</div>
                  <div className="flex flex-col gap-2">
                    {parseProperties(selected.details.properties).map(({ key, value }) => (
                      <PanelCopyRow key={key} label={key} value={value} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </ResizableSidePanel>
      )}
    </div>
  )
}
