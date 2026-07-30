import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { rupee } from '../lib/supabase'
import {
  getInventoryList, getInventorySummary, getPartLedger, getSerializedDeviceBreakdown,
  recordManualTransaction, getReceivingHistory,
} from '../lib/inventory'
import { Loader, Empty, SearchBox, StatCard } from '../components/ui'
import InventoryComponentsPanel from '../components/InventoryComponentsPanel'
import {
  Warehouse, Package, AlertTriangle, Wallet, ShoppingCart, ChevronRight, History,
  Boxes, Cpu, ArrowDownCircle, ArrowUpCircle, Settings2, X, Save,
} from 'lucide-react'

const TXN_META = {
  stock_in:    { label: 'Stock In', icon: ArrowDownCircle, color: '#10b981' },
  stock_out:   { label: 'Stock Out', icon: ArrowUpCircle, color: '#ef4444' },
  adjustment:  { label: 'Adjustment', icon: Settings2, color: '#f59e0b' },
}

export default function InventoryPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'procurement_lead'].includes(role)

  const [searchParams, setSearchParams] = useSearchParams()
  const selectedPart = searchParams.get('product') || ''
  const view = searchParams.get('view') || 'overview'

  const [list, setList] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)

  const [detailLoading, setDetailLoading] = useState(false)
  const [ledger, setLedger] = useState([])
  const [deviceBreakdown, setDeviceBreakdown] = useState(null)
  const [receiving, setReceiving] = useState([])

  const [showTxnForm, setShowTxnForm] = useState(false)
  const [txnType, setTxnType] = useState('stock_in')
  const [txnQty, setTxnQty] = useState('')
  const [txnCost, setTxnCost] = useState('')
  const [txnNotes, setTxnNotes] = useState('')
  const [txnSubmitting, setTxnSubmitting] = useState(false)
  const [txnErr, setTxnErr] = useState('')

  useEffect(() => { if (view === 'overview') loadOverview() }, [view])

  async function loadOverview() {
    setLoading(true)
    const [l, s] = await Promise.all([getInventoryList(), getInventorySummary()])
    setList(l); setSummary(s)
    setLoading(false)
  }

  const selectedItem = list.find(i => i.part_number === selectedPart) || null

  const loadDetail = useCallback(async (item) => {
    if (!item) { setLedger([]); setDeviceBreakdown(null); setReceiving([]); return }
    setDetailLoading(true); setShowTxnForm(false)
    if (item.is_serialized) {
      const [db, r] = await Promise.all([getSerializedDeviceBreakdown(item.part_number), getReceivingHistory(item.part_number)])
      setDeviceBreakdown(db); setLedger([]); setReceiving(r)
    } else {
      const [led, r] = await Promise.all([getPartLedger(item.part_number), getReceivingHistory(item.part_number)])
      setLedger(led); setDeviceBreakdown(null); setReceiving(r)
    }
    setDetailLoading(false)
  }, [])

  useEffect(() => { loadDetail(selectedItem) }, [selectedItem, loadDetail])

  function selectProduct(partNumber) { setSearchParams(partNumber ? { product: partNumber } : {}) }

  function openTxnForm(type) {
    setTxnType(type); setTxnQty(''); setTxnCost(selectedItem?.unitCost || ''); setTxnNotes(''); setTxnErr(''); setShowTxnForm(true)
  }

  async function handleRecordTxn() {
    if (!txnQty || Number(txnQty) === 0) { setTxnErr('Enter a non-zero quantity'); return }
    setTxnSubmitting(true); setTxnErr('')
    try {
      await recordManualTransaction({ partNumber: selectedPart, txnType, quantity: txnQty, unitCost: txnCost, notes: txnNotes, userId: profile.id })
      setShowTxnForm(false)
      await loadOverview()
      await loadDetail(selectedItem)
    } catch (e) { setTxnErr(e.message) }
    finally { setTxnSubmitting(false) }
  }

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter(i => (!q || i.name?.toLowerCase().includes(q) || i.part_number?.toLowerCase().includes(q)) && (!lowStockOnly || i.lowStock))
  }, [list, search, lowStockOnly])

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Warehouse size={19} />
            </span>
            Inventory Management
          </div>
          <div className="page-subtitle">
            {view === 'components'
              ? 'Component master data — CRUD, bulk import and vendor mapping, linked to the same stock ledger and fund flow as Overview'
              : 'Stock on hand, valuation and low-stock alerts — linked to Products, BOM and Devices'}
          </div>
        </div>
      </div>

      {view === 'components' && <InventoryComponentsPanel />}

      {view === 'overview' && (loading ? <Loader /> : (
      <>
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Components Tracked" value={summary.totalComponentsTracked} icon={<Package size={17} />} accent="#6366f1" />
        <StatCard label="Total Stock Value" value={rupee(summary.totalStockValue)} icon={<Wallet size={17} />} accent="#10b981" />
        <StatCard label="Low Stock Alerts" value={summary.lowStockCount} icon={<AlertTriangle size={17} />} accent="#ef4444" />
        <StatCard label="Total Component Spend" value={rupee(summary.totalComponentSpend)} icon={<ShoppingCart size={17} />} accent="#f59e0b" />
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 20 }}>
        Total Component Spend is the exact same figure Spend Analyzer → By Product shows (same underlying query) — it will never drift from that page. On-hand quantity for non-serialized parts is a running ledger total; serialized parts use the live Device Instances "in storage" count.
      </div>

      {summary.lowStockCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, background: 'linear-gradient(135deg,#fef2f2,#fee2e2)', border: '1px solid #fecaca', marginBottom: 20, flexWrap: 'wrap' }}>
          <AlertTriangle size={16} style={{ color: '#dc2626', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#991b1b', fontWeight: 600 }}>
            {summary.lowStockCount} item{summary.lowStockCount !== 1 ? 's' : ''} below reorder level
          </span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: '#dc2626' }} onClick={() => setLowStockOnly(v => !v)}>
            {lowStockOnly ? 'Show all' : 'Show low-stock only'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>
        <div className="card" style={{ position: 'sticky', top: 76, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
            <SearchBox value={search} onChange={setSearch} placeholder="Search components…" />
          </div>
          <div style={{ maxHeight: 620, overflowY: 'auto' }}>
            {filteredList.map(item => {
              const active = selectedPart === item.part_number
              return (
                <button key={item.part_number} onClick={() => selectProduct(item.part_number)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '11px 14px',
                    border: 'none', borderLeft: item.lowStock ? '3px solid #ef4444' : '3px solid transparent', borderBottom: '1px solid var(--border)',
                    cursor: 'pointer', background: active ? 'linear-gradient(135deg,#0ea5e9,#6366f1)' : 'transparent',
                    color: active ? '#fff' : 'inherit',
                  }}>
                  <span style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? 'rgba(255,255,255,.18)' : item.is_serialized ? '#eef2ff' : '#f1f5f9', color: active ? '#fff' : item.is_serialized ? '#6366f1' : '#64748b',
                  }}>
                    {item.is_serialized ? <Cpu size={14} /> : <Boxes size={14} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                    <div style={{ fontSize: 11, opacity: .85, marginTop: 2, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace' }}>{item.part_number}</span>
                      <span style={{
                        padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, flexShrink: 0,
                        background: active ? 'rgba(255,255,255,.22)' : item.lowStock ? 'rgba(239,68,68,.12)' : 'rgba(148,163,184,.15)',
                        color: active ? '#fff' : item.lowStock ? '#dc2626' : '#64748b',
                      }}>{item.onHand} on hand</span>
                    </div>
                  </div>
                  {active && <ChevronRight size={14} style={{ opacity: .8, flexShrink: 0 }} />}
                </button>
              )
            })}
            {filteredList.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No components match</div>}
          </div>
        </div>

        <div className="card" style={{ padding: '20px 24px', minHeight: 300 }}>
          {!selectedItem ? (
            <Empty icon={<Warehouse size={40} />} title="Select a component" desc="Pick an item from the list to view stock, cost and history" />
          ) : detailLoading ? <Loader /> : (
            <InventoryDetail
              item={selectedItem} canEdit={canEdit} ledger={ledger} deviceBreakdown={deviceBreakdown} receiving={receiving}
              showTxnForm={showTxnForm} txnType={txnType} txnQty={txnQty} txnCost={txnCost} txnNotes={txnNotes} txnSubmitting={txnSubmitting} txnErr={txnErr}
              onOpenTxnForm={openTxnForm} onCloseTxnForm={() => setShowTxnForm(false)} onSubmitTxn={handleRecordTxn}
              setTxnQty={setTxnQty} setTxnCost={setTxnCost} setTxnNotes={setTxnNotes}
            />
          )}
        </div>
      </div>
      </>
      ))}
    </div>
  )
}

