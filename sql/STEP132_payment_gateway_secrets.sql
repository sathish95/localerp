-- ============================================================
-- STEP132: In-app payment gateway secrets (Razorpay/Stripe/Cashfree API
-- keys + webhook secrets), replacing the `supabase secrets set` CLI step
-- with a super-admin UI — same write-only posture this app already uses
-- for the Turnstile secret (STEP75's sales_public_form_secrets): a
-- value can be WRITTEN via a SECURITY DEFINER RPC that checks
-- is_platform_super_admin(), but there is NO SELECT policy on the table
-- at all, so the actual secret is never readable through any query
-- path — not even by a super admin's own client. The Edge Functions
-- read it through their service-role client, which bypasses RLS
-- entirely, same as they already read from Deno.env.
--
-- Trade-off, stated plainly: this moves live payment credentials from
-- Edge Function environment config (never reachable via any DB query)
-- into a database table. A super admin can still WRITE new secrets in
-- if their session is compromised, and this widens the blast radius of
-- an RLS bug or SQL injection elsewhere in the schema versus the
-- CLI-only approach. Chosen deliberately anyway, per explicit request,
-- for the UI convenience.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_gateway_secrets (
  provider   TEXT NOT NULL,
  key_name   TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES profiles(id),
  PRIMARY KEY (provider, key_name)
);

ALTER TABLE payment_gateway_secrets ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies at all on this table — RLS enabled with zero
-- policies means PostgREST can never satisfy any query against it for
-- any role. All access goes through the two SECURITY DEFINER functions
-- below, which run as the function owner and therefore bypass RLS.
REVOKE ALL ON public.payment_gateway_secrets FROM authenticated, anon;

-- ── set_payment_gateway_secret() — the only writer. Empty/null value
-- deletes the row (so "clearing" a field actually removes the secret
-- rather than storing an empty string). ──
CREATE OR REPLACE FUNCTION set_payment_gateway_secret(p_provider TEXT, p_key_name TEXT, p_value TEXT)
RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_value IS NULL OR trim(p_value) = '' THEN
    DELETE FROM payment_gateway_secrets WHERE provider = p_provider AND key_name = p_key_name;
  ELSE
    INSERT INTO payment_gateway_secrets (provider, key_name, value, updated_by, updated_at)
    VALUES (p_provider, p_key_name, p_value, auth.uid(), now())
    ON CONFLICT (provider, key_name) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION set_payment_gateway_secret(TEXT, TEXT, TEXT) TO authenticated;

-- ── payment_gateway_secret_status() — tells the UI WHICH keys are set
-- and when, never the value itself. This is the only read path, and it
-- never returns `value`. ──
CREATE OR REPLACE FUNCTION payment_gateway_secret_status()
RETURNS TABLE (provider TEXT, key_name TEXT, updated_at TIMESTAMPTZ) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY SELECT s.provider, s.key_name, s.updated_at FROM payment_gateway_secrets s;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION payment_gateway_secret_status() TO authenticated;

NOTIFY pgrst, 'reload schema';
