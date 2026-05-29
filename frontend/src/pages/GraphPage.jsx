import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useLocation, useOutletContext } from 'react-router-dom'
import ForceGraph2D from 'react-force-graph-2d'
import {
  GRAPH_SETTINGS,
  DELETED_DATA_FILE_CONNECTION_COLOR,
  FileType,
} from '../graphConstants'
import JSONbig from 'json-bigint'

const POPUP_KEYS = 'abdefgmnopqstuvwxyz'

const NODE_FONT_SIZE = 80
const NODE_FONT = `500 ${NODE_FONT_SIZE}px "system-ui"`
const LINK_FONT_SIZE = 60
const LINK_FONT = `500 ${LINK_FONT_SIZE}px "system-ui"`
const NODE_PADDING = 40
const LINK_CURVATURE = 0.1
const DELETED_CONNECTION_LABLE = "deleted"

const STICKY_SECTION_LINE_COUNT_COLLAPSE = 15

function getLineage(nodeId, links) {
  const relatedNodes = new Set([String(nodeId)])

  const toLinks = {}
  const fromLinks = {}

  links.forEach(l => {
    const s = String(l.source.id ?? l.source)
    const t = String(l.target.id ?? l.target)
    if (!toLinks[s]) toLinks[s] = []
    if (!fromLinks[t]) fromLinks[t] = []
    toLinks[s].push(t)
    fromLinks[t].push(s)
  })

  const traverse = (currentId, direction) => {
    const neighbors = direction === 'to' ? (toLinks[currentId] || []) : (fromLinks[currentId] || [])
    neighbors.forEach(neighborId => {
      if (!relatedNodes.has(neighborId)) {
        relatedNodes.add(neighborId)
        traverse(neighborId, direction)
      }
    })
  }

  traverse(String(nodeId), 'to')
  traverse(String(nodeId), 'from')

  return relatedNodes
}

function DetailRow({ r }) {
  const tryParseJson = (str) => {
    try { return JSONbig({ storeAsString: true }).parse(str) } catch { return undefined }
  }

  let displayValue = r.value
  const parsed = tryParseJson(r.value)
  if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
    displayValue = JSON.stringify(parsed, null, 2)
  }

  const lineCount = displayValue.split('\n').length
  const isCollapsible = lineCount > STICKY_SECTION_LINE_COUNT_COLLAPSE
  const [isCollapsed, setIsCollapsed] = useState(true)

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="block font-bold text-slate-500 text-[0.65rem] uppercase tracking-wider">
          {r.label}
        </span>
        {isCollapsible && (
          <button
            onClick={() => setIsCollapsed(p => !p)}
            className="text-[0.6rem] font-bold uppercase tracking-wide text-[#2E86C1] hover:text-white transition ml-2 shrink-0"
          >
            {isCollapsed ? `▼ Show all (${lineCount} lines)` : '▲ Collapse'}
          </button>
        )}
      </div>
      <span
        className="block font-mono bg-[#0d1117] text-slate-200 px-3 py-2 rounded-lg text-xs whitespace-pre overflow-x-auto break-normal"
        style={isCollapsible && isCollapsed ? {
          maxHeight: '10lh',
          overflow: 'hidden',
          maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
        } : {}}
      >
        {displayValue}
      </span>
    </div>
  )
}

