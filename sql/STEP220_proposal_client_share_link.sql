-- ============================================================
-- STEP220: Share a proposal with the client via a tokenized public link
-- (same durable-secret-link + SECURITY DEFINER RPC pattern as STEP75's
-- public lead capture and STEP213's roi_customer_portal_link — no client
-- login system). The client can only ever tweak QUANTITIES and TIMELINE
-- on the shared page (resource headcount/duration, hardware qty, software
-- license qty, phase start/duration) — unit rates, margins and internal
-- cost are never sent to the public RPC at all, only the already-marked-up
-- customer amount, so there is nothing for the client to see or reverse
-- that isn't already on a customer-facing PDF/Excel export.
--
-- Client edits never touch the live proposal directly. They land in
-- proposal_change_requests as a pending row; someone with proposal-write
-- access reviews and approves (which replays the change through the same
-- updateResourcePlan/updateHardwareLine/updateSoftwareLine/updateTimelinePhase
-- functions proposals.js already uses, then recomputes the value summary)
-- or rejects it. This mirrors the approval-gated pattern used everywhere
-- else in this app rather than letting an external party mutate pricing
-- data unsupervised.
--
-- This module (proposals/proposal_* tables, STEP62) predates the
-- multi-tenant organization_id retrofit and has no org scoping of its own
-- (RLS is auth.uid() IS NOT NULL for SELECT) — these two new tables match
-- that existing convention rather than introducing a half-scoped table.
-- ============================================================

CREATE TABLE IF NOT EXISTS proposal_share_links (
  id            UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id   UUID          NOT NULL,   -- soft ref -> proposals
  -- Two concatenated UUIDs, same non-pgcrypto-dependent token scheme
  -- STEP213's roi_customer_portal_link uses.
  token         TEXT          NOT NULL UNIQUE DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_by    UUID          REFERENCES profiles(id),
  created_at    TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_share_links_proposal_idx ON proposal_share_links(proposal_id);

CREATE TABLE IF NOT EXISTS proposal_change_requests (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id     UUID          NOT NULL,   -- soft ref -> proposals
  share_link_id   UUID          NOT NULL,   -- soft ref -> proposal_share_links
  client_name     TEXT,
  client_note     TEXT,
  -- Array of {id, type: resource|hardware|software|timeline, ...changed fields}
  -- — see get_proposal_public()'s per-line shape below for what a client
  -- can address by id.
  changes         JSONB         NOT NULL,
  status          TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by     UUID          REFERENCES profiles(id),
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  created_at      TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_change_requests_proposal_idx ON proposal_change_requests(proposal_id);
CREATE INDEX IF NOT EXISTS proposal_change_requests_status_idx   ON proposal_change_requests(status);

ALTER TABLE proposal_share_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_change_requests ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['proposal_share_links', 'proposal_change_requests'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_lead'',''finance'',''cto''))
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_lead'',''finance'',''cto''))
       )', t, t
    );
  END LOOP;
END $$;

