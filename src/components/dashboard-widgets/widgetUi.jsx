// Shared presentational bits for custom dashboard widgets.
// Widgets render just their body content — the grid item chrome
// (title bar, drag handle, remove button) is provided by CustomDashboardBuilder.

export const Stat = ({ label, value, color = '#6366f1', sub }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 800, fontSize: 20, color, lineHeight: 1.15, overflowWrap: 'break-word', wordBreak: 'break-word' }}>{value}</div>
    <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 3 }}>{label}</div>
    {sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
  </div>
)

export const StatRow = ({ children }) => (
  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>{children}</div>
)

export const ProgressBar = ({ pct, color = '#6366f1' }) => (
  <div style={{ height: 6, borderRadius: 99, background: '#f1f5f9', overflow: 'hidden' }}>
    <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, pct || 0))}%`, background: color, borderRadius: 99, transition: 'width .3s' }} />
  </div>
)

export const BarRow = ({ label, value, max, color = '#6366f1', fmt = v => v }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#475569', marginBottom: 3 }}>
      <span style={{ textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontWeight: 700, fontFamily: 'ui-monospace,monospace', flexShrink: 0 }}>{fmt(value)}</span>
    </div>
    <ProgressBar pct={max > 0 ? (value / max) * 100 : 0} color={color} />
  </div>
)

export const EmptyState = ({ icon = '📊', text = 'No data for this period' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 100, color: '#94a3b8', textAlign: 'center', padding: 12 }}>
    <div style={{ fontSize: 26, marginBottom: 6, opacity: .5 }}>{icon}</div>
    <div style={{ fontSize: 12, fontWeight: 600 }}>{text}</div>
  </div>
)

export const Loading = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 100 }}>
    <div className="spinner" />
  </div>
)
