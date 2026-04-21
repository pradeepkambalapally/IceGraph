import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useLocation, useOutletContext } from 'react-router-dom'
import ForceGraph2D from 'react-force-graph-2d'
import {
  UI_NEWLINE,
  UI_SECTION_NEWLINE,
  GRAPH_SETTINGS,
  DELETED_DATA_FILE_CONNECTION_COLOR
} from '../graphConstants'
import JSONbig from 'json-bigint'

const NODE_FONT_SIZE = 80
const NODE_FONT = `500 ${NODE_FONT_SIZE}px "Inter","system-ui","-apple-system","Segoe UI","Roboto","sans-serif"`
const LINK_FONT_SIZE = 60
const LINK_FONT = `500 ${LINK_FONT_SIZE}px "Inter","system-ui","-apple-system","Segoe UI","Roboto","sans-serif"`
const NODE_PADDING = 40
const LINK_CURVATURE = 0.1
const DELETED_CONNECTION_LABLE = "deleted"

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

export default function GraphPage() {
  const { nodes: rawNodes, edges: rawEdges, errors } = useOutletContext()

  const location = useLocation()
  const fgRef = useRef()
  const hasInitialized = useRef(false)
  const isResettingRef = useRef(false)

  const [highlightNodes, setHighlightNodes] = useState(new Set())
  const [isInspectMode, setIsInspectMode] = useState(true)
  const [isFullView, setIsFullView] = useState(true)
  const [stickyNode, setStickyNode] = useState(null)

  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 70
  });

  const isInspectModeRef = useRef(isInspectMode)
  const highlightNodesRef = useRef(highlightNodes)

  useEffect(() => { isInspectModeRef.current = isInspectMode }, [isInspectMode])
  useEffect(() => { highlightNodesRef.current = highlightNodes }, [highlightNodes])

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') setStickyNode(null) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])


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

  useEffect(() => {
    if (errors && Object.keys(errors).length > 0) {
      const summary = Object.entries(errors)
        .map(([file, err]) => `• ${file.split('/').pop()}: ${err}`)
        .join('\n')
      alert(`⚠️ IceGraph: ${Object.keys(errors).length} Errors Detected\n\n${summary}`)
    }
  }, [errors])

  const graphData = useMemo(() => {
    if (!rawNodes) return { nodes: [], links: [] }

    const nodeArray = rawNodes || []
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

  const resetZoom = useCallback(() => {
    isResettingRef.current = true
    fgRef.current?.zoomToFit(500, 50)
    setTimeout(() => { isResettingRef.current = false }, 700)
  }, [])

  const deselectNode = useCallback(() => {
    setHighlightNodes(new Set())
    setStickyNode(null)
    history.replaceState({ graphSelection: null }, '')
  }, [])

  const resetView = useCallback(() => {
    deselectNode()

    graphData.nodes.forEach(node => {
      node.fx = node.originalFx
      node.fy = node.originalFy
      node.x = node.originalFx
      node.y = node.originalFy
      node.vx = 0
      node.vy = 0
    })

    isResettingRef.current = true
    setIsFullView(true)
    sessionStorage.removeItem('last_graph_selection')
    resetZoom()
  }, [deselectNode, graphData, resetZoom])

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
      sessionStorage.setItem('last_graph_selection', node.id)
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
    ctx.lineWidth = 7.00
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

  const parseStickyDetails = (details) => {
    if (!details) return { title: '', rows: [] }
    const splitToken = UI_SECTION_NEWLINE === '\n' ? /\\n|\n/ : UI_SECTION_NEWLINE
    const lines = details.split(splitToken).map(l => l.replace(new RegExp(UI_NEWLINE, 'g'), '\n'))
    const title = lines[0] || ''
    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      const idx = line.indexOf(':')
      if (idx === -1) continue
      rows.push({ label: line.substring(0, idx), value: line.substring(idx + 1).trim() })
    }
    return { title, rows }
  }

  const sticky = stickyNode ? parseStickyDetails(stickyNode.details) : null

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
        onNodeDrag={() => setIsFullView(false)}
        onNodeDragEnd={() => setIsFullView(false)}
        onZoom={() => { if (!isResettingRef.current) setIsFullView(false) }}

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
          onClick={resetView}
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
        >
          Center Graph
        </button>
      </div>

      {sticky && (
        <div
          className="absolute top-4 right-4 w-[400px] max-h-[88vh] overflow-y-auto bg-[#1a202c] border-l-4 rounded-xl z-[1000] shadow-xl"
          style={{ borderLeftColor: stickyNode.color }}
        >
          <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-[#2d3748]">
            <div className="font-bold text-base text-[#e2e8f0] pr-6 leading-snug">{sticky.title}</div>
            <button
              className="w-7 h-7 rounded-full bg-[#2d3748] text-slate-400 flex items-center justify-center text-base cursor-pointer hover:bg-[#3d4a5c] hover:text-slate-200 transition shrink-0"
              onClick={() => setStickyNode(null)}
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
            {sticky.rows.map((r, i) => {
              let displayValue = r.value
              const tryParseJson = (str) => {
                try { return JSONbig({ storeAsString: true }).parse(str) } catch { return undefined }
              }
              const asPythonToJson = (str) => str
                .replace(/'/g, '"')
                .replace(/\bTrue\b/g, 'true')
                .replace(/\bFalse\b/g, 'false')
                .replace(/\bNone\b/g, 'null')
              const parsed = tryParseJson(r.value) ?? tryParseJson(asPythonToJson(r.value))
              if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
                displayValue = JSON.stringify(parsed, null, 2)
              }
              return (
                <div key={i}>
                  <span className="block font-bold text-slate-500 text-[0.65rem] uppercase tracking-wider mb-1">
                    {r.label}
                  </span>
                  <span className="block font-mono bg-[#0d1117] text-slate-200 px-3 py-2 rounded-lg text-xs whitespace-pre overflow-x-auto break-normal">
                    {displayValue}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}