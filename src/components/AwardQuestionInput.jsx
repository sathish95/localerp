// Renders one configurable award_questions row (text/long_text/rating/
// number/yes_no/attachment) — shared between the employee Self Feedback
// form and the Manager Feedback form so the question-type switch lives
// in exactly one place.
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function QuestionInput({ question, value, disabled, onChange, onFile }) {
  switch (question.question_type) {
    case 'long_text':
      return <textarea className="form-input" rows={3} value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)} />
    case 'number':
      return <input className="form-input" type="number" value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)} />
    case 'rating':
      return (
        <select className="form-select" value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)}>
          <option value="">Select…</option>
          {[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      )
    case 'yes_no':
      return (
        <select className="form-select" value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)}>
          <option value="">Select…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      )
    case 'attachment':
      return (
        <div>
          <input type="file" disabled={disabled} onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
          {value && <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>File attached</div>}
        </div>
      )
    default:
      return <input className="form-input" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)} />
  }
}
