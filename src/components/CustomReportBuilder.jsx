import { useState, useMemo, useEffect } from 'react'
import { Filter, Eye, Download, Loader2 } from 'lucide-react'
import { toCSV, download } from '../lib/csvExport'
import { buildFilteredQuery } from '../pages/ReportsPage'

const EMPTY_VALUES = { dateFrom: '', dateTo: '', status: '', category: '', amountMin: '', amountMax: '', active: '', search: '' }
const PREVIEW_LIMIT = 50
const DOWNLOAD_CAP = 5000

function labelize(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function CustomReportBuilder({ reports }) {
  const [entityId, setEntityId] = useState(reports[0]?.id)
  const [values, setValues] = useState(EMPTY_VALUES)
  const [selectedCols, setSelectedCols] = useState([])
  const [preview, setPreview] = useState(null) // { rows, total }
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  const report = reports.find(r => r.id === entityId) || reports[0]
  const columnKeys = useMemo(() => Object.keys(report.map({})), [report])

  useEffect(() => {
    setValues(EMPTY_VALUES)
    setSelectedCols(columnKeys)
    setPreview(null)
    setError('')
  }, [entityId]) // eslint-disable-line react-hooks/exhaustive-deps

  function setVal(key, v) { setValues(f => ({ ...f, [key]: v })) }
  function toggleCol(key) {
    setSelectedCols(cols => cols.includes(key) ? cols.filter(c => c !== key) : [...cols, key])
  }

  async function runPreview() {
    setLoading(true); setError(''); setPreview(null)
    try {
      const [rowsRes, countRes] = await Promise.all([
        buildFilteredQuery(report, values).order(report.filters?.date || report.selectCols.split(',')[0], { ascending: false }).limit(PREVIEW_LIMIT),
        buildFilteredQuery(report, values, { count: 'exact', head: true }),
      ])
      if (rowsRes.error) throw rowsRes.error
      if (countRes.error) throw countRes.error
      setPreview({ rows: (rowsRes.data || []).map(report.map), total: countRes.count ?? rowsRes.data?.length ?? 0 })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDownload() {
    setDownloading(true); setError('')
    try {
      const { data, error: err } = await buildFilteredQuery(report, values).limit(DOWNLOAD_CAP)
      if (err) throw err
      if (!data?.length) { setError('No rows match these filters'); return }
      const rows = data.map(report.map).map(row => {
        const picked = {}
        selectedCols.forEach(k => { picked[k] = row[k] })
        return picked
      })
      const date = new Date().toISOString().slice(0, 10)
      download(toCSV(rows), `thingsalive-neox-custom-${report.id}-${date}.csv`)
    } catch (e) {
      setError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  const f = report.filters || {}

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', padding: '20px 22px', marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Filter size={16} style={{ color: 'var(--c1)' }} />
        <div style={{ fontWeight: 800, fontSize: 15 }}>Custom Report Builder</div>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Pick a module, filter it down, preview, then download just what you need.</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Module</label>
          <select className="form-select" value={entityId} onChange={e => setEntityId(e.target.value)}>
            {reports.map(r => <option key={r.id} value={r.id}>{r.emoji} {r.label}</option>)}
          </select>
        </div>

        {f.date && (
          <>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">From</label>
              <input type="date" className="form-input" value={values.dateFrom} onChange={e => setVal('dateFrom', e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">To</label>
              <input type="date" className="form-input" value={values.dateTo} onChange={e => setVal('dateTo', e.target.value)} />
            </div>
          </>
        )}

        {f.status && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Status</label>
            <select className="form-select" value={values.status} onChange={e => setVal('status', e.target.value)}>
              <option value="">All statuses</option>
              {f.status.options.map(s => <option key={s} value={s}>{labelize(s)}</option>)}
            </select>
          </div>
        )}

        {f.category && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Category</label>
            <select className="form-select" value={values.category} onChange={e => setVal('category', e.target.value)}>
              <option value="">All categories</option>
              {f.category.options.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {f.active && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Active</label>
            <select className="form-select" value={values.active} onChange={e => setVal('active', e.target.value)}>
              <option value="">Any</option>
              <option value="yes">Active only</option>
              <option value="no">Inactive only</option>
            </select>
          </div>
        )}

        {f.amount && (
          <>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Min Amount (₹)</label>
              <input type="number" className="form-input" value={values.amountMin} onChange={e => setVal('amountMin', e.target.value)} placeholder="0" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Max Amount (₹)</label>
              <input type="number" className="form-input" value={values.amountMax} onChange={e => setVal('amountMax', e.target.value)} placeholder="Any" />
            </div>
          </>
        )}

        {f.search && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Search</label>
            <input className="form-input" value={values.search} onChange={e => setVal('search', e.target.value)} placeholder="Free text…" />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Columns to include</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {columnKeys.map(k => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={selectedCols.includes(k)} onChange={() => toggleCol(k)} />
              {k}
            </label>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginBottom: preview ? 16 : 0 }}>
        <button className="btn btn-outline" onClick={runPreview} disabled={loading}>
          {loading ? <Loader2 size={14} style={{ marginRight: 6, animation: 'spin .7s linear infinite' }} /> : <Eye size={14} style={{ marginRight: 6 }} />}
          {loading ? 'Loading…' : 'Preview'}
        </button>
        <button className="btn btn-primary" onClick={handleDownload} disabled={downloading || !selectedCols.length}>
          <Download size={14} style={{ marginRight: 6 }} />
          {downloading ? 'Downloading…' : 'Download CSV'}
        </button>
      </div>

      {preview && (
        <div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            {preview.total} matching row{preview.total === 1 ? '' : 's'} — showing first {Math.min(preview.rows.length, PREVIEW_LIMIT)}
          </div>
          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
            <table>
              <thead><tr>{selectedCols.map(k => <th key={k}>{k}</th>)}</tr></thead>
              <tbody>
                {preview.rows.length === 0
                  ? <tr><td colSpan={selectedCols.length || 1} style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>No rows match these filters</td></tr>
                  : preview.rows.map((row, i) => (
                    <tr key={i}>{selectedCols.map(k => <td key={k}>{String(row[k] ?? '—')}</td>)}</tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
