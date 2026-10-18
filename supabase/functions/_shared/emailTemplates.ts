// Email templates for the send-email worker. Table-based HTML with inline
// styles (what email clients actually render), flat single-accent look to
// match the web app, and a plain-text part for every message.

export type Org = { orgName: string; fromName: string; footer?: string | null; appUrl: string; timezone: string }
export type Rendered = { subject: string; html: string; text: string }

const ACCENT = '#4f46e5'
const INK = '#0f172a', MUTED = '#64748b', FAINT = '#94a3b8', LINE = '#e2e8f0', BG = '#f8fafc'

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const link = (org: Org, path?: string | null) => {
  if (!path) return org.appUrl
  if (/^https?:\/\//i.test(path)) return path
  return org.appUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path)
}
const fmtDate = (d: string | Date, tz: string, withTime = false) => new Intl.DateTimeFormat('en-IN', {
  timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
}).format(typeof d === 'string' ? new Date(d.length === 10 ? d + 'T12:00:00Z' : d) : d)

function button(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px"><tr><td style="border-radius:8px;background:${ACCENT}">
    <a href="${esc(href)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(label)}</a>
  </td></tr></table>`
}

function layout(org: Org, { preheader, heading, bodyHtml, width = 560, reason, prefs = true }: { preheader: string; heading: string; bodyHtml: string; width?: number; reason: string; prefs?: boolean }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${width}px">
    <tr><td style="padding:0 4px 14px;font-size:14px;font-weight:700;color:${INK}">${esc(org.fromName || org.orgName)}</td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:12px;padding:28px 28px 24px">
      <h1 style="margin:0 0 12px;font-size:19px;line-height:1.35;font-weight:700;color:${INK}">${esc(heading)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:${FAINT}">
      ${esc(reason)}${prefs ? ` <a href="${esc(link(org, '/'))}" style="color:${MUTED}">Manage email preferences</a> from the bell icon in the app.` : ''}
      ${org.footer ? `<br>${esc(org.footer)}` : ''}
    </td></tr>
  </table>
</td></tr></table></body></html>`
}

const p = (html: string, style = '') => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;${style}">${html}</p>`

const CATEGORY_LABEL: Record<string, string> = {
  tasks: 'Tasks', approvals: 'Approvals', chat: 'Chat & mentions', checkin: 'Check-in', sales: 'Sales', announcements: 'Announcement', other: 'Update',
}

/* ── notification ── */
export function notificationEmail(org: Org, d: any): Rendered {
  const cat = CATEGORY_LABEL[d.category] || 'Update'
  const bodyHtml = `
    <div style="display:inline-block;margin:0 0 14px;padding:2px 8px;border-radius:6px;background:#eef2ff;color:#4338ca;font-size:12px;font-weight:600">${esc(cat)}</div>
    ${d.body ? p(esc(d.body)) : ''}
    ${d.sender ? p(`From ${esc(d.sender)}`, `color:${MUTED};font-size:13px`) : ''}
    ${button('Open in app', link(org, d.link))}`
  return {
    subject: d.title || `New ${cat.toLowerCase()} update`,
    html: layout(org, { preheader: d.body || d.title || '', heading: d.title || 'New update', bodyHtml, reason: `You're receiving this because notification emails are on for your account.` }),
    text: `${d.title || 'New update'}\n\n${d.body || ''}\n${d.sender ? `\nFrom ${d.sender}\n` : ''}\nOpen: ${link(org, d.link)}\n`,
  }
}

/* ── daily digest ── */
export function digestEmail(org: Org, d: any, toName?: string | null): Rendered {
  const items: any[] = d.items || []
  const rows = items.map(it => `
    <tr><td style="padding:12px 0;border-top:1px solid ${LINE}">
      <div style="font-size:12px;color:${FAINT};margin-bottom:2px">${esc(CATEGORY_LABEL[it.category] || 'Update')} · ${esc(fmtDate(it.created_at, org.timezone, true))}</div>
      <a href="${esc(link(org, it.link))}" style="font-size:14px;font-weight:600;color:${INK};text-decoration:none">${esc(it.title)}</a>
      ${it.body ? `<div style="font-size:13px;color:${MUTED};margin-top:2px;line-height:1.5">${esc(it.body)}</div>` : ''}
    </td></tr>`).join('')
  const n = items.length
  const bodyHtml = `${p(`${toName ? `Hi ${esc(toName.split(' ')[0])}, here` : 'Here'} ${n === 1 ? 'is 1 update' : `are ${n} updates`} since your last summary.`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    ${button('Open notifications', link(org, '/'))}`
  return {
    subject: `Your daily summary: ${n} update${n === 1 ? '' : 's'}`,
    html: layout(org, { preheader: items[0]?.title || '', heading: 'Your daily summary', bodyHtml, reason: `You're receiving this because you chose a daily email summary.` }),
    text: `Your daily summary (${n})\n\n` + items.map(it => `- ${it.title}${it.body ? ` — ${it.body}` : ''}\n  ${link(org, it.link)}`).join('\n') + '\n',
  }
}

