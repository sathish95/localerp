import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import PageEditor from '../components/wiki/PageEditor'

// Chrome-free host for the mobile app's WebView-embedded wiki editor —
// reuses PageEditor.jsx as-is (same Yjs/Supabase-Realtime collaboration
// engine as the web app), so mobile and web co-edit the same live doc.
//
// No session exists yet when the WebView first loads this URL. Handshake:
// this page posts {type:'ready'}, the native shell replies with
// {type:'auth', access_token, refresh_token}, we call
// supabase.auth.setSession() — AuthContext (unmodified) picks up the
// resulting session on its own via its existing onAuthStateChange/
// getSession() flow, and this component just re-renders once useAuth()
// resolves a profile.
export default function EmbedWikiPage() {
  const { pageId } = useParams()
  const [searchParams] = useSearchParams()
  const pageTitle = searchParams.get('title') || ''
  const { user, profile, loading } = useAuth()
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    function handleMessage(event) {
      let payload
      try { payload = JSON.parse(event.data) } catch { return }
      if (payload?.type !== 'auth') return
      supabase.auth.setSession({ access_token: payload.access_token, refresh_token: payload.refresh_token })
        .then(({ error }) => { if (error) setAuthError(error.message) })
    }
    // react-native-webview delivers messages on `window` (Android) — some
    // versions/iOS only fire on `document`, so listen on both.
    window.addEventListener('message', handleMessage)
    document.addEventListener('message', handleMessage)

    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'ready' }))

    return () => {
      window.removeEventListener('message', handleMessage)
      document.removeEventListener('message', handleMessage)
    }
  }, [])

  if (authError) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#dc2626' }}>
        Sign-in failed: {authError}
      </div>
    )
  }

  if (loading || !user || !profile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div style={{ padding: '10px 12px', minHeight: '100vh', boxSizing: 'border-box' }}>
      <PageEditor pageId={pageId} pageTitle={pageTitle} profile={profile} />
    </div>
  )
}
