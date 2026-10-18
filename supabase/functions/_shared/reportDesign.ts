// Scorecard design system for scheduled report emails (STEP230).
// Every report gets its own colour band so people recognise it in the inbox;
// headline numbers carry ▲▼ against the previous period; charts are plain
// tables (Gmail/Outlook don't render SVG or CSS grid). Inline styles only.

import type { Org } from './emailTemplates.ts'

export type Theme = { key: string; label: string; band: string; ink: string; soft: string; accent: string }
export const THEMES: Record<string, Theme> = {
  ceo_briefing:     { key: 'ceo_briefing', label: 'Executive briefing', band: '#111827', ink: '#fbbf24', soft: '#fffbeb', accent: '#d97706' },
  team_performance: { key: 'team_performance', label: 'Team performance', band: '#3730a3', ink: '#c7d2fe', soft: '#eef2ff', accent: '#4f46e5' },
  project_status:   { key: 'project_status', label: 'Project status', band: '#1e40af', ink: '#bfdbfe', soft: '#eff6ff', accent: '#2563eb' },
  monthly_summary:  { key: 'monthly_summary', label: 'Management report', band: '#1e293b', ink: '#cbd5e1', soft: '#f1f5f9', accent: '#475569' },
  financial:        { key: 'financial', label: 'Financial report', band: '#065f46', ink: '#a7f3d0', soft: '#ecfdf5', accent: '#059669' },
  hr_people:        { key: 'hr_people', label: 'People report', band: '#115e59', ink: '#99f6e4', soft: '#f0fdfa', accent: '#0d9488' },
  manager_team:     { key: 'manager_team', label: 'Your team', band: '#5b21b6', ink: '#ddd6fe', soft: '#f5f3ff', accent: '#7c3aed' },
  sales_pipeline:   { key: 'sales_pipeline', label: 'Sales pipeline', band: '#9a3412', ink: '#fed7aa', soft: '#fff7ed', accent: '#ea580c' },
}

export const INK = '#0f172a', BODY = '#334155', MUTED = '#64748b', FAINT = '#94a3b8', LINE = '#e2e8f0', HAIR = '#eef2f6', BG = '#f1f5f9'
export const GOOD = '#15803d', BAD = '#b91c1c', WARN = '#b45309'

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export const link = (org: Org, path?: string | null) => !path ? org.appUrl : /^https?:\/\//i.test(path) ? path : org.appUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path)
export const fmtDate = (d: string | Date, tz: string, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: tz, ...opts }).format(typeof d === 'string' ? new Date(d.length === 10 ? d + 'T12:00:00Z' : d) : d)
export const shortDate = (d: string, tz: string) => fmtDate(d, tz, { day: '2-digit', month: 'short' })
export const range = (org: Org, from: string, to: string) => from === to ? fmtDate(from, org.timezone) : `${shortDate(from, org.timezone)} – ${fmtDate(to, org.timezone)}`

export const inr = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
/** ₹1.8L / ₹2.35Cr for headline tiles; full figure below 1 lakh. */
export const inrShort = (n: number | null | undefined) => {
  if (n == null) return '—'
  const a = Math.abs(n), s = n < 0 ? '-' : ''
  if (a >= 1e7) return `${s}₹${+(a / 1e7).toFixed(2)}Cr`
  if (a >= 1e5) return `${s}₹${+(a / 1e5).toFixed(1)}L`
  return inr(n)
}
export const pc = (n: number | null | undefined) => (n == null ? '—' : `${n}%`)
export const hrs = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 10) / 10}h`)
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
export const minutesToTime = (m: number | null) => m == null ? '—' : new Date(Date.UTC(2000, 0, 1, Math.floor(m / 60), m % 60)).toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' })

/* ── Shell: coloured band + white card ── */
export function shell(org: Org, t: Theme, o: { eyebrow?: string; title: string; subtitle: string; preheader: string; body: string; confidential?: string; reason?: string }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px">
  <tr><td style="background:${t.band};border-radius:14px 14px 0 0;padding:26px 30px 24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${t.ink}">${esc(o.eyebrow || t.label)}</td>
      <td align="right" style="font-size:12px;font-weight:600;color:#ffffff;opacity:.85">${esc(org.fromName || org.orgName)}</td>
    </tr></table>
    <div style="font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;margin-top:10px">${esc(o.title)}</div>
    <div style="font-size:13px;color:#ffffff;opacity:.78;margin-top:6px">${esc(o.subtitle)}</div>
  </td></tr>
  <tr><td style="background:#ffffff;border:1px solid ${LINE};border-top:0;border-radius:0 0 14px 14px;padding:24px 28px 26px">
    ${o.body}
    ${o.confidential ? `<div style="margin-top:22px;padding-top:14px;border-top:1px solid ${HAIR};font-size:11.5px;color:${FAINT}">${esc(o.confidential)}</div>` : ''}
  </td></tr>
  <tr><td style="padding:14px 6px 0;font-size:11.5px;line-height:1.6;color:${FAINT}">
    ${esc(o.reason || "You're receiving this scheduled report because you're on its recipient list.")}
    <a href="${esc(link(org, '/settings?tab=email'))}" style="color:${MUTED}">Email settings</a>${org.footer ? ` · ${esc(org.footer)}` : ''}
  </td></tr>
</table></td></tr></table></body></html>`
}

