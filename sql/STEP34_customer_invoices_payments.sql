-- ============================================================
-- STEP34: Customer Invoices (AR) + Payments (AP/AR ledger)
-- Run after STEP31.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS customer_invoices (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number  TEXT        NOT NULL UNIQUE,
  project_id      UUID        NOT NULL REFERENCES projects(id),
  milestone_id    UUID        REFERENCES project_milestones(id),
  customer_id     UUID        REFERENCES customers(id),
  invoice_date    DATE,
  due_date        DATE,
  subtotal        NUMERIC(14,2) DEFAULT 0,
  gst_amount      NUMERIC(14,2) DEFAULT 0,
  total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency        TEXT        DEFAULT 'INR',
  status          TEXT        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','partially_paid','paid','cancelled')),
  -- 'overdue' is deliberately NOT a stored status — it's derived client-side
  -- (due_date < today AND status NOT IN paid/cancelled); this app has no cron
  -- to keep a persisted flag in sync.
  notes           TEXT,
  document_url    TEXT,
  paid_at         TIMESTAMPTZ,
  created_by      UUID        REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_invoices_project_idx   ON customer_invoices(project_id);
CREATE INDEX IF NOT EXISTS customer_invoices_milestone_idx ON customer_invoices(milestone_id);
CREATE INDEX IF NOT EXISTS customer_invoices_status_idx    ON customer_invoices(status);
CREATE INDEX IF NOT EXISTS customer_invoices_due_idx       ON customer_invoices(due_date);
DROP TRIGGER IF EXISTS customer_invoices_updated_at ON customer_invoices;
CREATE TRIGGER customer_invoices_updated_at BEFORE UPDATE ON customer_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Soft-referenced polymorphic payment ledger — mirrors approval_logs' established
-- soft-FK convention.
CREATE TABLE IF NOT EXISTS payments (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_type     TEXT        NOT NULL CHECK (invoice_type IN ('vendor','customer')),
  invoice_id       UUID        NOT NULL,      -- soft ref: 'vendor' -> invoices.id, 'customer' -> customer_invoices.id
  amount           NUMERIC(14,2) NOT NULL,
  currency         TEXT        DEFAULT 'INR',
  payment_date     DATE        NOT NULL DEFAULT CURRENT_DATE,
  payment_method   TEXT,                       -- free text: bank_transfer / cheque / upi / cash / other
  reference_number TEXT,                       -- UTR / cheque no.
  notes            TEXT,
  recorded_by      UUID        REFERENCES profiles(id),
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_type, invoice_id);
CREATE INDEX IF NOT EXISTS payments_date_idx    ON payments(payment_date);

ALTER TABLE customer_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_invoices_all ON customer_invoices FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY payments_all ON payments FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments          TO authenticated;

NOTIFY pgrst, 'reload schema';
