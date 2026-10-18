import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import EmailActivity, { AuditLog } from '../components/outlook/EmailActivity'
import OutlookSettings from '../components/outlook/OutlookSettings'
import SampleEmailModal from '../components/outlook/SampleEmailModal'
import ExceptionQueue, { DocumentQueue } from '../components/ei/ExceptionQueue'
import { DocumentReviewQueue } from '../components/ei/DocumentFiling'
import TypeSuggestions from '../components/ei/TypeSuggestions'
import { ComplianceOverview } from '../components/ei/ComplianceRegister'
import EmailIntelligenceSettings from '../components/ei/EmailIntelligenceSettings'
import { Stats, SectionHead } from '../components/ei/ui'
import AiOverview from '../components/ei/AiOverview'
import { exceptionCounts, invoicesFromEmailCount, documentReviewCount, pendingSuggestionCount } from '../lib/emailIntelligence'
import { messageCounts, loadLookups, listMailboxes } from '../lib/outlookEmail'
import { supabase } from '../lib/supabase'
import { Inbox, ListChecks, AlertTriangle, History, Settings, Mails, FlaskConical, ShieldAlert, FileText, SlidersHorizontal, RefreshCw, Sparkles, FolderInput, Wand2, ClipboardCheck } from 'lucide-react'

// NeoX Email Intelligence, formerly Email to Tasks (STEP261 + Email Intelligence
// STEP263–265): emails from the connected mailbox are classified by the
// admin-configured rules; vendor invoices go through PO / GRN / duplicate
// checks into the invoice register, customer project issues become tasks,
// everything else is recorded or waits in the exception / review queues.
const NAV = [
  { group: 'Work', items: [
    { id: 'overview', label: 'AI Overview', icon: Sparkles, desc: 'What the automation did, how confident it was, and where people are needed' },
    { id: 'exceptions', label: 'Exceptions', icon: ShieldAlert, desc: 'Invoice, vendor and category items the automation would not decide alone' },
    { id: 'filing', label: 'Document filing', icon: FolderInput, desc: 'Documents whose project or type the automation could not confirm — file them on the right project' },
    { id: 'new-types', label: 'New document types', icon: Wand2, desc: 'Document types the AI met that the taxonomy does not have yet — approve, merge or reject' },
    { id: 'review', label: 'Review queue', icon: Inbox, desc: 'Customer emails whose project is unclear or below the confidence threshold' },
    { id: 'failed', label: 'Failed', icon: AlertTriangle, desc: 'Emails that could not be processed — retried automatically with backoff' },
  ] },
  { group: 'Records', items: [
    { id: 'all', label: 'All emails', icon: Mails, desc: 'Every email received, with its intent and outcome' },
    { id: 'documents', label: 'Documents', icon: FileText, desc: 'Every attachment, classified on its own, with extracted fields and checks' },
    { id: 'compliance', label: 'Compliance registers', icon: ClipboardCheck, desc: 'Required vs received documents, approvals, statutory permits and expiring guarantees per project' },
    { id: 'created', label: 'Action items created', icon: ListChecks, desc: 'Tasks created from customer emails' },
  ] },
  { group: 'Admin', items: [
    { id: 'audit', label: 'Audit log', icon: History, desc: 'Everything the automation and reviewers did' },
    { id: 'config', label: 'Configuration', icon: SlidersHorizontal, desc: 'Categories, rules, document types, matching — versioned' },
    { id: 'settings', label: 'Mailbox', icon: Settings, desc: 'Microsoft 365 connection and processing rules' },
  ] },
]
const ALL_ITEMS = NAV.flatMap(g => g.items)

