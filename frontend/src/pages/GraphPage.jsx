import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useLocation, useOutletContext } from 'react-router-dom'
import ForceGraph2D from 'react-force-graph-2d'
import {
  UI_NEWLINE,
  UI_SECTION_NEWLINE,
  NODE_STYLE_MAP,
  BRANCH_CONNECTION_COLOR,
  DELETED_DATA_FILE_CONNECTION_COLOR,
  FileType,
  GRAPH_SETTINGS,
} from '../graphConstants'
import JSONbig from 'json-bigint'

const rgbToHex = (rgb) => {
  const [r, g, b] = rgb
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// Helper to find related nodes (lineage)
function getLineage(nodeId, nodes, links) {
  const relatedNodes = new Set([String(nodeId)])
  const queue = [String(nodeId)]

  const adj = {}
  links.forEach(l => {
    const s = String(l.source.id || l.source)
    const t = String(l.target.id || l.target)
    if (!adj[s]) adj[s] = []
    if (!adj[t]) adj[t] = []
    adj[s].push(t)
    adj[t].push(s)
  })

  while (queue.length > 0) {
    const curr = queue.shift()
    if (adj[curr]) {
      adj[curr].forEach(neighbor => {
        if (!relatedNodes.has(neighbor)) {
          relatedNodes.add(neighbor)
          queue.push(neighbor)
        }
      })
    }
  }
  return relatedNodes
}

// Component removed sigma-style helpers

export default function GraphPage() {
  const { nodes: rawNodes, edges: rawEdges, metadata, errors } = useOutletContext()

  const location = useLocation()
  const fgRef = useRef()

  const [highlightNodes, setHighlightNodes] = useState(new Set())
  const [isInspectMode, setIsInspectMode] = useState(true)
  const [isFullView, setIsFullView] = useState(true)
  const [stickyNode, setStickyNode] = useState(null)

  // Process data for react-force-graph
  const graphData = useMemo(() => {
    if (!rawNodes) return { nodes: [], links: [] }

    const nodeArray = typeof rawNodes.get === 'function' ? rawNodes.get() : rawNodes
    const edgeArray = typeof rawEdges.get === 'function' ? rawEdges.get() : rawEdges

    const processedNodes = nodeArray.map(n => {
      const type = n.type || FileType.DATA
      const style = NODE_STYLE_MAP[type] || NODE_STYLE_MAP[FileType.DATA]
      return {
        ...n,
        color: rgbToHex(style.rgb),
        level: style.level
      }
    })

    const processedLinks = edgeArray.map(e => ({
      source: e.from,
      target: e.to,
      color: e.color || '#999'
    }))

    // Apply hierarchical layout logic by setting fixed coordinates (fx, fy)
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
        node.fx = x
        node.fy = (i * nodeSpacing) - (totalHeight / 2)
      })
    })

    return { nodes: processedNodes, links: processedLinks }
  }, [rawNodes, rawEdges])

  const deselectNode = useCallback(() => {
    setHighlightNodes(new Set())
    setStickyNode(null)
    setIsFullView(true)
    history.replaceState({ graphSelection: null }, '')
  }, [])

  const resetView = useCallback(() => {
    deselectNode()
    fgRef.current?.zoomToFit(500, 50)
  }, [deselectNode])

  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0) return

    const initialNodeId = location.state?.selectNodeId || history.state?.graphSelection
    if (initialNodeId) {
      const node = graphData.nodes.find(n => String(n.id) === String(initialNodeId))
      if (node) {
        setStickyNode(node)
        const lineage = getLineage(node.id, graphData.nodes, graphData.links)
        setHighlightNodes(lineage)
        setIsFullView(false)
        fgRef.current.centerAt(node.fx, node.fy, 500)
        fgRef.current.zoom(1.5, 500)
      }
    } else {
      fgRef.current.zoomToFit(500, 50)
    }
  }, [graphData, location.state])

  const handleNodeClick = useCallback((node) => {
    if (!isInspectMode) {
      const lineage = getLineage(node.id, graphData.nodes, graphData.links)
      setHighlightNodes(lineage)
      setIsFullView(false)
      fgRef.current.centerAt(node.fx, node.fy, 500)
    }
    setStickyNode(node)
    history.pushState({ graphSelection: node.id }, '')
  }, [isInspectMode, graphData])

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
      className="relative w-full flex-1 overflow-hidden"
      style={{
        backgroundColor: '#0d1117',
        backgroundImage: 'radial-gradient(circle, #2d3748 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        backgroundColor="#00000000" // transparent to see background image
        nodeLabel="label"
        nodeRelSize={70}
        linkWidth={1}
        nodeColor={n => {
          if (highlightNodes.size > 0 && !highlightNodes.has(String(n.id))) return '#333'
          return n.color
        }}
        linkColor={l => {
          const s = String(l.source.id || l.source)
          const t = String(l.target.id || l.target)
          if (highlightNodes.size > 0 && !(highlightNodes.has(s) && highlightNodes.has(t))) return '#222'
          return l.color
        }}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleNodeClick}
        onBackgroundClick={() => { }}
        onZoom={() => setIsFullView(false)}
        onDrag={() => setIsFullView(false)}
        d3AlphaDecay={0.1} // Stop simulation quickly since we use fixed coords
      />

      <div className="absolute top-4 left-4 flex flex-col gap-2 z-[9999] font-sans w-[200px]">
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
          onClick={() => fgRef.current?.zoomToFit(500, 50)}
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
