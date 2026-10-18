-- ============================================================
-- STEP214: two follow-up requests on top of STEP212/STEP213 —
--
-- 1. Capture Rates: let users add their own custom category rows
--    alongside the 11 built-in ones (STEP212's roi_capture_rate.category
--    CHECK locked it to exactly those 11). The Scenario Calculation Engine
--    (src/lib/roiCalcEngine.js) only ever looks up those 11 specific keys
--    by name — a custom category a user adds here has no formula slot to
--    plug into, so it's tracked for reference/manual bookkeeping only.
--    The UI says this explicitly so nobody assumes a custom row silently
--    feeds the Scenario numbers.
--
-- 2. Investment Lines: add qty + unit_cost (amount becomes qty x unit_cost
--    when unit_cost is set — same "auto-calculated, editable" pattern as
--    v1's IoT-unit-cost x equipment-count Investment tab), and a `party`
--    column splitting every line into Client-Side Investment (party=
--    'client' — what the customer pays, manual only) vs Service-Provided
--    Investment (party='provider' — what the provider contributes/funds
--    as part of the deal; can be manually entered OR mapped in from the
--    project's actual cost records, same source tables STEP213's Delivery
--    Cost sync already reads). Customer ROI (roiResultEngine.calcRoiResult)
--    now only counts party='client' lines — a provider-funded line was
--    never the customer's own investment, and including it would overstate
--    what the customer put in.
-- ============================================================

-- ── 1. Capture Rates: drop the strict 11-value CHECK, keep a plain
-- non-blank guard. roi_capture_rate_defaults (the per-org seed template)
-- keeps its original CHECK — the 11 defaults are still exactly what's
-- seeded onto every new proposal; only per-proposal roi_capture_rate rows
-- can now go beyond that fixed list. ──
ALTER TABLE roi_capture_rate DROP CONSTRAINT IF EXISTS roi_capture_rate_category_check;
ALTER TABLE roi_capture_rate ADD CONSTRAINT roi_capture_rate_category_notblank CHECK (length(trim(category)) > 0);
-- Flags a row added via the "+ Add Custom Category" button (vs one of the
-- 11 seeded defaults) so the UI can label it "Custom — reference only"
-- without needing to hardcode the 11-name list a second time client-side.
ALTER TABLE roi_capture_rate ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Investment Lines: qty x unit_cost, and client vs provider split ──
ALTER TABLE roi_investment_line ADD COLUMN IF NOT EXISTS qty NUMERIC(12,2) NOT NULL DEFAULT 1;
ALTER TABLE roi_investment_line ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2);
ALTER TABLE roi_investment_line ADD COLUMN IF NOT EXISTS party TEXT NOT NULL DEFAULT 'client' CHECK (party IN ('client', 'provider'));
CREATE INDEX IF NOT EXISTS roi_investment_line_party_idx ON roi_investment_line(proposal_id, party);

-- ── Re-point the public Customer View at Client-Side Investment only —
-- it's what feeds customer_roi_pct/customer_payback_months (see
-- roiResultEngine.calcRoiResult's party filter above), so the investment
-- total this page shows must match the total behind the ROI% it shows.
-- Service-Provided Investment lines are an internal/commercial view, not
-- part of what the customer is told they invested. ──
CREATE OR REPLACE FUNCTION get_roi_customer_view_public(p_token TEXT)
RETURNS JSONB AS $$
DECLARE v_link RECORD; v_proposal RECORD; v_result JSONB;
BEGIN
  SELECT * INTO v_link FROM roi_customer_portal_link
    WHERE token = p_token AND is_active AND (expires_at IS NULL OR expires_at > now());
  IF v_link IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_proposal FROM roi_proposal WHERE id = v_link.proposal_id;
  IF v_proposal IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'proposal', jsonb_build_object(
      'name', v_proposal.name, 'currency', v_proposal.currency,
      'duration_months', v_proposal.duration_months, 'active_scenario', v_proposal.active_scenario,
      'status', v_proposal.status
    ),
    'investment_lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('timing', il.timing, 'category', il.category, 'name', il.name, 'qty', il.qty, 'amount', il.amount))
      FROM roi_investment_line il WHERE il.proposal_id = v_proposal.id AND il.party = 'client'
    ), '[]'::jsonb),
    'benefit_drivers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('category', bd.category, 'name', bd.name, 'potential_value', bd.potential_value, 'capture_rate_pct', bd.capture_rate_pct, 'realized_value', bd.realized_value))
      FROM roi_benefit_driver bd WHERE bd.proposal_id = v_proposal.id AND bd.scenario = v_proposal.active_scenario
    ), '[]'::jsonb),
    'results_by_scenario', COALESCE((
      SELECT jsonb_object_agg(sub.scenario, sub.row)
      FROM (
        SELECT DISTINCT ON (rs.scenario) rs.scenario,
          jsonb_build_object('customer_roi_pct', rs.customer_roi_pct, 'customer_payback_months', rs.customer_payback_months,
            'customer_investment', rs.customer_investment, 'customer_net_benefit', rs.customer_net_benefit, 'horizon', rs.horizon) AS row
        FROM roi_result_snapshot rs WHERE rs.proposal_id = v_proposal.id AND rs.horizon = 'annual'
        ORDER BY rs.scenario, rs.computed_at DESC
      ) sub
    ), '{}'::jsonb),
    'npv_irr', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scenario', n.scenario, 'horizon_years', n.horizon_years, 'discount_rate_pct', n.discount_rate_pct, 'npv', n.npv, 'irr_pct', n.irr_pct))
      FROM (SELECT DISTINCT ON (scenario) * FROM roi_npv_irr_result WHERE proposal_id = v_proposal.id ORDER BY scenario, computed_at DESC) n
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_roi_customer_view_public(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
