import CopyIconButton from './CopyIconButton'

export default function CopyableValue({
  value,
  mono = false,
  className = '',
  boxClassName = 'bg-canvas rounded-lg',
}) {
  const hasValue = value != null && value !== ''
  const textToCopy = hasValue ? String(value) : ''

  return (
    <div className={`relative ${className}`}>
      {hasValue && (
        <CopyIconButton text={textToCopy} className="absolute top-1.5 right-1.5 z-10" />
      )}
      <span
        className={`block text-sm text-ink break-all pl-3 pr-9 py-2 ${boxClassName} ${mono ? 'font-mono' : ''}`}
      >
        {hasValue ? value : <span className="text-slate-600 italic">—</span>}
      </span>
    </div>
  )
}
