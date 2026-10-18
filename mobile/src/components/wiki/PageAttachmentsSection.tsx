import { Linking, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File as FileIcon, Image as ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react-native';

import { useTheme } from '@/hooks/use-theme';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { attachmentUrl } from '@/lib/wikiAttachments';
import { useDeleteWikiAttachment, useUploadWikiAttachment, useWikiAttachments } from '@/hooks/wiki';

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PageAttachmentsSection({ pageId }: { pageId: string }) {
  const t = useTheme();
  const attachmentsQ = useWikiAttachments(pageId);
  const upload = useUploadWikiAttachment(pageId);
  const remove = useDeleteWikiAttachment(pageId);

  const files = attachmentsQ.data ?? [];

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const name = asset.fileName ?? asset.uri.split('/').pop() ?? `image-${Date.now()}.jpg`;
    await upload.mutateAsync({ uri: asset.uri, fileName: name, mimeType: asset.mimeType });
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    await upload.mutateAsync({ uri: asset.uri, fileName: asset.name, mimeType: asset.mimeType ?? undefined });
  }

  return (
    <View style={{ gap: Spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Paperclip size={12} color={t.textMuted} />
          <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Files {files.length > 0 ? `(${files.length})` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={pickImage} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <ImageIcon size={13} color={t.accent} />
            <Text style={{ color: t.accent, fontFamily: Fonts.bodySemiBold, fontSize: 11.5 }}>Image</Text>
          </Pressable>
          <Pressable onPress={pickFile} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Upload size={13} color={t.accent} />
            <Text style={{ color: t.accent, fontFamily: Fonts.bodySemiBold, fontSize: 11.5 }}>File</Text>
          </Pressable>
        </View>
      </View>

      {upload.isPending ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12 }}>Uploading…</Text> : null}

      {files.map(f => (
        <Pressable key={f.id} onPress={() => Linking.openURL(attachmentUrl(f.storage_path))}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderRadius: Radius.md, backgroundColor: t.surfaceSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <FileIcon size={14} color={t.accent} />
            <Text style={{ color: t.accent, fontFamily: Fonts.bodySemiBold, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{f.file_name}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 10.5 }}>{formatSize(f.size_bytes)}</Text>
            <Pressable onPress={() => remove.mutate({ id: f.id, storagePath: f.storage_path })}><Trash2 size={13} color={t.danger} /></Pressable>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