export default function EmailToTasksPage() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = ALL_ITEMS.some(t => t.id === params.get('tab')) ? params.get('tab') : 'overview'
  const [counts, setCounts] = useState(null)
  const [lookups, setLookups] = useState({ projects: [], people: [] })
  const [mailboxes, setMailboxes] = useState(null)
  const [setupErr, setSetupErr] = useState('')
  const [sampling, setSampling] = useState(false)
  const [bump, setBump] = useState(0)
  const [exc, setExc] = useState(null)
  const [invCount, setInvCount] = useState(null)
  const [eiCats, setEiCats] = useState([])
  const [filing, setFiling] = useState(null)
  const [newTypes, setNewTypes] = useState(null)

  const refresh = () => {
    messageCounts().then(setCounts).catch(e => setSetupErr(e.message))
    exceptionCounts().then(setExc).catch(() => setExc(null))
    invoicesFromEmailCount().then(setInvCount)
    documentReviewCount().then(setFiling)
    pendingSuggestionCount().then(setNewTypes)
  }
  useEffect(() => {
    refresh()
    loadLookups().then(setLookups).catch(() => {})
    listMailboxes().then(setMailboxes).catch(e => { setMailboxes([]); setSetupErr(e.message) })
    supabase.from('ei_email_categories').select('code, name, group_name').then(({ data }) => setEiCats(data || []))
  }, [])

  const setTab = id => setParams(p => { const n = new URLSearchParams(p); n.set('tab', id); return n }, { replace: true })
  const c = counts || {}
  const total = Object.values(c).reduce((s, n) => s + n, 0)
  const noSchema = /outlook_|schema cache|does not exist/i.test(setupErr)
  const isAdmin = ['admin', 'ceo'].includes(profile?.role)
  const live = (mailboxes || []).filter(m => m.enabled)
  const openExc = exc?.length ?? 0
  const urgentExc = (exc || []).filter(x => x.priority === 'critical' || x.priority === 'high').length
  const failed = (c.FAILED || 0) + (c.DEAD || 0)
  const badge = { filing, 'new-types': newTypes, exceptions: openExc, review: c.REVIEW || 0, failed, all: total || null, created: c.TASK_CREATED || null }
  const cur = ALL_ITEMS.find(t => t.id === tab)

  // Per-section summary — only what matters for the section on screen.
  const stats = {
    exceptions: [['Open', openExc, openExc ? 'warn' : 'good'], ['High / critical', urgentExc, urgentExc ? 'bad' : ''], ['Invoice checks', (exc || []).filter(x => !x.kind.startsWith('CATEGORY_REVIEW:') && !['VENDOR_VERIFICATION', 'BANK_DETAIL_CHANGE', 'VENDOR_MASTER_CHANGE'].includes(x.kind)).length], ['Vendor & bank', (exc || []).filter(x => ['VENDOR_VERIFICATION', 'BANK_DETAIL_CHANGE', 'VENDOR_MASTER_CHANGE'].includes(x.kind)).length], ['Invoices from email (30 d)', invCount, 'good']],
    review: [['Waiting', c.REVIEW || 0, c.REVIEW ? 'warn' : 'good'], ['Action items created', c.TASK_CREATED || 0, 'good'], ['Dismissed', c.DISMISSED || 0]],
    failed: [['Retrying', c.FAILED || 0, c.FAILED ? 'warn' : ''], ['Gave up', c.DEAD || 0, c.DEAD ? 'bad' : ''], ['In progress', (c.PENDING || 0) + (c.PROCESSING || 0)]],
    all: [['Emails (30 d)', total], ['Processed', c.PROCESSED || 0, 'good'], ['Action items', c.TASK_CREATED || 0], ['In review', c.REVIEW || 0], ['Ignored', (c.IGNORED || 0) + (c.DISMISSED || 0)], ['Failed', failed, failed ? 'bad' : '']],
    documents: [['Invoices from email (30 d)', invCount, 'good'], ['Open invoice checks', (exc || []).filter(x => !x.kind.startsWith('CATEGORY_REVIEW:')).length]],
    created: [['Action items (30 d)', c.TASK_CREATED || 0, 'good'], ['Waiting for review', c.REVIEW || 0]],
  }[tab]

  return (
    <div className="eic">
      <div className="eic-head card">
        <div className="eic-head-main">
          <div className="eic-head-title">NeoX Email Intelligence</div>
          <div className="eic-head-sub">Vendor invoices matched to PO / GRN into the invoice register · customer issues become tasks · everything else recorded or reviewed</div>
        </div>
        <div className="eic-head-status">
          {mailboxes && (live.length
            ? <span className="eic-chip"><span className="eic-dot green" /> {live.map(m => m.mailbox_address).join(', ')}</span>
            : <span className="eic-chip warn"><span className="eic-dot amber" /> No mailbox processing yet</span>)}
          {exc !== null && <span className={`eic-chip ${urgentExc ? 'warn' : 'ok'}`}>{openExc} open exception{openExc === 1 ? '' : 's'}</span>}
        </div>
        <div className="eic-head-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => { refresh(); setBump(b => b + 1) }}><RefreshCw size={13} /> Refresh</button>
          {isAdmin && mailboxes?.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setSampling(true)}><FlaskConical size={13} /> Sample email</button>}
          {isAdmin && mailboxes && !live.length && tab !== 'settings' && <button className="btn btn-primary btn-sm" onClick={() => setTab('settings')}>Connect mailbox</button>}
        </div>
      </div>

      {noSchema ? (
        <div className="card" style={{ padding: 20 }}>The database objects for this module aren't installed yet. Run <code>sql/STEP261</code>–<code>STEP265</code> in the Supabase SQL editor, then reload.</div>
      ) : (
        <div className="eic-body">
          <nav className="eic-rail card">
            {NAV.map(g => (
              <div key={g.group} className="eic-rail-group">
                <div className="eic-rail-gh">{g.group}</div>
                {g.items.map(t => {
                  const Icon = t.icon
                  const n = badge[t.id]
                  const hot = (t.id === 'exceptions' && urgentExc) || (t.id === 'failed' && failed)
                  return (
                    <button key={t.id} type="button" className={`eic-rail-item compact${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
                      <Icon size={15} /><span className="eic-rail-label">{t.label}</span>
                      {n ? <span className={`eic-count${hot ? ' hot' : ''}`}>{n}</span> : null}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>

          <main className="eic-main">
            {!['config', 'settings'].includes(tab) && <SectionHead title={cur.label} desc={cur.desc} />}
            {stats && <Stats items={stats} />}
            {tab === 'overview' ? <AiOverview categories={eiCats} mailboxLive={live.length > 0} onGo={setTab} />
              : tab === 'settings' ? <><SectionHead title="Mailbox" desc={cur.desc} /><OutlookSettings /></>
              : tab === 'config' ? <EmailIntelligenceSettings embedded />
              : tab === 'exceptions' ? <ExceptionQueue key={bump} categories={eiCats} people={lookups.people} onChanged={refresh} />
              : tab === 'documents' ? <DocumentQueue key={bump} />
              : tab === 'filing' ? <DocumentReviewQueue key={bump} onChanged={refresh} />
              : tab === 'new-types' ? <TypeSuggestions key={bump} onChanged={refresh} />
              : tab === 'compliance' ? <ComplianceOverview key={bump} />
              : tab === 'audit' ? <AuditLog key={bump} lookups={lookups} />
              : <EmailActivity key={`${tab}-${bump}`} view={tab} lookups={lookups} onChanged={refresh} categories={eiCats} />}
          </main>
        </div>
      )}
      {sampling && <SampleEmailModal mailboxes={mailboxes} projects={lookups.projects} onClose={() => setSampling(false)} onDone={() => { refresh(); setBump(b => b + 1) }} />}
    </div>
  )
}
