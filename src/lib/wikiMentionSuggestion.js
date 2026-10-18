import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import { supabase } from './supabase'
import MentionList from '../components/wiki/MentionList'

// Standard Tiptap mention-suggestion shape: `items` resolves candidates as
// the user types after "@", `render` mounts MentionList into a tippy
// popup anchored at the caret and forwards keyboard nav into it.
export const wikiMentionSuggestion = {
  items: async ({ query }) => {
    let q = supabase.from('profiles').select('id,full_name,role').order('full_name').limit(8)
    if (query) q = q.ilike('full_name', `%${query}%`)
    const { data, error } = await q
    if (error) return []
    return data || []
  },

  render: () => {
    let component
    let popup

    return {
      onStart: props => {
        component = new ReactRenderer(MentionList, { props, editor: props.editor })
        if (!props.clientRect) return
        popup = tippy('body', {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },
      onUpdate(props) {
        component.updateProps(props)
        if (!props.clientRect) return
        popup[0].setProps({ getReferenceClientRect: props.clientRect })
      },
      onKeyDown(props) {
        if (props.event.key === 'Escape') { popup[0].hide(); return true }
        return component.ref?.onKeyDown(props) || false
      },
      onExit() {
        popup?.[0]?.destroy()
        component?.destroy()
      },
    }
  },
}
