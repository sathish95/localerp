import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import { Modal, Confirm, Loader, Empty } from '../components/ui'
import { listSpaces, createSpace, archiveSpace, ensureProjectSpace } from '../lib/wikiSpaces'
import { listPages, createPage, renamePage, deletePage, movePage, buildPageTree, searchPages, setPageProject } from '../lib/wikiPages'
import PageEditor from '../components/wiki/PageEditor'
import PageComments from '../components/wiki/PageComments'
import PageLabels from '../components/wiki/PageLabels'
import PageRestrictions from '../components/wiki/PageRestrictions'
import {
  Library, Plus, ChevronRight, ChevronDown, FileText, Edit2, Trash2, ArrowLeft, FolderTree, MoveRight, Search, Briefcase,
} from 'lucide-react'

const iSpace = () => ({ key: '', name: '', description: '' })

export default function WikiPage() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const spaceId = searchParams.get('space')
  const pageId = searchParams.get('page')

  const [spaces, setSpaces] = useState([])
  const [loadingSpaces, setLoadingSpaces] = useState(true)
  const [showSpaceModal, setShowSpaceModal] = useState(false)
  const [spaceForm, setSpaceForm] = useState(iSpace())
  const [subSpace, setSubSpace] = useState(false)

  const [pages, setPages] = useState([])
  const [loadingPages, setLoadingPages] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [showPageModal, setShowPageModal] = useState(false)
  const [pageForm, setPageForm] = useState({ title: '', parentPageId: null, projectId: '' })
  const [renameId, setRenameId] = useState(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [moveItem, setMoveItem] = useState(null)
  const [deleteItem, setDeleteItem] = useState(null)
  const [archiveConfirm, setArchiveConfirm] = useState(null)

  const [projects, setProjects] = useState([])
  const [openingProject, setOpeningProject] = useState(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try { setSearchResults(await searchPages(searchQuery)) } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  function openSearchResult(r) {
    setSearchQuery(''); setSearchResults([])
    setSearchParams({ space: r.space_id, page: r.id })
  }

  function renderSearchBar() {
    return (
      <div style={{ position: 'relative', marginBottom: 18, maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <Search size={14} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search all wiki pages…"
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: 13 }} />
        </div>
        {searchQuery.trim() && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,.12)', maxHeight: 300, overflowY: 'auto',
          }}>
            {searching ? (
              <div style={{ padding: 14, fontSize: 12.5, color: 'var(--ink-muted)' }}>Searching…</div>
            ) : searchResults.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12.5, color: 'var(--ink-muted)' }}>No pages match "{searchQuery}"</div>
            ) : searchResults.map(r => (
              <div key={r.id} onClick={() => openSearchResult(r)}
                style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
                  <FileText size={12} /> {r.title}
                </div>
                {r.content_text && (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {r.content_text}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  useEffect(() => { loadSpaces(); loadProjects() }, [])
  async function loadSpaces() {
    setLoadingSpaces(true)
    try { setSpaces(await listSpaces()) } finally { setLoadingSpaces(false) }
  }
  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id,name,code,status').eq('status', 'active').order('name')
    setProjects(data || [])
  }

  // Opening a project's wiki space auto-creates it the first time —
  // no manual "New Space" step for project spaces.
  async function handleOpenProjectSpace(project) {
    setOpeningProject(project.id)
    try {
      const s = await ensureProjectSpace(project, profile.id)
      await loadSpaces()
      openSpace(s.id)
    } catch (err) { alert(err.message) } finally { setOpeningProject(null) }
  }

  const loadPages = useCallback(async () => {
    if (!spaceId) return
    setLoadingPages(true)
    try { setPages(await listPages(spaceId)) } finally { setLoadingPages(false) }
  }, [spaceId])
  useEffect(() => { loadPages() }, [loadPages])

  const space = spaces.find(s => s.id === spaceId)
  const tree = buildPageTree(pages)
  const selectedPage = pages.find(p => p.id === pageId)

  function openSpace(id) {
    setSearchParams({ space: id })
  }
  function backToSpaces() {
    setSearchParams({})
  }
  function selectPage(id) {
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('page', id); return p })
  }

  async function handleCreateSpace(e) {
    e.preventDefault(); setSubSpace(true)
    try {
      const s = await createSpace(spaceForm, profile.id)
      setShowSpaceModal(false); setSpaceForm(iSpace())
      await loadSpaces()
      openSpace(s.id)
    } catch (err) { alert(err.message) } finally { setSubSpace(false) }
  }

  async function handleArchiveSpace() {
    if (!archiveConfirm) return
    await archiveSpace(archiveConfirm)
    setArchiveConfirm(null)
    if (spaceId === archiveConfirm) backToSpaces()
    await loadSpaces()
  }

  async function handleCreatePage(e) {
    e.preventDefault()
    try {
      const p = await createPage({ spaceId, parentPageId: pageForm.parentPageId, title: pageForm.title, projectId: pageForm.projectId }, profile.id)
      setShowPageModal(false); setPageForm({ title: '', parentPageId: null, projectId: space?.project_id || '' })
      if (pageForm.parentPageId) setExpanded(x => ({ ...x, [pageForm.parentPageId]: true }))
      await loadPages()
      selectPage(p.id)
    } catch (err) { alert(err.message) }
  }

  async function handleRename(e) {
    e.preventDefault()
    try {
      await renamePage(renameId, renameTitle, profile.id)
      setRenameId(null)
      await loadPages()
    } catch (err) { alert(err.message) }
  }

  async function handleMove(newParentId) {
    try {
      await movePage(moveItem.id, newParentId, pages)
      setMoveItem(null)
      await loadPages()
    } catch (err) { alert(err.message) }
  }

  async function handleDelete() {
    if (!deleteItem) return
    await deletePage(deleteItem, pages)
    setDeleteItem(null)
    if (pageId === deleteItem) setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('page'); return p })
    await loadPages()
  }

  /* ══════════ SPACE LIST ══════════ */
  if (!spaceId) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: '1.6rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Library size={24} style={{ color: 'var(--c1)' }} /> ThingsAlive Wiki
            </h1>
            <p style={{ color: 'var(--ink-muted)', fontSize: 13 }}>Spaces, pages, and everything your team writes down.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowSpaceModal(true)}><Plus size={15} /> New Space</button>
        </div>

        {renderSearchBar()}

        {projects.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Briefcase size={12} /> Projects
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
              {projects.map(p => {
                const linkedSpace = spaces.find(s => s.project_id === p.id)
                return (
                  <div key={p.id} className="card hover-lift" style={{ cursor: openingProject ? 'wait' : 'pointer', padding: 14, opacity: openingProject && openingProject !== p.id ? 0.6 : 1 }}
                    onClick={() => !openingProject && handleOpenProjectSpace(p)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--amber-soft, #fef3c7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706', flexShrink: 0 }}>
                        <Briefcase size={14} />
                      </div>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>{linkedSpace ? 'Open wiki space' : (openingProject === p.id ? 'Creating space…' : 'Create wiki space')}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Library size={12} /> Spaces
        </div>
        {loadingSpaces ? <Loader /> : spaces.length === 0 ? (
          <Empty icon={<Library size={28} />} title="No spaces yet" desc="Create your first space to start writing pages." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
            {spaces.map(s => (
              <div key={s.id} className="card hover-lift" style={{ cursor: 'pointer', padding: 18 }} onClick={() => openSpace(s.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--c1-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c1)', fontWeight: 800 }}>
                    {(s.name || '?')[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {s.name}
                      {s.project_id && <Briefcase size={11} style={{ color: '#d97706' }} title="Project space" />}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'monospace' }}>{s.key}</div>
                  </div>
                </div>
                {s.description && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.5 }}>{s.description}</div>}
              </div>
            ))}
          </div>
        )}

        <Modal open={showSpaceModal} onClose={() => setShowSpaceModal(false)} title="New Space"
          footer={<><button className="btn btn-ghost" onClick={() => setShowSpaceModal(false)}>Cancel</button><button className="btn btn-primary" onClick={handleCreateSpace} disabled={subSpace}>{subSpace ? 'Creating…' : 'Create'}</button></>}>
          <div className="form-group"><label className="form-label">Space Key *</label>
            <input className="form-input" style={{ fontFamily: 'monospace', textTransform: 'uppercase' }} value={spaceForm.key}
              onChange={e => setSpaceForm(f => ({ ...f, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))} placeholder="e.g. ENG" maxLength={10} required /></div>
          <div className="form-group"><label className="form-label">Name *</label>
            <input className="form-input" value={spaceForm.name} onChange={e => setSpaceForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Engineering" required /></div>
          <div className="form-group"><label className="form-label">Description</label>
            <textarea className="form-textarea" value={spaceForm.description} onChange={e => setSpaceForm(f => ({ ...f, description: e.target.value }))} placeholder="What lives in this space?" /></div>
        </Modal>
      </div>
    )
  }

  /* ══════════ SPACE DETAIL (tree + page) ══════════ */
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <button className="btn btn-ghost btn-sm" onClick={backToSpaces} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, color: 'var(--ink-muted)' }}>
            <ArrowLeft size={13} /> All Spaces
          </button>
          <h1 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: '1.4rem' }}>{space?.name || 'Space'}</h1>
        </div>
        {space && <button className="btn btn-outline btn-sm" style={{ color: '#ef4444' }} onClick={() => setArchiveConfirm(space.id)}>Archive Space</button>}
      </div>

      {renderSearchBar()}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18, alignItems: 'flex-start' }}>
        {/* ── Page tree sidebar ── */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)' }}>Pages</span>
            <button className="btn btn-ghost btn-sm btn-icon" title="New root page" onClick={() => { setPageForm({ title: '', parentPageId: null, projectId: space?.project_id || '' }); setShowPageModal(true) }}><Plus size={14} /></button>
          </div>
          {loadingPages ? <Loader /> : tree.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', padding: '10px 4px' }}>No pages yet.</div>
          ) : (
            <PageTree nodes={tree} depth={0} expanded={expanded} setExpanded={setExpanded}
              selectedId={pageId} onSelect={selectPage}
              onAddChild={parentId => { setPageForm({ title: '', parentPageId: parentId, projectId: space?.project_id || '' }); setShowPageModal(true) }}
              onRename={(id, title) => { setRenameId(id); setRenameTitle(title) }}
              onMove={node => setMoveItem(node)}
              onDelete={id => setDeleteItem(id)} />
          )}
        </div>

        {/* ── Selected page ── */}
        <div className="card" style={{ padding: 24, minHeight: 320 }}>
          {!selectedPage ? (
            <Empty icon={<FileText size={28} />} title="Select a page" desc="Pick a page from the tree, or create a new one." />
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: '1.5rem' }}>{selectedPage.title}</h2>
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setRenameId(selectedPage.id); setRenameTitle(selectedPage.title) }}><Edit2 size={13} /></button>
                  <PageRestrictions pageId={selectedPage.id} profile={profile} />
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginBottom: 12 }}>
                Updated {dateFmt(selectedPage.updated_at)} · Created {dateFmt(selectedPage.created_at)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <Briefcase size={12} style={{ color: 'var(--ink-muted)' }} />
                <select className="form-select" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}
                  value={selectedPage.project_id || ''}
                  onChange={async e => { await setPageProject(selectedPage.id, e.target.value || null); await loadPages() }}>
                  <option value="">No project</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <PageLabels key={`${selectedPage.id}-labels`} pageId={selectedPage.id} />
              <PageEditor key={selectedPage.id} pageId={selectedPage.id} pageTitle={selectedPage.title} profile={profile} projectId={selectedPage.project_id} />
              <PageComments key={`${selectedPage.id}-comments`} pageId={selectedPage.id} pageTitle={selectedPage.title}
                spaceId={spaceId} pageOwnerId={selectedPage.created_by} profile={profile} />
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      <Modal open={showPageModal} onClose={() => setShowPageModal(false)} title={pageForm.parentPageId ? 'New Sub-page' : 'New Page'}
        footer={<><button className="btn btn-ghost" onClick={() => setShowPageModal(false)}>Cancel</button><button className="btn btn-primary" onClick={handleCreatePage}>Create</button></>}>
        <div className="form-group"><label className="form-label">Title *</label>
          <input className="form-input" value={pageForm.title} onChange={e => setPageForm(f => ({ ...f, title: e.target.value }))} placeholder="Page title" autoFocus required /></div>
        <div className="form-group"><label className="form-label">Project</label>
          <select className="form-select" value={pageForm.projectId || ''} onChange={e => setPageForm(f => ({ ...f, projectId: e.target.value }))}>
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {space?.project_id && <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 3 }}>Pre-filled from this space's project — change if this page is about a different one.</div>}
        </div>
      </Modal>

      <Modal open={!!renameId} onClose={() => setRenameId(null)} title="Rename Page"
        footer={<><button className="btn btn-ghost" onClick={() => setRenameId(null)}>Cancel</button><button className="btn btn-primary" onClick={handleRename}>Save</button></>}>
        <div className="form-group"><label className="form-label">Title *</label>
          <input className="form-input" value={renameTitle} onChange={e => setRenameTitle(e.target.value)} autoFocus required /></div>
      </Modal>

      <Modal open={!!moveItem} onClose={() => setMoveItem(null)} title={`Move "${moveItem?.title || ''}"`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
          <button className="btn btn-outline btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => handleMove(null)}>
            <FolderTree size={13} /> Top level (no parent)
          </button>
          {pages.filter(p => p.id !== moveItem?.id).map(p => (
            <button key={p.id} className="btn btn-outline btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => handleMove(p.id)}>
              <MoveRight size={13} /> {p.title}
            </button>
          ))}
        </div>
      </Modal>

      <Confirm open={!!deleteItem} message="Delete this page and all its sub-pages permanently?" danger
        onConfirm={handleDelete} onCancel={() => setDeleteItem(null)} />
      <Confirm open={!!archiveConfirm} message={`Archive "${space?.name}"? It will be hidden from the space list.`} danger
        onConfirm={handleArchiveSpace} onCancel={() => setArchiveConfirm(null)} />
    </div>
  )
}

