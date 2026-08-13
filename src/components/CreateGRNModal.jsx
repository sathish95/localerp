import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getPOItems } from '../lib/purchaseOrders'
import { createAndReceiveGRN, getReceivedQtyByPOItem } from '../lib/grn'
import { Modal } from './ui'

const rupee = v => v != null ? '₹' + Number(v).toLocaleString('en-IN') : '—'

// Shared "receive against a PO" form — originally only reachable from
// Purchase Orders, now also opened from the GRN page (after picking a
// PO there first) so it isn't duplicated in two places. A GRN is always
// against a specific PO; there's no such thing as creating one without
// one.
export default function CreateGRNModal({ po, onClose, onCreated }) {
  const { profile } = useAuth()
  const [items, setItems] = useState([])
  const [date, setDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!po) return
    setErr(''); setRemarks(''); setDate(new Date().toISOString().slice(0, 10))
    Promise.all([getPOItems(po.id), getReceivedQtyByPOItem(po.id)]).then(([poItems, received]) => {
      setItems(poItems.map(i => {
        const alreadyReceived = received[i.id] || 0
        const outstanding = Math.max(0, Number(i.quantity) - alreadyReceived)
        return {
          po_item_id: i.id, part_number: i.part_number, description: i.description,
          quantity_ordered: i.quantity, quantity_received: outstanding, unit_cost: i.unit_cost,
          already_received: alreadyReceived,
        }
      }))
    })
  }, [po?.id])

  function updateQty(idx, qty) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity_received: qty } : it))
  }

  async function submit() {
    setSubmitting(true); setErr('')
    try {
      await createAndReceiveGRN({ poId: po.id, receivedDate: date, items, remarks, userId: profile.id })
      onCreated?.(po)
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  return (
    <Modal open={!!po} onClose={onClose} title={po ? `Create GRN — ${po.po_number}` : ''} size="lg"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={submitting || !items.length}>{submitting ? 'Receiving…' : 'Receive GRN'}</button>
      </>}>
      {po && (
        <div>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Received Date</label>
              <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Remarks</label>
              <input className="form-input" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="table-wrap" style={{ marginBottom: 8 }}>
            <table>
              <thead><tr><th>Part #</th><th>Description</th><th>Ordered</th><th>Already Received</th><th>Receiving Now</th><th>Unit Cost</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{it.part_number || '—'}</td>
                    <td>{it.description}</td>
                    <td>{it.quantity_ordered}</td>
                    <td style={{ color: '#64748b' }}>{it.already_received || 0}</td>
                    <td><input className="form-input" style={{ width: 90 }} type="number" min="0" step="0.01" value={it.quantity_received} onChange={e => updateQty(i, e.target.value)} /></td>
                    <td>{rupee(it.unit_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Receiving less than ordered marks the GRN "Partial" — raise another GRN against this PO later for the remainder. Non-serialized parts post straight into Inventory; serialized parts still need their units registered in Devices.</div>
        </div>
      )}
    </Modal>
  )
}