function InventoryDetail({
  item, canEdit, ledger, deviceBreakdown, receiving,
  showTxnForm, txnType, txnQty, txnCost, txnNotes, txnSubmitting, txnErr,
  onOpenTxnForm, onCloseTxnForm, onSubmitTxn, setTxnQty, setTxnCost, setTxnNotes,
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#e0f2fe,#e0e7ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0ea5e9', flexShrink: 0 }}>
            {item.is_serialized ? <Cpu size={20} /> : <Boxes size={20} />}
          </span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{item.name}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#94a3b8' }}>{item.part_number} · {item.is_serialized ? 'Product' : 'Component'}</div>
          </div>
        </div>
        {canEdit && !item.is_serialized && !showTxnForm && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-outline btn-sm" onClick={() => onOpenTxnForm('stock_in')}><ArrowDownCircle size={13} /> Stock In</button>
            <button className="btn btn-outline btn-sm" onClick={() => onOpenTxnForm('stock_out')}><ArrowUpCircle size={13} /> Stock Out</button>
            <button className="btn btn-outline btn-sm" onClick={() => onOpenTxnForm('adjustment')}><Settings2 size={13} /> Adjustment</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
        <MiniStat label="On Hand" value={item.onHand} accent={item.lowStock ? '#ef4444' : '#6366f1'} />
        <MiniStat label="Reorder Level" value={item.reorder_level ?? '—'} accent="#8b5cf6" />
        <MiniStat label="Per Unit Cost" value={rupee(item.unitCost)} accent="#0ea5e9" />
        <MiniStat label="Total Value" value={rupee(item.totalValue)} accent="#10b981" />
        {item.lowStock && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(135deg,#fef2f2,#fee2e2)', border: '1px solid #fecaca' }}>
            <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={11} /> LOW STOCK</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626' }}>Reorder {item.reorder_qty || '—'} units</div>
          </div>
        )}
      </div>

      {showTxnForm && (
        <div style={{ padding: 16, borderRadius: 12, border: `1.5px solid ${TXN_META[txnType].color}40`, background: `${TXN_META[txnType].color}0a`, marginBottom: 22 }}>
          {txnErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{txnErr}</div>}
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: TXN_META[txnType].color }}>Record {TXN_META[txnType].label}</div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{txnType === 'adjustment' ? 'Quantity (+ to add, − to remove)' : 'Quantity'}</label>
              <input className="form-input" type="number" step="0.01" value={txnQty} onChange={e => setTxnQty(e.target.value)} placeholder={txnType === 'adjustment' ? 'e.g. -5' : 'e.g. 20'} />
            </div>
            <div className="form-group">
              <label className="form-label">Unit Cost (₹)</label>
              <input className="form-input" type="number" step="0.01" value={txnCost} onChange={e => setTxnCost(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <input className="form-input" value={txnNotes} onChange={e => setTxnNotes(e.target.value)} placeholder="Reason for this movement" />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={onCloseTxnForm} disabled={txnSubmitting}><X size={13} /> Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={onSubmitTxn} disabled={txnSubmitting}><Save size={13} /> {txnSubmitting ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {item.is_serialized ? (
        <div style={{ marginBottom: 24 }}>
          <SectionHeading icon={<Cpu size={14} />}>Device Breakdown</SectionHeading>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              ['In Storage', deviceBreakdown?.inStorage, '#10b981'],
              ['Deployed', deviceBreakdown?.deployed, '#6366f1'],
              ['Attention', deviceBreakdown?.attention, '#f59e0b'],
              ['Decommissioned', deviceBreakdown?.decommissioned, '#94a3b8'],
            ].map(([l, v, c]) => (
              <div key={l} style={{ padding: '8px 14px', borderRadius: 10, background: `${c}12`, border: `1px solid ${c}30`, minWidth: 100 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v ?? 0}</div>
                <div style={{ fontSize: 10, color: c, fontWeight: 700 }}>{l.toUpperCase()}</div>
              </div>
            ))}
          </div>
          {deviceBreakdown?.devices?.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Device Code</th><th>Serial #</th><th>Status</th><th>Location</th></tr></thead>
                <tbody>{deviceBreakdown.devices.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.device_code || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.serial_number}</td>
                    <td><span className="badge">{d.status?.replace(/_/g, ' ')}</span></td>
                    <td style={{ fontSize: 12 }}>{d.current_location || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 10 }}><Link to="/devices" style={{ fontSize: 12, color: 'var(--c1)', fontWeight: 600 }}>Manage devices →</Link></div>
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <SectionHeading icon={<History size={14} />}>Transaction Ledger</SectionHeading>
          {ledger.length === 0 ? (
            <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 0' }}>No stock movements recorded yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Unit Cost</th><th>Reference</th><th>By</th><th>Notes</th></tr></thead>
                <tbody>{ledger.map(t => {
                  const meta = TXN_META[t.txn_type] || {}
                  return (
                    <tr key={t.id}>
                      <td style={{ fontSize: 12 }}>{new Date(t.created_at).toLocaleDateString('en-IN')}</td>
                      <td><span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.label || t.txn_type}</span></td>
                      <td style={{ fontWeight: 700, color: t.quantity < 0 ? '#ef4444' : '#10b981' }}>{t.quantity > 0 ? '+' : ''}{t.quantity}</td>
                      <td>{rupee(t.unit_cost)}</td>
                      <td style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>{t.reference_type}</td>
                      <td style={{ fontSize: 12 }}>{t.creator?.full_name || '—'}</td>
                      <td style={{ fontSize: 12, color: '#64748b' }}>{t.notes || '—'}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div>
        <SectionHeading icon={<ShoppingCart size={14} />}>Receiving History</SectionHeading>
        {receiving.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 0' }}>No GRN receipts recorded for this part yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>GRN #</th><th>PO #</th><th>Received Date</th><th>Ordered</th><th>Received</th><th>Unit Cost</th></tr></thead>
              <tbody>{receiving.map(r => (
                <tr key={r.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#059669' }}>{r.grnNumber || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.poNumber || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.receivedDate ? new Date(r.receivedDate).toLocaleDateString('en-IN') : '—'}</td>
                  <td>{r.quantity_ordered}</td>
                  <td style={{ fontWeight: 700 }}>{r.quantity_received}</td>
                  <td>{rupee(r.unit_cost)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SectionHeading({ icon, children }) {
  return (
    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7, color: '#334155' }}>
      <span style={{ width: 22, height: 22, borderRadius: 6, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0ea5e9' }}>{icon}</span>
      {children}
    </div>
  )
}

function MiniStat({ label, value, accent = '#6366f1' }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 10, background: `${accent}0d`, border: `1px solid ${accent}30`, minWidth: 120 }}>
      <div style={{ fontSize: 10, color: accent, fontWeight: 700, letterSpacing: '.04em' }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{value}</div>
    </div>
  )
}