export const previewBanner = (d: any, extra = '') => d?.preview
  ? `<div style="margin:0 0 18px;padding:9px 12px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;font-size:12.5px;color:#92400e">Preview requested from Settings → Email.${extra ? ' ' + esc(extra) : ''}</div>` : ''

/* ── Headline tiles with trends ── */
export type Trend = { dir: 'up' | 'down' | 'flat'; text: string; good: boolean | null } | null
export type Tile = { label: string; value: string; trend?: Trend; sub?: string }
function trendChip(tr: Trend) {
  if (!tr) return ''
  if (tr.dir === 'flat') return `<span style="font-size:11.5px;color:${FAINT};font-weight:600">— no change</span>`
  const color = tr.good == null ? MUTED : tr.good ? GOOD : BAD
  const bg = tr.good == null ? '#f1f5f9' : tr.good ? '#f0fdf4' : '#fef2f2'
  return `<span style="display:inline-block;padding:1px 7px;border-radius:10px;background:${bg};color:${color};font-size:11.5px;font-weight:700;white-space:nowrap">${tr.dir === 'up' ? '▲' : '▼'} ${esc(tr.text)}</span>`
}
export function tiles(items: Tile[], t: Theme, perRow = 3) {
  const out: string[] = []
  for (let i = 0; i < items.length; i += perRow) {
    const row = items.slice(i, i + perRow)
    const cells = row.map(k => `<td width="${Math.floor(100 / perRow)}%" valign="top" style="padding:14px 16px;background:${t.soft};border-radius:10px">
      <div style="font-size:11.5px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:.04em">${esc(k.label)}</div>
      <div style="font-size:26px;line-height:1.15;font-weight:800;color:${INK};margin-top:6px;letter-spacing:-.01em">${esc(k.value)}</div>
      <div style="margin-top:6px">${trendChip(k.trend ?? null)}${k.trend ? `<span style="font-size:11px;color:${FAINT}"> vs previous</span>` : ''}</div>
      ${k.sub ? `<div style="font-size:11.5px;color:${MUTED};margin-top:4px">${esc(k.sub)}</div>` : ''}
    </td>`)
    while (cells.length < perRow) cells.push(`<td width="${Math.floor(100 / perRow)}%"></td>`)
    out.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;margin:0 0 10px"><tr>${cells.join('<td width="10" style="font-size:0">&nbsp;</td>')}</tr></table>`)
  }
  return out.join('')
}

/* ── Sections ── */
export const section = (t: Theme, title: string, sub = '') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 12px"><tr>
    <td width="4" style="background:${t.accent};border-radius:2px">&nbsp;</td>
    <td style="padding-left:10px"><div style="font-size:15px;font-weight:700;color:${INK}">${esc(title)}</div>${sub ? `<div style="font-size:12px;color:${FAINT};margin-top:1px">${esc(sub)}</div>` : ''}</td>
  </tr></table>`
export const note = (s: string) => `<div style="font-size:13px;color:${FAINT};padding:4px 0 2px">${esc(s)}</div>`
export const para = (html: string) => `<div style="font-size:14px;line-height:1.65;color:${BODY};margin:0 0 12px">${html}</div>`
export const bold = (s: string) => `<b style="color:${INK};font-weight:600">${esc(s)}</b>`

/* ── Horizontal bar chart (tables) ── */
export function bars(rows: { label: string; value: number; display?: string; color?: string; sub?: string }[], t: Theme, max?: number) {
  if (!rows.length) return ''
  const top = max ?? Math.max(1, ...rows.map(r => r.value))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows.map(r => {
    const w = Math.max(r.value > 0 ? 2 : 0, Math.min(100, Math.round((r.value / top) * 100)))
    return `<tr>
      <td width="34%" style="padding:6px 10px 6px 0;font-size:13px;color:${BODY};white-space:nowrap">${esc(r.label)}${r.sub ? `<div style="font-size:11px;color:${FAINT}">${esc(r.sub)}</div>` : ''}</td>
      <td style="padding:6px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
          ${w ? `<td width="${w}%" style="background:${r.color || t.accent};height:12px;border-radius:3px;font-size:0;line-height:0">&nbsp;</td>` : ''}
          <td style="background:${HAIR};height:12px;font-size:0;line-height:0">&nbsp;</td>
        </tr></table>
      </td>
      <td width="18%" align="right" style="padding:6px 0 6px 10px;font-size:13px;font-weight:700;color:${INK};white-space:nowrap">${esc(r.display ?? String(r.value))}</td>
    </tr>`
  }).join('')}</table>`
}

