import { supabase } from '@/lib/supabase';
import { sendNotifToMany } from '@/lib/notifications';

// Mobile port of src/lib/wikiComments.js — same table/shape.

export type WikiComment = {
  id: string;
  page_id: string;
  user_id: string | null;
  comment: string;
  mentions: string[];
  created_at: string;
};

export async function listComments(pageId: string): Promise<WikiComment[]> {
  const { data, error } = await supabase.from('wiki_page_comments').select('*').eq('page_id', pageId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WikiComment[];
}

export async function addComment(
  pageId: string, userId: string, comment: string, mentionIds: string[],
  ctx: { pageTitle: string; spaceId: string; pageOwnerId: string | null },
) {
  const mentions = [...new Set(mentionIds)];
  const { error } = await supabase.from('wiki_page_comments').insert({ page_id: pageId, user_id: userId, comment, mentions });
  if (error) throw error;

  const notifyIds = mentions.filter(id => id !== userId);
  if (notifyIds.length) {
    await sendNotifToMany(notifyIds, {
      type: 'wiki_mention', title: `Mentioned in a comment on "${ctx.pageTitle}"`,
      body: comment.length > 100 ? comment.slice(0, 100) + '…' : comment,
      link: `/wiki?space=${ctx.spaceId}&page=${pageId}`, senderId: userId,
    });
  }
  if (ctx.pageOwnerId && ctx.pageOwnerId !== userId && !mentions.includes(ctx.pageOwnerId)) {
    await sendNotifToMany([ctx.pageOwnerId], {
      type: 'wiki_comment', title: `New comment on "${ctx.pageTitle}"`,
      body: comment.length > 100 ? comment.slice(0, 100) + '…' : comment,
      link: `/wiki?space=${ctx.spaceId}&page=${pageId}`, senderId: userId,
    });
  }
}

export async function deleteComment(id: string) {
  const { error } = await supabase.from('wiki_page_comments').delete().eq('id', id);
  if (error) throw error;
}
