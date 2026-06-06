import { forwardRef, useCallback, useState } from 'react'

export const PANEL_WIDTH_DEFAULT = 400
export const PANEL_WIDTH_MIN = 320
export const PANEL_WIDTH_RELAXED = 560

function FullscreenToggleIcon({ compress }) {
  if (compress) {
    return (
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 6V2h4M10 2h4v4M2 10v4h4M14 10v4h-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const ResizableSidePanel = forwardRef(function ResizableSidePanel({
  accentColor,
  title,
  header,
  children,
  onClose,
  maxContainerWidth = typeof window !== 'undefined' ? window.innerWidth - 32 : 1200,
}, scrollRef) {
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH_DEFAULT)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const handleClose = useCallback(() => {
    setIsFullscreen(false)
    onClose()
  }, [onClose])

  const startResize = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panelWidth
    const maxWidth = Math.max(PANEL_WIDTH_MIN, maxContainerWidth)

    const onMove = (ev) => {
      const nextWidth = Math.min(maxWidth, Math.max(PANEL_WIDTH_MIN, startWidth + (startX - ev.clientX)))
      setPanelWidth(nextWidth)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [panelWidth, maxContainerWidth])

  const contentPad = isFullscreen ? 'px-5' : 'pl-9 pr-5'

  return (
    <div
      ref={scrollRef}
      className={`overflow-y-auto bg-[#1a202c] z-[1000] shadow-xl ${
        isFullscreen
          ? 'fixed top-[70px] left-0 right-0 bottom-0 border-l-4'
          : 'absolute top-4 right-4 max-h-[calc(100%-2rem)] rounded-xl'
      }`}
      style={{
        borderLeftColor: isFullscreen ? accentColor : undefined,
        width: isFullscreen ? undefined : panelWidth,
        maxWidth: isFullscreen ? undefined : `calc(100% - 32px)`,
        '--panel-accent': accentColor,
      }}
    >
      {!isFullscreen && (
        <div
          onMouseDown={startResize}
          className="absolute left-0 top-0 bottom-0 w-7 cursor-ew-resize z-10 group rounded-l-xl"
          style={{ borderLeft: `5px solid ${accentColor}` }}
          title="Drag left to widen"
        >
          <div
            className="absolute inset-0 rounded-l-xl pointer-events-none transition-colors bg-transparent group-hover:bg-[color-mix(in_srgb,var(--panel-accent)_25%,transparent)] group-active:bg-[color-mix(in_srgb,var(--panel-accent)_40%,transparent)]"
            aria-hidden="true"
          />
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-7 flex items-center justify-center pointer-events-none text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)] group-hover:text-white transition-colors"
            aria-hidden="true"
          >
            <svg className="w-4 h-7" viewBox="0 0 12 22" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M8 11H2M2 11L4.5 8M2 11L4.5 14" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 11h6M10 11L7.5 8M10 11L7.5 14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}
      <div className={`flex items-start justify-between pt-5 pb-4 border-b border-[#2d3748] shrink-0 ${contentPad}`}>
        {header ?? (
          <div className="font-bold text-base text-[#e2e8f0] pr-6 leading-snug min-w-0">{title}</div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="w-7 h-7 rounded-full bg-[#2d3748] text-slate-400 flex items-center justify-center cursor-pointer hover:bg-[#3d4a5c] hover:text-slate-200 transition"
            onClick={() => setIsFullscreen(p => !p)}
            onMouseDown={e => e.preventDefault()}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            <FullscreenToggleIcon compress={isFullscreen} />
          </button>
          <button
            type="button"
            className="w-7 h-7 rounded-full bg-[#2d3748] text-slate-400 flex items-center justify-center text-base cursor-pointer hover:bg-[#3d4a5c] hover:text-slate-200 transition"
            onClick={handleClose}
            onMouseDown={e => e.preventDefault()}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>
      <div className={`py-4 flex flex-col gap-3 ${contentPad}`}>
        {children}
      </div>
    </div>
  )
})

export default ResizableSidePanel
