-- ============================================================
-- STEP154: Support Desk — SLA policies, agents, assignment rules
-- (Phase 1 continued). All three tables are platform-config only
-- (is_platform_super_admin() gated) — an org never sees these tables
-- directly, only their computed effect (first_response_due_at /
-- resolution_due_at stamped onto their own tickets in STEP155).
--
-- support_agents is a NEW concept this migration introduces: "platform
-- staff who work tickets" is not the same set as "every is_super_admin
-- account" (confirmed via audit — today there's exactly one platform
-- flag, no agent/full-admin distinction). A super-admin explicitly
-- opts specific platform accounts into the agent pool; assignment logic
-- in STEP155 only ever picks from support_agents, never a raw
-- is_super_admin query, so it stays correct even if some super-admins
-- never touch tickets.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_sla_policies (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  priority               TEXT        NOT NULL UNIQUE CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  first_response_minutes INT         NOT NULL,
  resolution_minutes     INT         NOT NULL,
  is_active              BOOLEAN     NOT NULL DEFAULT true,
  updated_at             TIMESTAMPTZ DEFAULT now(),
  updated_by             UUID        REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS support_agents (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id  UUID        NOT NULL UNIQUE REFERENCES profiles(id),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- category/priority are nullable = "applies to any" — the most specific
-- matching active rule wins (STEP155 orders by specificity). rule_type
-- 'least_loaded' is this migration's actual algorithm for what a real
-- helpdesk usually calls "round robin" — it picks whichever active
-- agent currently has the fewest open/in_progress tickets rather than
-- rotating a pointer, which balances load without needing extra state
-- to track "whose turn is next." Named for what it does, not what it's
-- commonly called, so a future reader isn't surprised by the behavior.
CREATE TABLE IF NOT EXISTS support_assignment_rules (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  category           TEXT        CHECK (category IN ('billing', 'technical', 'feature_request', 'account', 'onboarding', 'general')),
  priority           TEXT        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  rule_type          TEXT        NOT NULL DEFAULT 'least_loaded' CHECK (rule_type IN ('least_loaded', 'manual_default')),
  assigned_agent_id  UUID        REFERENCES profiles(id), -- used when rule_type = 'manual_default'
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  sort_order         INT         NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE support_sla_policies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_agents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_assignment_rules  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_sla_policies_all ON support_sla_policies;
CREATE POLICY support_sla_policies_all ON support_sla_policies FOR ALL USING (is_platform_super_admin()) WITH CHECK (is_platform_super_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_sla_policies TO authenticated;

DROP POLICY IF EXISTS support_agents_all ON support_agents;
CREATE POLICY support_agents_all ON support_agents FOR ALL USING (is_platform_super_admin()) WITH CHECK (is_platform_super_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_agents TO authenticated;

DROP POLICY IF EXISTS support_assignment_rules_all ON support_assignment_rules;
CREATE POLICY support_assignment_rules_all ON support_assignment_rules FOR ALL USING (is_platform_super_admin()) WITH CHECK (is_platform_super_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_assignment_rules TO authenticated;

-- Sensible starting defaults — a platform admin can edit every value
-- from Support Desk Settings afterward. Skipped if already seeded
-- (idempotent re-run).
INSERT INTO support_sla_policies (priority, first_response_minutes, resolution_minutes) VALUES
  ('urgent', 30,   240),
  ('high',   120,  1440),
  ('medium', 480,  4320),
  ('low',    1440, 10080)
ON CONFLICT (priority) DO NOTHING;

NOTIFY pgrst, 'reload schema';
