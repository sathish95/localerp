import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';

import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL ?? '';

// Hosts the SAME Tiptap+Yjs editor the web app uses (src/pages/EmbedWikiPage.jsx
// -> src/components/wiki/PageEditor.jsx) inside a WebView, so mobile and web
// co-edit the identical live document — no RN rich-text/Yjs port exists or
// is needed. Auth handoff: the embed page has no session on load, posts
// {type:'ready'}, we reply with {type:'auth', access_token, refresh_token}
// from this device's own Supabase session.
export function WikiEditorWebView({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const t = useTheme();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);

  const embedUrl = `${WEB_APP_URL}/embed/wiki/${pageId}?title=${encodeURIComponent(pageTitle)}`;

  async function handleMessage(event: WebViewMessageEvent) {
    let payload: { type?: string } = {};
    try { payload = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (payload.type !== 'ready') return;

    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return;
    webviewRef.current?.postMessage(JSON.stringify({
      type: 'auth', access_token: session.access_token, refresh_token: session.refresh_token,
    }));
  }

  if (!WEB_APP_URL) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <ActivityIndicator color={t.danger} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webviewRef}
        source={{ uri: embedUrl }}
        onMessage={handleMessage}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState={false}
        style={{ flex: 1, backgroundColor: t.bg }}
      />
      {loading ? (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
          <ActivityIndicator color={t.accent} size="large" />
        </View>
      ) : null}
    </View>
  );
}