/* ── Progress meter (inline) ── */
export const meter = (v: number | null, color: string) => v == null ? '' :
  `<table role="presentation" width="96" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px"><tr>
    ${v > 0 ? `<td width="${Math.min(100, v)}%" style="background:${v > 100 ? BAD : color};height:5px;font-size:0;line-height:0">&nbsp;</td>` : ''}
    ${v < 100 ? `<td style="background:${HAIR};height:5px;font-size:0;line-height:0">&nbsp;</td>` : ''}
  </tr></table>`

/* ── Tables, pills, lists ── */
export function table(head: [string, ('left' | 'right')?][], body: string[][], empty = 'Nothing to show') {
  if (!body.length) return note(empty)
  const th = head.map(([h, al]) => `<th align="${al || 'right'}" style="padding:8px 8px;font-size:11px;font-weight:700;color:${FAINT};text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid ${LINE};white-space:nowrap">${esc(h)}</th>`).join('')
  const tr = body.map((r, i) => `<tr style="background:${i % 2 ? '#fcfcfd' : '#ffffff'}">${r.map((c, j) => `<td align="${head[j]?.[1] || 'right'}" style="padding:9px 8px;font-size:13px;color:${BODY};border-bottom:1px solid ${HAIR}">${c}</td>`).join('')}</tr>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${`<tr>${th}</tr>`}${tr}</table>`
}
const HEALTH: Record<string, [string, string, string, string]> = {
  off_track: ['Off track', BAD, '#fef2f2', '#fecaca'], at_risk: ['At risk', '#92400e', '#fffbeb', '#fde68a'], on_track: ['On track', GOOD, '#f0fdf4', '#bbf7d0'],
}
export const healthPill = (h: string) => { const [l, fg, bg, bd] = HEALTH[h] || HEALTH.on_track; return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;border:1px solid ${bd};background:${bg};color:${fg};font-size:11.5px;font-weight:700;white-space:nowrap">${l}</span>` }
export const healthLabel = (h: string) => (HEALTH[h] || HEALTH.on_track)[0]
export const chip = (label: string, color = WARN) => `<span style="display:inline-block;margin:1px 4px 1px 0;padding:1px 7px;border-radius:6px;border:1px solid ${LINE};font-size:11px;color:${color};white-space:nowrap">${esc(label)}</span>`
export function bullets(items: string[], empty: string, color = BODY) {
  if (!items.length) return note(empty)
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map((x, i) => `<tr>
    <td width="24" valign="top" style="padding:5px 0;font-size:12px;font-weight:700;color:${FAINT}">${i + 1}.</td>
    <td style="padding:5px 0;font-size:13.5px;line-height:1.55;color:${color}">${x}</td></tr>`).join('')}</table>`
}
/** Two blocks side by side (stack on narrow clients that ignore widths). */
export const twoCol = (a: string, b: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td width="49%" valign="top">${a}</td><td width="2%"></td><td width="49%" valign="top">${b}</td></tr></table>`

export function button(t: Theme, label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0"><tr><td style="border-radius:8px;background:${t.accent}">
    <a href="${esc(href)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${esc(label)} →</a></td></tr></table>`
}
export const FLAG_LABEL: Record<string, string> = {
  absent: 'Absent', no_task_time: 'Checked in, no task time', low_logging: 'Low logging', missed_checkout: 'Missed check-out',
  over_estimate: 'Over estimate', overdue: 'Overdue work', over_logged: 'Task time > attendance',
}
export const flagChips = (flags: string[]) => flags.length
  ? flags.map(f => chip(FLAG_LABEL[f] || f, ['absent', 'no_task_time'].includes(f) ? BAD : f === 'over_logged' ? MUTED : WARN)).join('')
  : `<span style="font-size:12px;font-weight:600;color:${GOOD}">On track</span>`
export const PLAN_LABEL: Record<string, [string, string]> = {
  none: ['No work planned', BAD], carryover: ['Only overdue work', WARN], under: ['Under-planned', WARN], planned: ['Planned', GOOD], leave: ['On leave', MUTED],
}
