import { getChain, stepState } from '../../lib/approvalFlow'

const COLORS = {
  done:     { bg: '#dcfce7', border: '#86efac', color: '#15803d' },
  active:   { bg: '#fef9c3', border: '#fde047', color: '#a16207' },
  rejected: { bg: '#fee2e2', border: '#fca5a5', color: '#dc2626' },
  pending:  { bg: '#f1f5f9', border: '#e2e8f0', color: '#94a3b8' },
}

export default function ApprovalChainViz({ submitterRole, currentStatus, compact = false }) {
  const chain   = getChain(submitterRole || 'employee')
  const isRej   = currentStatus === 'rejected' || currentStatus === 'closed'

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, flexWrap: 'wrap' }}>
      {chain.map((step, i) => {
        const state = stepState(step, currentStatus, isRej)
        const c     = COLORS[state]
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: compact ? 26 : 32, height: compact ? 26 : 32,
                borderRadius: '50%',
                background: c.bg, border: `2px solid ${c.border}`, color: c.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: compact ? 10 : 12, fontWeight: 800,
              }}>
                {state === 'done' ? '✓' : state === 'rejected' ? '✗' : state === 'active' ? '⏳' : step.short[0]}
              </div>
              {!compact && (
                <div style={{ fontSize: 9, color: c.color, fontWeight: 700, marginTop: 2, whiteSpace: 'nowrap' }}>
                  {step.label}
                </div>
              )}
            </div>
            {i < chain.length - 1 && (
              <div style={{ width: compact ? 12 : 18, height: 2, background: state === 'done' ? '#86efac' : '#e2e8f0', margin: '0 2px', marginBottom: compact ? 0 : 14 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}