function PageTree({ nodes, depth, expanded, setExpanded, selectedId, onSelect, onAddChild, onRename, onMove, onDelete }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {nodes.map(node => {
        const isOpen = expanded[node.id] ?? true
        const hasChildren = node.children?.length > 0
        return (
          <div key={node.id}>
            <div
              className="wiki-tree-row"
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '5px 6px', paddingLeft: 6 + depth * 16,
                borderRadius: 6, cursor: 'pointer', fontSize: 13,
                background: selectedId === node.id ? 'var(--c1-soft)' : 'transparent',
                color: selectedId === node.id ? 'var(--c1)' : 'inherit', fontWeight: selectedId === node.id ? 700 : 500,
              }}
              onClick={() => onSelect(node.id)}
            >
              <span style={{ width: 14, flexShrink: 0, display: 'flex' }} onClick={e => { e.stopPropagation(); if (hasChildren) setExpanded(x => ({ ...x, [node.id]: !isOpen })) }}>
                {hasChildren ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
              </span>
              <FileText size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title}</span>
              <span style={{ display: 'flex', gap: 2 }}>
                <button className="btn btn-ghost btn-sm btn-icon" title="Add sub-page" onClick={e => { e.stopPropagation(); onAddChild(node.id) }}><Plus size={11} /></button>
                <button className="btn btn-ghost btn-sm btn-icon" title="Rename" onClick={e => { e.stopPropagation(); onRename(node.id, node.title) }}><Edit2 size={11} /></button>
                <button className="btn btn-ghost btn-sm btn-icon" title="Move" onClick={e => { e.stopPropagation(); onMove(node) }}><MoveRight size={11} /></button>
                <button className="btn btn-ghost btn-sm btn-icon" title="Delete" style={{ color: '#ef4444' }} onClick={e => { e.stopPropagation(); onDelete(node.id) }}><Trash2 size={11} /></button>
              </span>
            </div>
            {hasChildren && isOpen && (
              <PageTree nodes={node.children} depth={depth + 1} expanded={expanded} setExpanded={setExpanded}
                selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} onRename={onRename} onMove={onMove} onDelete={onDelete} />
            )}
          </div>
        )
      })}
    </div>
  )
}
