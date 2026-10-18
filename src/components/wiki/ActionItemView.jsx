import { NodeViewWrapper } from '@tiptap/react'
import { useNavigate } from 'react-router-dom'
import { Loader2, CheckCircle2, AlertTriangle, X, ListTodo } from 'lucide-react'

// NodeView for the `actionItem` chip (src/components/wiki/actionItemExtension.js).
// Re-renders automatically whenever the extension patches the node's attrs
// (status/taskId/taskCode/error) via a ProseMirror transaction.
export default function ActionItemView({ node, deleteNode }) {
  const navigate = useNavigate()
  const { status, label, taskId, taskCode, error } = node.attrs

  const base = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8,
    margin: '4px 0', fontSize: 13, border: '1px solid', cursor: status === 'created' ? 'pointer' : 'default',
  }

  if (status === 'created') {
    return (
      <NodeViewWrapper as="div" contentEditable={false}>
        <div
          style={{ ...base, background: 'rgba(16,185,129,.08)', borderColor: 'rgba(16,185,129,.3)', color: 'var(--ink)' }}
          onClick={() => navigate(`/tasks?taskId=${taskId}`)}
          title="Open this task">
          <CheckCircle2 size={15} style={{ color: '#10b981', flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#10b981', fontWeight: 700, flexShrink: 0 }}>{taskCode || 'Task'}</span>
          <span style={{ flex: 1 }}>{label}</span>
        </div>
      </NodeViewWrapper>
    )
  }

  if (status === 'error') {
    return (
      <NodeViewWrapper as="div" contentEditable={false}>
        <div style={{ ...base, background: 'rgba(225,29,72,.06)', borderColor: 'rgba(225,29,72,.3)', color: 'var(--ink)' }}>
          <AlertTriangle size={15} style={{ color: '#e11d48', flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{label}</span>
          <span style={{ fontSize: 11, color: '#e11d48' }} title={error || ''}>Couldn't create task</span>
          <button type="button" onClick={deleteNode} title="Dismiss"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: 'var(--ink-muted)' }}>
            <X size={13} />
          </button>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper as="div" contentEditable={false}>
      <div style={{ ...base, background: 'var(--c1-soft)', borderColor: 'transparent', color: 'var(--ink-muted)' }}>
        <Loader2 size={15} style={{ color: 'var(--c1)', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
        <ListTodo size={13} style={{ opacity: .6, flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{label}</span>
        <span style={{ fontSize: 11 }}>Creating task…</span>
      </div>
    </NodeViewWrapper>
  )
}
