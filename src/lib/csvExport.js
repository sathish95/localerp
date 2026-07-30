export function toCSV(rows) {
  if (!rows.length) return ''
  const keys = Object.keys(rows[0])
  const escape = v => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s }
  return [keys.join(','), ...rows.map(r => keys.map(k => escape(r[k])).join(','))].join('\n')
}

export function download(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