export default function GraphPage() {
  const { nodes: rawNodes, edges: rawEdges, errors } = useOutletContext()

  const location = useLocation()
  const fgRef = useRef()
  const hasInitialized = useRef(false)
  const isResettingRef = useRef(false)

  const [highlightNodes, setHighlightNodes] = useState(new Set())
  const [isInspectMode, setIsInspectMode] = useState(true)
  const [isFullView, setIsFullView] = useState(true)
  const [stickyNode, setStickyNodeInternal] = useState(null)
  const [movementPopup, setMovementPopup] = useState(null)

  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 70
  });

  const isInspectModeRef = useRef(isInspectMode)
  const highlightNodesRef = useRef(highlightNodes)
  const stickyNodeRef = useRef(null)
  const setStickyNode = useCallback((val) => {
    const next = val
    stickyNodeRef.current = next
    if (next) sessionStorage.setItem('last_graph_selection', next.id)
    setStickyNodeInternal(next)
  }, [])
  const graphDataRef = useRef({ nodes: [], links: [] })
  const treeMapRef = useRef({ incoming: {}, outgoing: {} })
  const movementPopupRef = useRef(null)
  const stickyPanelRef = useRef(null)
  const stickyScrollTargetRef = useRef(0)
  const stickyScrollRafRef = useRef(null)
  const popupListRef = useRef(null)
  const popupScrollTargetRef = useRef(0)
  const popupScrollRafRef = useRef(null)

  useEffect(() => { isInspectModeRef.current = isInspectMode }, [isInspectMode])
  useEffect(() => { highlightNodesRef.current = highlightNodes }, [highlightNodes])
  useEffect(() => {
    movementPopupRef.current = movementPopup
    if (!movementPopup) {
      popupScrollTargetRef.current = 0
      if (popupListRef.current) popupListRef.current.scrollTop = 0
    }
  }, [movementPopup])

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight - 70
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [])

  const graphData = useMemo(() => {
    if (!rawNodes) return { nodes: [], links: [] }

    const nodeArray = rawNodes
    const edgeArray = rawEdges || []

    const processedNodes = nodeArray.map(n => {
      return {
        ...n,
        color: n.color,
        level: n.level,
      }
    })

    const processedLinks = edgeArray.map(e => ({
      source: e.from,
      target: e.to,
      color: e.color || '#999',
      label: e.color === DELETED_DATA_FILE_CONNECTION_COLOR
        ? DELETED_CONNECTION_LABLE
        : (e.branch_names || ''),
    }))

    const { levelSeparation, nodeSpacing } = GRAPH_SETTINGS
    const levelsMap = {}
    processedNodes.forEach(n => {
      const level = n.level || 0
      if (!levelsMap[level]) levelsMap[level] = []
      levelsMap[level].push(n)
    })

    Object.entries(levelsMap).forEach(([level, nodes]) => {
      const x = parseInt(level) * levelSeparation
      const totalHeight = (nodes.length - 1) * nodeSpacing
      nodes.forEach((node, i) => {
        node.fx = node.originalFx = x
        node.fy = node.originalFy = (i * nodeSpacing) - (totalHeight / 2)
      })
    })

    return { nodes: processedNodes, links: processedLinks }
  }, [rawNodes, rawEdges])
  useEffect(() => { graphDataRef.current = graphData }, [graphData])

  const treeMap = useMemo(() => {
    const incoming = {}
    const outgoing = {}
      ; (rawEdges || []).forEach(e => {
        const src = String(e.from)
        const tgt = String(e.to)
        if (!outgoing[src]) outgoing[src] = []
        if (!incoming[tgt]) incoming[tgt] = []
        outgoing[src].push(tgt)
        incoming[tgt].push(src)
      })
    return { incoming, outgoing }
  }, [rawEdges])
  useEffect(() => { treeMapRef.current = treeMap }, [treeMap])

  const resetZoom = useCallback(() => {
    graphData.nodes.forEach(node => {
      node.fx = node.originalFx
      node.fy = node.originalFy
      node.x = node.originalFx
      node.y = node.originalFy
      node.vx = 0
      node.vy = 0
    })

    isResettingRef.current = true
    fgRef.current?.zoomToFit(500, 50)
    setTimeout(() => { isResettingRef.current = false }, 700)
  }, [graphData])

  const navigateTo = useCallback((node) => {
    setStickyNode(node)
    setHighlightNodes(getLineage(node.id, graphDataRef.current.links))
    setIsFullView(false)
    fgRef.current?.centerAt(node.fx ?? node.x, node.fy ?? node.y, 300)
    history.pushState({ graphSelection: node.id }, '')
    stickyScrollTargetRef.current = 0
    if (stickyPanelRef.current) stickyPanelRef.current.scrollTop = 0
  }, [])

  const deselectNode = useCallback(() => {
    setHighlightNodes(new Set())
    setStickyNode(null)
    history.replaceState({ graphSelection: null }, '')
  }, [])

  const resetView = useCallback(() => {
    deselectNode()
    setIsFullView(true)
    sessionStorage.removeItem('last_graph_selection')
    resetZoom()
  }, [deselectNode, resetZoom])

  useEffect(() => {
    const goToNeighbors = (neighborIds, direction) => {
      const { nodes } = graphDataRef.current
      const neighbors = neighborIds.map(id => nodes.find(n => String(n.id) === String(id))).filter(Boolean)
      if (!neighbors.length) return
      if (neighbors.length === 1) { navigateTo(neighbors[0]); return }
      const keyLen = Math.floor(neighbors.length / POPUP_KEYS.length) + 1
      const combos = neighbors.map((_, i) => {
        let combo = '', num = i
        for (let k = 0; k < keyLen; k++) { combo = POPUP_KEYS[num % POPUP_KEYS.length] + combo; num = Math.floor(num / POPUP_KEYS.length) }
        return combo
      })
      setMovementPopup({ nodes: neighbors, direction, combos, keyLen, input: '' })
    }

    const makeScroller = (targetRef, rafRef, elRef) => (delta) => {
      const el = elRef.current
      if (!el) return
      targetRef.current = Math.max(0, Math.min(targetRef.current + delta, el.scrollHeight - el.clientHeight))
      if (rafRef.current) return
      const animate = () => {
        const diff = targetRef.current - el.scrollTop
        if (Math.abs(diff) < 0.5) { el.scrollTop = targetRef.current; rafRef.current = null; return }
        el.scrollTop += diff * 0.14
        rafRef.current = requestAnimationFrame(animate)
      }
      rafRef.current = requestAnimationFrame(animate)
    }
    const scrollSticky = makeScroller(stickyScrollTargetRef, stickyScrollRafRef, stickyPanelRef)
    const scrollPopup = makeScroller(popupScrollTargetRef, popupScrollRafRef, popupListRef)

    const handleKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'i') { setIsInspectMode(p => !p); return }
      if (e.key === 'c') { resetZoom(); return }
      if (e.key === 'r') { resetView(); return }

      if (movementPopupRef.current && (e.key === 'j' || e.key === 'ArrowDown')) {
        e.preventDefault(); scrollPopup(80); return
      }
      if (movementPopupRef.current && (e.key === 'k' || e.key === 'ArrowUp')) {
        e.preventDefault(); scrollPopup(-80); return
      }
      if (stickyNodeRef.current && (e.key === 'j' || e.key === 'ArrowDown')) {
        e.preventDefault(); scrollSticky(80); return
      }
      if (stickyNodeRef.current && (e.key === 'k' || e.key === 'ArrowUp')) {
        e.preventDefault(); scrollSticky(-80); return
      }

      if (movementPopupRef.current) {
        if (e.key === 'Escape') { setMovementPopup(null); return }
        const popup = movementPopupRef.current
        const char = e.key.toLowerCase()
        if (!POPUP_KEYS.includes(char)) return
        const newInput = popup.input + char
        if (newInput.length === popup.keyLen) {
          const idx = popup.combos.indexOf(newInput)
          if (idx >= 0) { navigateTo(popup.nodes[idx]); setMovementPopup(null) }
          else setMovementPopup({ ...popup, input: '' })
        } else {
          setMovementPopup({ ...popup, input: newInput })
        }
        return
      }

      if (e.key === 'Escape') { setStickyNode(null); return }

      if (isInspectModeRef.current) return

      if (e.key === 'Enter' || e.key === ' ') {
        if (stickyNodeRef.current) return
        const mainMeta = graphDataRef.current.nodes.find(n => n.type === FileType.MAIN_METADATA)
        if (mainMeta) navigateTo(mainMeta)
        return
      }
      if (e.key === 'h' || e.key === 'ArrowLeft') {
        e.preventDefault()
        if (!stickyNodeRef.current) return
        goToNeighbors(treeMapRef.current.incoming[String(stickyNodeRef.current.id)] || [], 'in')
        return
      }
      if (e.key === 'l' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (!stickyNodeRef.current) return
        goToNeighbors(treeMapRef.current.outgoing[String(stickyNodeRef.current.id)] || [], 'out')
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      if (stickyScrollRafRef.current) cancelAnimationFrame(stickyScrollRafRef.current)
      if (popupScrollRafRef.current) cancelAnimationFrame(popupScrollRafRef.current)
    }
  }, [navigateTo, resetZoom, resetView])

  useEffect(() => {
    if (!history.state || !('graphSelection' in history.state)) {
      history.replaceState({ graphSelection: null }, '')
    }

    const handlePopState = (e) => {
      if (!e.state || !('graphSelection' in e.state)) return
      const nodeId = e.state.graphSelection

      if (nodeId === null) {
        resetView()
        return
      }

      const node = graphData.nodes.find(n => String(n.id) === String(nodeId))
      if (node) {
        const lineage = getLineage(node.id, graphData.links)
        setHighlightNodes(lineage)
        fgRef.current?.centerAt(node.fx ?? node.x, node.fy ?? node.y, 500)
        setStickyNode(node)
        setIsFullView(false)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [graphData, resetView])

  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0 || hasInitialized.current) return
    hasInitialized.current = true
    fgRef.current.d3ReheatSimulation()

    const historyId = history.state?.graphSelection
    const locationId = location.state?.selectNodeId
    const sessionId = sessionStorage.getItem('last_graph_selection')
    const targetNodeId = historyId || locationId || sessionId

    if (targetNodeId) {
      const node = graphData.nodes.find(n => String(n.id) === String(targetNodeId))
      if (node) {
        const lineage = getLineage(node.id, graphData.links)
        setHighlightNodes(lineage)
        setStickyNode(node)
        setIsFullView(false)

        if (location.state?.selectNodeId) {
          history.replaceState({ graphSelection: targetNodeId }, '')
        }

        setTimeout(() => {
          fgRef.current?.centerAt(node.originalFx ?? node.fx ?? node.x, node.originalFy ?? node.fy ?? node.y, 500)
        }, 100)
      }
    } else {
      setTimeout(() => resetView(), 100)
    }
  }, [graphData, location.state, resetView])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!fgRef.current || graphData.nodes.length === 0) return
      if (document.hidden) {
        graphData.nodes.forEach(node => {
          node._savedFx = node.fx
          node._savedFy = node.fy
          node.fx = node.x
          node.fy = node.y
        })
      } else {
        graphData.nodes.forEach(node => {
          node.fx = node._savedFx !== undefined ? node._savedFx : node.fx
          node.fy = node._savedFy !== undefined ? node._savedFy : node.fy
        })
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [graphData])

  const handleNodeClick = useCallback((node) => {
    if (!isInspectModeRef.current) {
      const lineage = getLineage(node.id, graphData.links)
      setHighlightNodes(lineage)
      setIsFullView(false)
      fgRef.current.centerAt(node.fx ?? node.x, node.fy ?? node.y, 500)
    }
    setStickyNode(node)
    history.pushState({ graphSelection: node.id }, '')
  }, [graphData])

  const paintNode = useCallback((node, ctx) => {
    const label = node.label || String(node.id)

    ctx.font = NODE_FONT
    if (!node.__pillW) {
      const w = ctx.measureText(label).width + NODE_PADDING * 2
      const h = NODE_FONT_SIZE + NODE_PADDING
      node.__pillW = w
      node.__pillH = h
    }

    const w = node.__pillW
    const h = node.__pillH
    const x = Math.round(node.x - w / 2)
    const y = Math.round(node.y - h / 2)

    ctx.shadowBlur = 0

    ctx.beginPath()
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, 4)
    } else {
      ctx.rect(x, y, w, h)
    }

    ctx.fillStyle = node.color || '#2d3748'
    ctx.fill()

    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 10.00
    ctx.lineJoin = 'round'
    ctx.strokeText(label, node.x, node.y)

    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, node.x, node.y)

    ctx.lineWidth = 1
  }, [])

  const paintPointerArea = useCallback((node, color, ctx) => {
    const w = node.__pillW || 40
    const h = node.__pillH || 20
    ctx.fillStyle = color
    ctx.fillRect(node.x - w / 2, node.y - h / 2, w, h)
  }, [])

  const linkCurvatures = useMemo(() => {
    const map = new Map()
    graphData.links.forEach(l => { map.set(l, !l.label || l.label === DELETED_CONNECTION_LABLE ? 0 : LINK_CURVATURE) })
    return map
  }, [graphData.links])

  const paintLink = useCallback((link, ctx) => {
    if (!link.label) return

    const position = link.label === DELETED_CONNECTION_LABLE ? 0.5 : 0.25

    const start = link.source
    const end = link.target
    const sx = typeof start === 'object' ? start.x : null
    const sy = typeof start === 'object' ? start.y : null
    const ex = typeof end === 'object' ? end.x : null
    const ey = typeof end === 'object' ? end.y : null
    if (sx == null || ex == null) return

    const curvature = linkCurvatures.get(link) || 0
    let qX = sx + (ex - sx) * position
    let qY = sy + (ey - sy) * position
    if (curvature !== 0) {
      const dx = ex - sx
      const dy = ey - sy
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      qX += (dy / len) * curvature * len * position
      qY += (-dx / len) * curvature * len * position
    }
    ctx.shadowBlur = 0
    ctx.font = LINK_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#e3f8f5ff'
    ctx.fillText(link.label, qX, qY)
  }, [linkCurvatures])

  const nodeVisibility = useCallback((n) => {
    const hl = highlightNodesRef.current
    return hl.size === 0 || hl.has(String(n.id))
  }, [])

  const linkVisibility = useCallback((l) => {
    const hl = highlightNodesRef.current
    if (hl.size === 0) return true
    const s = String(l.source.id || l.source)
    const t = String(l.target.id || l.target)
    return hl.has(s) && hl.has(t)
  }, [])

  const sticky = stickyNode ? {
    title: stickyNode.details.type, rows: Object.entries(stickyNode.details).map(([label, value]) => ({
      label,
      value
    }))
  } : null

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        height: 'calc(100vh - 70px)',
        backgroundColor: '#0d1117',
        backgroundImage: 'radial-gradient(circle, #2d3748 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        backgroundColor="#00000000"
        nodeLabel={() => ""}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}

        nodeVisibility={nodeVisibility}
        linkVisibility={linkVisibility}

        linkWidth={1}
        linkColor={l => l.color}
        linkCurvature={l => linkCurvatures.get(l) || 0}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        linkCanvasObjectMode={() => 'after'}
        linkCanvasObject={paintLink}

        onNodeClick={handleNodeClick}
        onNodeDrag={() => setTimeout(() => setIsFullView(false), 0)}
        onNodeDragEnd={() => setTimeout(() => setIsFullView(false), 0)}
        onZoom={() => { if (!isResettingRef.current) setTimeout(() => setIsFullView(false), 0) }}

        warmupTicks={1}
        cooldownTicks={0}
        d3AlphaDecay={1}
      />

      <div className="absolute top-4 left-4 flex flex-col gap-2 z-[10] font-sans w-[200px]">
        <button
          className={`w-full py-2.5 rounded-lg cursor-pointer font-bold text-xs uppercase tracking-wide shadow-md transition
            ${isFullView
              ? 'bg-[#2E86C1] text-white hover:bg-[#2471a3]'
              : 'bg-[#1a202c] text-[#2E86C1] border border-[#2E86C1] hover:bg-[#2d3748]'
            }`}
          onClick={() => !isFullView && resetView()}
          onMouseDown={e => e.preventDefault()}
        >
          Reset Full View
        </button>

        <button
          className={`w-full flex overflow-hidden rounded-lg cursor-pointer font-bold text-xs uppercase tracking-wide shadow-md transition
            ${isInspectMode
              ? 'bg-[#2E86C1] text-white border border-[#2E86C1] hover:bg-[#2471a3]'
              : 'bg-[#1a202c] text-[#2E86C1] border border-[#2E86C1] hover:bg-[#2d3748]'
            }`}
          onClick={() => setIsInspectMode(p => !p)}
          onMouseDown={e => e.preventDefault()}
        >
          <span className="w-9 flex items-center justify-center text-lg bg-black/5 shrink-0 py-2.5">
            {isInspectMode ? '🔒' : '🔍'}
          </span>
          <span className="flex-1 flex items-center justify-center py-2.5 px-2 leading-tight">
            {isInspectMode ? 'Inspect (Locked)' : 'Lineage Traversal'}
          </span>
        </button>

        <button
          className="w-full py-2.5 rounded-lg cursor-pointer font-bold text-xs uppercase tracking-wide shadow-md transition bg-[#1a202c] text-[#2E86C1] border border-[#2E86C1] hover:bg-[#2d3748]"
          onClick={() => resetZoom()}
          onMouseDown={e => e.preventDefault()}
        >
          Center Graph
        </button>
      </div>

      {movementPopup && (
        <div className="absolute inset-0 flex items-center justify-center z-[1100] pointer-events-none">
          <div className="bg-[#1a202c]/57 backdrop-blur-md border border-[#2d3748] rounded-xl shadow-2xl p-4 pointer-events-auto w-[70vw] font-sans">
            <div className="text-[0.65rem] font-bold text-slate-500 uppercase tracking-wider mb-3">
              {movementPopup.direction === 'in' ? 'Navigate to parent' : 'Navigate to child'}
            </div>
            <div ref={popupListRef} className="flex flex-col max-h-[60vh] overflow-y-auto">
              {movementPopup.nodes.map((node, i) => {
                const combo = movementPopup.combos[i]
                const typed = movementPopup.input
                return (
                  <button
                    key={node.id}
                    onClick={() => { navigateTo(node); setMovementPopup(null) }}
                    className="flex items-center gap-3 py-2 px-2 border-b border-[#2d3748] last:border-0 hover:bg-[#252d3d] rounded transition cursor-pointer text-left"
                  >
                    <span className="rounded bg-[#2E86C1]/35 text-xs font-bold font-mono px-1.5 py-0.5 shrink-0 tracking-widest border border-[#2E86C1]">
                      <span className="text-white">{combo.slice(0, typed.length)}</span>
                      <span className="text-white">{combo.slice(typed.length)}</span>
                    </span>
                    <span className="text-sm text-[#e2e8f0] font-mono">{node.label}</span>
                  </button>
                )
              })}
            </div>
            {movementPopup.keyLen > 1 && (
              <div className="mt-3 font-mono text-sm text-center text-slate-300 tracking-widest min-h-[1.5em]">
                {movementPopup.input || <span className="text-slate-600">type combo…</span>}
              </div>
            )}
            <div className="text-xs text-slate-400 mt-2">Type combo to select · Esc to cancel</div>
          </div>
        </div>
      )}

      {sticky && (
        <div
          ref={stickyPanelRef}
          className="absolute top-4 right-4 w-[400px] max-h-[88vh] overflow-y-auto bg-[#1a202c] border-l-4 rounded-xl z-[1000] shadow-xl"
          style={{ borderLeftColor: stickyNode.color }}
        >
          <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-[#2d3748]">
            <div className="font-bold text-base text-[#e2e8f0] pr-6 leading-snug">{sticky.title.toUpperCase()}</div>
            <button
              className="w-7 h-7 rounded-full bg-[#2d3748] text-slate-400 flex items-center justify-center text-base cursor-pointer hover:bg-[#3d4a5c] hover:text-slate-200 transition shrink-0"
              onClick={() => setStickyNode(null)}
              onMouseDown={e => e.preventDefault()}
            >
              ✕
            </button>
          </div>
          <div className="px-5 py-4 flex flex-col gap-3">
            {isInspectMode && (
              <span className="inline-flex items-center gap-1.5 bg-[#2E86C1]/10 text-[#2E86C1] px-2.5 py-1 rounded-md text-[0.65rem] font-bold uppercase tracking-wide w-fit">
                🔒 Locked View
              </span>
            )}
            {sticky.rows.filter((r) => r.value !== '').map((r, i) => <DetailRow key={i} r={r} />)}
          </div>
        </div>
      )}
    </div>
  )
}