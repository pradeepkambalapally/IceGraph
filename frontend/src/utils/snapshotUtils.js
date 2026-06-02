export function parseSummary(summary) {
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
