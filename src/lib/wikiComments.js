import { supabase } from './supabase'
import { sendNotifToMany } from './notifications'

export async function listComments(pageId) {
  const { data, error } = await supabase.from('wiki_page_comments').select('*').eq('page_id', pageId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addComment(pageId, userId, comment, mentionIds, { pageTitle, spaceId, pageOwnerId }) {
  const mentions = [...new Set(mentionIds)]
  const { error } = await supabase.from('wiki_page_comments').insert({ page_id: pageId, user_id: userId, comment, mentions })
  if (error) throw error

  const notifyIds = mentions.filter(id => id !== userId)
  if (notifyIds.length) {
    await sendNotifToMany(notifyIds, {
      type: 'wiki_mention', title: `💬 Mentioned in a comment on "${pageTitle}"`,
      body: comment.length > 100 ? comment.slice(0, 100) + '…' : comment,
      link: `/wiki?space=${spaceId}&page=${pageId}`, senderId: userId,
    })
  }
  // Also let the page owner know about new comments, unless they wrote it
  // or were already mentioned (which just notified them above).
  if (pageOwnerId && pageOwnerId !== userId && !mentions.includes(pageOwnerId)) {
    await sendNotifToMany([pageOwnerId], {
      type: 'wiki_comment', title: `💬 New comment on "${pageTitle}"`,
      body: comment.length > 100 ? comment.slice(0, 100) + '…' : comment,
      link: `/wiki?space=${spaceId}&page=${pageId}`, senderId: userId,
    })
  }
}

export async function deleteComment(id) {
  const { error } = await supabase.from('wiki_page_comments').delete().eq('id', id)
  if (error) throw error
}
