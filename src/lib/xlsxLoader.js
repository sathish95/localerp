// Lazily loads SheetJS (XLSX) from CDN — shared by every Excel export in
// the app (previously duplicated per-file, e.g. proposalExport.js) so the
// <script> injection only ever happens once and every caller reuses the
// same in-flight load instead of racing separate copies of it.
let loadPromise = null
export function ensureXLSX() {
  if (window.XLSX) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    s.onload = resolve
    s.onerror = () => { loadPromise = null; reject(new Error('Failed to load the Excel export library — check your connection and try again.')) }
    document.head.appendChild(s)
  })
  return loadPromise
}
