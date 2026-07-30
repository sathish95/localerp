import { Navigate } from 'react-router-dom'
import { useTabVisibility } from '../context/TabVisibilityContext'

// Route-level enforcement that TabVisibilityContext's isTabVisible() used
// to lack entirely — previously a hidden tab only disappeared from the
// sidebar, but typing its URL directly still worked. Wraps a route's
// element alongside its existing role check: `allowed` is the same
// role-boolean App.jsx already computes per route (isManager, isFinance,
// etc.); `tab` is the module key checked against both the company-wide
// enabled switch and per-role visibility.
export default function ModuleGate({ tab, allowed, children }) {
  const { isTabVisible, loading } = useTabVisibility()
  if (loading) return null
  if (!allowed || !isTabVisible(tab)) return <Navigate to="/" />
  return children
}