/* ── account emails ── */
export function welcomeEmail(org: Org, d: any, toName: string | null, toEmail: string): Rendered {
  const signIn = link(org, '/auth')
  const creds = d.temp_password ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;border:1px solid ${LINE};border-radius:8px;background:${BG}">
      <tr><td style="padding:12px 14px;font-size:13px;color:#334155;line-height:1.8">
        Email: <b style="color:${INK}">${esc(toEmail)}</b><br>
        Temporary password: <b style="color:${INK};font-family:Consolas,Menlo,monospace">${esc(d.temp_password)}</b>
      </td></tr></table>
    ${p('Please change your password after you sign in.', `font-size:12px;color:${MUTED};margin-top:8px`)}` : p(`Sign in with <b>${esc(toEmail)}</b>. If you don't know your password, use <i>Forgot password</i> on the sign-in page.`)
  const bodyHtml = `${p(`Hi ${esc((toName || '').split(' ')[0] || 'there')},`)}
    ${p(`${d.invited_by ? `${esc(d.invited_by)} has created an account` : 'An account has been created'} for you in <b>${esc(org.orgName)}</b>${d.role ? ` as <b>${esc(String(d.role).replace(/_/g, ' '))}</b>` : ''}.`)}
    ${creds}${button('Sign in', signIn)}`
  return {
    subject: `Your ${org.orgName} account is ready`,
    html: layout(org, { preheader: `Sign in to ${org.orgName}`, heading: `Welcome to ${org.orgName}`, bodyHtml, reason: `You're receiving this because an administrator created an account for this address.`, prefs: false }),
    text: `Welcome to ${org.orgName}\n\nSign in: ${signIn}\nEmail: ${toEmail}\n${d.temp_password ? `Temporary password: ${d.temp_password}\nPlease change it after you sign in.\n` : ''}`,
  }
}

export function inviteEmail(org: Org, d: any, toName: string | null): Rendered {
  const url = link(org, `/auth?invite=${encodeURIComponent(d.code)}`)
  const bodyHtml = `${p(`Hi ${esc((toName || '').split(' ')[0] || 'there')},`)}
    ${p(`${d.invited_by ? esc(d.invited_by) : 'Your team'} invited you to join <b>${esc(org.orgName)}</b>${d.role ? ` as <b>${esc(String(d.role).replace(/_/g, ' '))}</b>` : ''}.`)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0"><tr><td style="padding:10px 16px;border:1px dashed #a5b4fc;border-radius:8px;background:#f5f7ff;font-family:Consolas,Menlo,monospace;font-size:20px;font-weight:700;letter-spacing:.12em;color:#3730a3">${esc(d.code)}</td></tr></table>
    ${button('Accept invite', url)}
    ${d.expires_at ? p(`This invite expires on ${esc(fmtDate(d.expires_at, org.timezone))}.`, `font-size:12px;color:${MUTED}`) : ''}`
  return {
    subject: `You're invited to join ${org.orgName}`,
    html: layout(org, { preheader: `Invite code ${d.code}`, heading: `Join ${org.orgName}`, bodyHtml, reason: `You're receiving this because someone at ${org.orgName} invited this address.`, prefs: false }),
    text: `You're invited to join ${org.orgName}.\n\nInvite code: ${d.code}\nAccept: ${url}\n`,
  }
}

export function testEmail(org: Org): Rendered {
  const bodyHtml = `${p(`Email delivery for <b>${esc(org.orgName)}</b> is working. Messages are sent as <b>${esc(org.fromName || org.orgName)}</b>.`)}
    ${p(`Sent ${esc(fmtDate(new Date(), org.timezone, true))} (${esc(org.timezone)}).`, `color:${MUTED};font-size:13px`)}`
  return {
    subject: `Test email from ${org.fromName || org.orgName}`,
    html: layout(org, { preheader: 'Email delivery is working', heading: 'Test email', bodyHtml, reason: `You're receiving this because you sent a test from Settings → Email.` }),
    text: `Email delivery for ${org.orgName} is working.\n`,
  }
}
