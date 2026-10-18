import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MessageSquare, Send, Trash2 } from 'lucide-react-native';

import { Button, Card, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { dateFmt, supabase } from '@/lib/supabase';
import { useAddWikiComment, useDeleteWikiComment, useWikiComments } from '@/hooks/wiki';

type MentionCandidate = { id: string; full_name: string };

// Native TextInput-based @mention autocomplete — same plain-text-token
// approach as web's PageComments.jsx (no rich editor for comments), using
// onSelectionChange to track the cursor since RN has no DOM caret API.
export function PageCommentsSection({ pageId, pageTitle, spaceId, pageOwnerId }: {
  pageId: string; pageTitle: string; spaceId: string; pageOwnerId: string | null;
}) {
  const t = useTheme();
  const { profile } = useAuth();
  const commentsQ = useWikiComments(pageId);
  const addComment = useAddWikiComment(pageId, { pageTitle, spaceId, pageOwnerId });
  const deleteComment = useDeleteWikiComment(pageId);

  const [text, setText] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [pendingMentions, setPendingMentions] = useState<MentionCandidate[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionResults, setMentionResults] = useState<MentionCandidate[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [authors, setAuthors] = useState<MentionCandidate[]>([]);

  // wiki_page_comments.user_id is a soft ref (no FK), same convention as
  // web's PageComments.jsx — resolve names from a plain profiles fetch.
  useEffect(() => {
    supabase.from('profiles').select('id,full_name').order('full_name').then(({ data }) => setAuthors((data ?? []) as MentionCandidate[]));
  }, []);

  function handleChangeText(value: string) {
    setText(value);
    const cursor = selection.end;
    const uptoCursor = value.slice(0, cursor);
    const match = uptoCursor.match(/@([\w.]*)$/);
    if (match) {
      setMentionStart(cursor - match[0].length);
      const query = match[1];
      setMentionQuery(query);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        let q = supabase.from('profiles').select('id,full_name').order('full_name').limit(6);
        const { data } = query ? await q.ilike('full_name', `%${query}%`) : await q;
        setMentionResults((data ?? []) as MentionCandidate[]);
      }, 200);
    } else {
      setMentionQuery(null);
    }
  }

  function pickMention(user: MentionCandidate) {
    const before = text.slice(0, mentionStart);
    const after = text.slice(mentionStart + 1 + (mentionQuery?.length ?? 0));
    const inserted = `@${user.full_name} `;
    setText(before + inserted + after);
    setPendingMentions(prev => (prev.some(m => m.id === user.id) ? prev : [...prev, user]));
    setMentionQuery(null);
  }

  async function post() {
    if (!text.trim() || !profile) return;
    const mentionIds = pendingMentions.filter(m => text.includes(`@${m.full_name}`)).map(m => m.id);
    await addComment.mutateAsync({ comment: text.trim(), mentionIds });
    setText('');
    setPendingMentions([]);
  }

  const comments = commentsQ.data ?? [];

  return (
    <View style={{ gap: Spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <MessageSquare size={13} color={t.textMuted} />
        <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Comments {comments.length > 0 ? `(${comments.length})` : ''}
        </Text>
      </View>

      <View style={{ position: 'relative' }}>
        <TextField
          placeholder="Write a comment… use @ to mention someone"
          value={text}
          onChangeText={handleChangeText}
          onSelectionChange={e => setSelection(e.nativeEvent.selection)}
          multiline
          style={{ minHeight: 56 }}
        />
        {mentionQuery !== null ? (
          <View style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
            backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: Radius.md,
            maxHeight: 200, elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8,
          }}>
            {mentionResults.length === 0 ? (
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5, padding: 12 }}>No matches</Text>
            ) : mentionResults.map(u => (
              <Pressable key={u.id} onPress={() => pickMention(u)} style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
                <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13.5 }}>{u.full_name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <Button title="Post" icon={<Send size={13} color="#fff" />} onPress={post} loading={addComment.isPending} disabled={!text.trim()} />

      {comments.length === 0 ? (
        <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5, textAlign: 'center' }}>No comments yet — start the discussion above.</Text>
      ) : (
        comments.map(c => {
          const author = authors.find(a => a.id === c.user_id);
          return (
            <Card key={c.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 12.5 }}>{author?.full_name ?? 'Unknown'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 10.5 }}>{dateFmt(c.created_at)}</Text>
                  {c.user_id === profile?.id ? (
                    <Pressable onPress={() => deleteComment.mutate(c.id)}><Trash2 size={13} color={t.danger} /></Pressable>
                  ) : null}
                </View>
              </View>
              <Text style={{ color: t.text, fontFamily: Fonts.body, fontSize: 13, lineHeight: 19 }}>{c.comment}</Text>
            </Card>
          );
        })
      )}
    </View>
  );
}
