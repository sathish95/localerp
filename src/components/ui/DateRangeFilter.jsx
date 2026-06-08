import { useState } from 'react'
import { Calendar } from 'lucide-react'

const todayStr = () => new Date().toISOString().split('T')[0]
const firstOfMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }
const lastOfMonth  = () => { const d=new Date(); return new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().split('T')[0] }

const PRESETS = [
  { label:'This Month',  fn:()=>({ from:firstOfMonth(), to:lastOfMonth() }) },
  { label:'Last 30 Days',fn:()=>{ const t=new Date(),f=new Date(t); f.setDate(f.getDate()-30); return { from:f.toISOString().split('T')[0], to:t.toISOString().split('T')[0] } } },
  { label:'Last 90 Days',fn:()=>{ const t=new Date(),f=new Date(t); f.setDate(f.getDate()-90); return { from:f.toISOString().split('T')[0], to:t.toISOString().split('T')[0] } } },
  { label:'This Year',   fn:()=>{ const y=new Date().getFullYear(); return { from:`${y}-01-01`, to:`${y}-12-31` } } },
  { label:'All Time',    fn:()=>({ from:'2020-01-01', to:todayStr() }) },
]

export default function DateRangeFilter({ from, to, onChange, label='Date Range' }) {
  const [open, setOpen] = useState(false)

  function apply(f, t) {
    onChange({ from:f, to:t })
    setOpen(false)
  }

  return (
    <div style={{ position:'relative', display:'inline-block' }}>
      <button onClick={()=>setOpen(o=>!o)}
        style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderRadius:8,
          border:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer',
          fontFamily:'inherit', fontSize:12, fontWeight:600, color:'var(--text-soft)',
          transition:'all .15s', whiteSpace:'nowrap' }}>
        <Calendar size={14} style={{color:'var(--c1)'}}/>
        {from&&to ? `${from} → ${to}` : label}
      </button>

      {open && (
        <>
          <div style={{position:'fixed',inset:0,zIndex:299}} onClick={()=>setOpen(false)}/>
          <div style={{position:'absolute',top:'calc(100% + 6px)',left:0,zIndex:300,width:320,
            background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,
            boxShadow:'var(--shadow-lg)',padding:16}}>

            {/* Presets */}
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
              {PRESETS.map(p=>(
                <button key={p.label} onClick={()=>{ const r=p.fn(); apply(r.from,r.to) }}
                  style={{padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',
                    background:'var(--surface-2)',cursor:'pointer',fontSize:11,fontWeight:600,
                    color:'var(--text-soft)',fontFamily:'inherit',transition:'all .13s'}}
                  onMouseEnter={e=>{e.currentTarget.style.background='var(--c1)';e.currentTarget.style.color='#fff';e.currentTarget.style.borderColor='var(--c1)'}}
                  onMouseLeave={e=>{e.currentTarget.style.background='var(--surface-2)';e.currentTarget.style.color='var(--text-soft)';e.currentTarget.style.borderColor='var(--border)'}}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom range */}
            <div style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Custom Range</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4}}>From</div>
                <input type="date" value={from||''} onChange={e=>onChange({from:e.target.value,to})}
                  style={{width:'100%',padding:'7px 10px',borderRadius:7,border:'1px solid var(--border)',background:'var(--bg-3)',color:'var(--text)',fontSize:12,fontFamily:'inherit',outline:'none'}}/>
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4}}>To</div>
                <input type="date" value={to||''} min={from} onChange={e=>onChange({from,to:e.target.value})}
                  style={{width:'100%',padding:'7px 10px',borderRadius:7,border:'1px solid var(--border)',background:'var(--bg-3)',color:'var(--text)',fontSize:12,fontFamily:'inherit',outline:'none'}}/>
              </div>
            </div>
            <button className="btn btn-primary" style={{width:'100%',justifyContent:'center'}}
              onClick={()=>setOpen(false)}>Apply</button>
          </div>
        </>
      )}
    </div>
  )
}
