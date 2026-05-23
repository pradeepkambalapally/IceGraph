export function parseUtcDate(tsStr) {
  if (!tsStr) return null;
  // If the string does not end with Z or a timezone offset like +00:00, append Z to force UTC parsing
  let normalized = tsStr;
  if (!tsStr.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(tsStr)) {
    normalized = tsStr + 'Z';
  }
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

export function formatLocaleDateTime(dateObj) {
  if (!dateObj) return '';
  return dateObj.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    fractionalSecondDigits: 3,
    timeZoneName: 'short'
  });
}