-- ── Public, tokenized read RPC — anon gets EXECUTE only, no direct table
-- grants at all (same as get_landing_link_public / get_roi_customer_view_public).
-- Every number returned is already the customer-facing (marked-up) amount;
-- margin_percent and internal cost are never selected into this function
-- at all, so there is no value to leak even by inspecting the response. ──
CREATE OR REPLACE FUNCTION get_proposal_public(p_token TEXT)
RETURNS JSONB AS $$
DECLARE v_link RECORD; v_proposal RECORD; v_result JSONB;
BEGIN
  SELECT * INTO v_link FROM proposal_share_links
    WHERE token = p_token AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());
  IF v_link IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_proposal FROM proposals WHERE id = v_link.proposal_id;
  IF v_proposal IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'proposal', jsonb_build_object(
      'proposal_number', v_proposal.proposal_number, 'proposal_name', v_proposal.proposal_name,
      'customer_name', v_proposal.customer_name, 'currency', v_proposal.currency,
      'validity_until_date', v_proposal.validity_until_date, 'status', v_proposal.status
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY category, line_type, name)
      FROM (
        SELECT cs.category AS category, 'resource' AS line_type, rp.designation AS name,
          jsonb_build_object(
            'id', rp.id, 'category', cs.category, 'type', 'resource', 'name', rp.designation,
            'qty', rp.estimated_count, 'duration_weeks', rp.estimated_duration_weeks,
            'unit_rate', CASE WHEN rp.estimated_count > 0 AND rp.estimated_duration_weeks > 0
                          THEN round(rp.computed_cost * (1 + COALESCE(cs.margin_percent, v_proposal.overall_margin_percent) / 100) / (rp.estimated_count * rp.estimated_duration_weeks), 2)
                          ELSE 0 END,
            'amount', round(rp.computed_cost * (1 + COALESCE(cs.margin_percent, v_proposal.overall_margin_percent) / 100), 2)
          ) AS row_json
        FROM proposal_resource_plans rp
        JOIN proposal_cost_sections cs ON cs.id = rp.proposal_cost_section_id
        WHERE cs.proposal_id = v_proposal.id

        UNION ALL

        SELECT cs.category, 'hardware', h.description,
          jsonb_build_object(
            'id', h.id, 'category', cs.category, 'type', 'hardware', 'name', h.description,
            'qty', h.estimated_quantity,
            'unit_rate', CASE WHEN h.estimated_quantity > 0
                          THEN round(h.subtotal_internal_cost * (1 + COALESCE(cs.margin_percent, v_proposal.overall_margin_percent) / 100) / h.estimated_quantity, 2)
                          ELSE 0 END,
            'amount', round(h.subtotal_internal_cost * (1 + COALESCE(cs.margin_percent, v_proposal.overall_margin_percent) / 100), 2)
          )
        FROM proposal_hardware_lines h
        JOIN proposal_cost_sections cs ON cs.id = h.proposal_cost_section_id
        WHERE cs.proposal_id = v_proposal.id

        UNION ALL

        SELECT cs.category, 'software', s.item_name,
          jsonb_build_object(
            'id', s.id, 'category', cs.category, 'type', 'software', 'name', s.item_name,
            'qty', s.qty,
            'unit_rate', CASE WHEN s.qty > 0
                          THEN round(s.computed_cost * (1 + COALESCE(cs.margin_percent, v_proposal.overall_margin_percent) / 100) / s.qty, 2)
                          ELSE 0 END,
            'amount', round(s.computed_cost * (1 + COALESCE(cs.margin_percent, v_proposal.overall_margin_percent) / 100), 2)
          )
        FROM proposal_software_lines s
        JOIN proposal_cost_sections cs ON cs.id = s.proposal_cost_section_id
        WHERE cs.proposal_id = v_proposal.id

        UNION ALL

        SELECT cs.category, 'misc', m.item_name,
          jsonb_build_object(
            'id', m.id, 'category', cs.category, 'type', 'misc', 'name', m.item_name,
            'amount', round(m.cost * (1 + COALESCE(cs.margin_percent, v_proposal.overall_margin_percent) / 100), 2)
          )
        FROM proposal_misc_lines m
        JOIN proposal_cost_sections cs ON cs.id = m.proposal_cost_section_id
        WHERE cs.proposal_id = v_proposal.id
      ) sub
    ), '[]'::jsonb),
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'phase_name', t.phase_name, 'start_offset_weeks', t.start_offset_weeks, 'duration_weeks', t.duration_weeks) ORDER BY t.sort_order, t.start_offset_weeks)
      FROM proposal_timeline t WHERE t.proposal_id = v_proposal.id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_proposal_public(TEXT) TO anon, authenticated;

-- Client submits proposed quantity/timeline changes — always lands as a
-- pending review row, never applied here. Notifies the proposal's creator
-- plus admin/ceo (same "who gets pinged" shape as STEP75's coverage alert).
CREATE OR REPLACE FUNCTION submit_proposal_change_request(
  p_token TEXT, p_client_name TEXT, p_client_note TEXT, p_changes JSONB
) RETURNS UUID AS $$
DECLARE
  v_link RECORD; v_proposal RECORD; v_request_id UUID; v_recipients UUID[];
BEGIN
  SELECT * INTO v_link FROM proposal_share_links
    WHERE token = p_token AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());
  IF v_link IS NULL THEN RAISE EXCEPTION 'This link is no longer available'; END IF;

  SELECT * INTO v_proposal FROM proposals WHERE id = v_link.proposal_id;
  IF v_proposal IS NULL THEN RAISE EXCEPTION 'Proposal not found'; END IF;

  IF p_changes IS NULL OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'No changes submitted';
  END IF;

  INSERT INTO proposal_change_requests (proposal_id, share_link_id, client_name, client_note, changes, status)
  VALUES (v_proposal.id, v_link.id, NULLIF(trim(p_client_name), ''), NULLIF(trim(p_client_note), ''), p_changes, 'pending')
  RETURNING id INTO v_request_id;

  SELECT array_agg(DISTINCT rid) INTO v_recipients FROM (
    SELECT v_proposal.created_by AS rid WHERE v_proposal.created_by IS NOT NULL
    UNION
    SELECT id FROM profiles WHERE role IN ('admin', 'ceo')
  ) sub;

  IF v_recipients IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, type, title, body, link, metadata)
    SELECT rid, 'proposal_change_request',
      'Client requested changes — ' || COALESCE(v_proposal.proposal_number, v_proposal.proposal_name),
      COALESCE(NULLIF(trim(p_client_name), ''), 'A client') || ' proposed quantity/timeline changes via the shared proposal link — review before it affects the live proposal.',
      '/proposals?id=' || v_proposal.id, jsonb_build_object('proposal_id', v_proposal.id, 'request_id', v_request_id)
    FROM unnest(v_recipients) AS rid;
  END IF;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION submit_proposal_change_request(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
