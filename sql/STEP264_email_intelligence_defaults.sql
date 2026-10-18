-- STEP264 — Email Intelligence default configuration (needs STEP263)
--
-- ei_seed_defaults(org) inserts the starting categories, document types,
-- keyword rules and settings as ORDINARY EDITABLE ROWS (ON CONFLICT DO
-- NOTHING — never overwrites an admin's edits) and publishes them as a
-- version when the org has none yet. Callable by admin/ceo/finance for their
-- own org (Settings → Email Intelligence → "Load defaults") or by the
-- service role for any org. Run at the end of this script for every org that
-- has an Outlook mailbox. Safe to re-run.

CREATE OR REPLACE FUNCTION ei_seed_defaults(p_org UUID DEFAULT NULL) RETURNS JSONB AS $$
DECLARE
  v_org UUID := COALESCE(p_org, current_org_id());
  v_cats INT; v_docs INT; v_rules INT; v_ver INT;
  inv_fields JSONB := '[
    {"key":"vendor_name","label":"Vendor legal name","type":"text"},
    {"key":"vendor_gstin","label":"Vendor GSTIN","type":"gstin","pattern":"\\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\\b"},
    {"key":"invoice_number","label":"Invoice number","type":"text","pattern":"\\b(?:invoice|inv|bill)\\b\\.?\\s*(?:no\\.?|number|num|#)\\s*[:\\-]?\\s*((?=[A-Z0-9/\\-]{3,31}\\b)[A-Z0-9/\\-]*[0-9][A-Z0-9/\\-]*)"},
    {"key":"invoice_date","label":"Invoice date","type":"date","pattern":"(?:invoice|inv|bill)\\s*date\\s*[:\\-]?\\s*([0-9]{1,2}[\\-/. ][A-Za-z0-9]{1,9}[\\-/. ][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})"},
    {"key":"due_date","label":"Due date","type":"date","pattern":"due\\s*date\\s*[:\\-]?\\s*([0-9]{1,2}[\\-/. ][A-Za-z0-9]{1,9}[\\-/. ][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})"},
    {"key":"po_number","label":"PO number","type":"text","pattern":"\\b(?:p\\.?\\s?o|purchase\\s*order)\\b\\.?\\s*(?:no\\.?|number|num|#|ref\\.?)?\\s*[:\\-]?\\s*((?=[A-Z0-9/\\-]{3,31}\\b)[A-Z0-9/\\-]*[0-9][A-Z0-9/\\-]*)"},
    {"key":"currency","label":"Currency","type":"text","pattern":"\\b(INR|USD|EUR|GBP|AED|SGD)\\b"},
    {"key":"taxable_amount","label":"Taxable amount","type":"money","pattern":"(?:taxable\\s*(?:value|amount)|sub\\s*-?\\s*total)\\s*[:\\-]?\\s*(?:rs\\.?|inr|₹)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)"},
    {"key":"tax_amount","label":"Tax amount","type":"money","pattern":"(?:total\\s*(?:gst|tax)|gst\\s*amount|tax\\s*amount|igst\\s*amount)\\s*[:\\-]?\\s*(?:rs\\.?|inr|₹)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)"},
    {"key":"total_amount","label":"Invoice total","type":"money","pattern":"(?:grand\\s*total|total\\s*amount|invoice\\s*total|amount\\s*payable|net\\s*payable|total\\s*payable)\\s*[:\\-]?\\s*(?:rs\\.?|inr|₹)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)"},
    {"key":"payment_terms","label":"Payment terms","type":"text","pattern":"payment\\s*terms?\\s*[:\\-]?\\s*([^\\n]{3,60})"},
    {"key":"project_reference","label":"Project reference","type":"text","pattern":"\\b(PRJ-[0-9]{3,})\\b"}
  ]'::jsonb;
  note_fields JSONB;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization'; END IF;
  IF auth.uid() IS NOT NULL AND (v_org <> current_org_id() OR NOT _ei_can_admin()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  note_fields := inv_fields || '[{"key":"original_invoice_number","label":"Original invoice number","type":"text","pattern":"\\b(?:against|ref(?:erence)?|original)\\s*(?:invoice|inv)\\b\\.?\\s*(?:no\\.?|number|#)?\\s*[:\\-]?\\s*((?=[A-Z0-9/\\-]{3,31}\\b)[A-Z0-9/\\-]*[0-9][A-Z0-9/\\-]*)"}]'::jsonb;
  PERFORM set_config('ei.seeding', 'on', true);

  -- ── email categories: code, name, group, priority, workflow, review, related doc types, required fields, order
  INSERT INTO ei_email_categories (organization_id, code, name, group_name, default_priority, workflow_key, requires_review, related_document_types, required_fields, sort_order, description, review_role)
  SELECT v_org, c.code, c.name, c.grp, c.prio, c.wf, c.rev, c.docs, c.req, c.ord, c.descr,
         CASE WHEN c.grp IN ('Accounts Payable','Payments','Vendor Management','Compliance') THEN 'finance' ELSE 'manager' END FROM (VALUES
    ('INVOICE_SUBMISSION','Invoice Submission','Accounts Payable','medium','AP_INVOICE',false,ARRAY['TAX_INVOICE','PROFORMA_INVOICE'],ARRAY['invoice_number','total_amount'],10,'Vendor sends an invoice for payment'),
    ('REVISED_INVOICE','Revised Invoice','Accounts Payable','medium','AP_INVOICE',true,ARRAY['REVISED_INVOICE'],ARRAY['invoice_number','total_amount'],11,'Corrected version of an earlier invoice'),
    ('CREDIT_NOTE','Credit Note','Accounts Payable','medium','AP_INVOICE',true,ARRAY['CREDIT_NOTE'],ARRAY['original_invoice_number'],12,NULL),
    ('DEBIT_NOTE','Debit Note','Accounts Payable','medium','AP_INVOICE',true,ARRAY['DEBIT_NOTE'],ARRAY['original_invoice_number'],13,NULL),
    ('PURCHASE_ORDER','Purchase Order','Procurement','medium','RECORD_ONLY',false,ARRAY['PURCHASE_ORDER'],'{}',20,NULL),
    ('PO_ACKNOWLEDGMENT','PO Acknowledgment','Procurement','low','RECORD_ONLY',false,ARRAY['PURCHASE_ORDER'],'{}',21,NULL),
    ('PURCHASE_REQUISITION','Purchase Requisition','Procurement','medium','REVIEW_QUEUE',false,ARRAY['PURCHASE_REQUISITION'],'{}',22,NULL),
    ('QUOTATION','Quotation','Procurement','medium','REVIEW_QUEUE',false,ARRAY['QUOTATION'],'{}',23,NULL),
    ('PRICE_NEGOTIATION','Price Negotiation','Procurement','medium','REVIEW_QUEUE',false,'{}','{}',24,NULL),
    ('DELIVERY_NOTIFICATION','Delivery Notification','Goods Receipt','medium','RECORD_ONLY',false,ARRAY['DELIVERY_CHALLAN','PACKING_LIST'],'{}',30,NULL),
    ('DELIVERY_CHALLAN','Delivery Challan','Goods Receipt','medium','REVIEW_QUEUE',false,ARRAY['DELIVERY_CHALLAN'],'{}',31,NULL),
    ('GOODS_RECEIPT','GRN / Goods Receipt','Goods Receipt','medium','REVIEW_QUEUE',false,ARRAY['GOODS_RECEIPT_NOTE','PROOF_OF_DELIVERY'],'{}',32,NULL),
    ('MATERIAL_SHORTAGE','Material Shortage','Goods Receipt','high','REVIEW_QUEUE',false,'{}','{}',33,NULL),
    ('DAMAGED_GOODS','Damaged Goods','Goods Receipt','high','REVIEW_QUEUE',false,ARRAY['SUPPORTING_PHOTOGRAPH'],'{}',34,NULL),
    ('PAYMENT_FOLLOW_UP','Payment Follow-up','Payments','medium','REVIEW_QUEUE',false,'{}','{}',40,'Vendor asks about payment status'),
    ('PAYMENT_CONFIRMATION','Payment Confirmation','Payments','low','RECORD_ONLY',false,ARRAY['PAYMENT_ADVICE'],'{}',41,NULL),
    ('REMITTANCE_ADVICE','Remittance Advice','Payments','medium','REVIEW_QUEUE',false,ARRAY['PAYMENT_ADVICE'],'{}',42,NULL),
    ('VENDOR_STATEMENT','Vendor Statement','Payments','medium','REVIEW_QUEUE',false,ARRAY['VENDOR_STATEMENT'],'{}',43,NULL),
    ('INVOICE_RECONCILIATION','Invoice Reconciliation','Payments','medium','REVIEW_QUEUE',false,ARRAY['VENDOR_STATEMENT'],'{}',44,NULL),
    ('VENDOR_ONBOARDING','Vendor Onboarding','Vendor Management','medium','REVIEW_QUEUE',true,ARRAY['VENDOR_REGISTRATION','TAX_CERTIFICATE'],'{}',50,NULL),
    ('VENDOR_MASTER_CHANGE','Vendor Master Change','Vendor Management','high','VENDOR_VERIFICATION',true,'{}','{}',51,'Never applied automatically'),
    ('BANK_DETAIL_CHANGE','Bank Detail Change','Vendor Management','critical','VENDOR_VERIFICATION',true,ARRAY['BANK_CONFIRMATION'],'{}',52,'Requires independent verification and approval — never applied from an email'),
    ('TAX_DOCUMENTS','Tax and GST Documents','Compliance','medium','REVIEW_QUEUE',false,ARRAY['TAX_CERTIFICATE'],'{}',53,NULL),
    ('COMPLIANCE_DOCUMENTS','Compliance Documents','Compliance','medium','REVIEW_QUEUE',false,ARRAY['COMPLIANCE_CERTIFICATE','INSURANCE_CERTIFICATE'],'{}',54,NULL),
    ('CONTRACT','Contract or Agreement','Contracts','medium','REVIEW_QUEUE',true,ARRAY['CONTRACT','PURCHASE_AGREEMENT'],'{}',60,NULL),
    ('CONTRACT_RENEWAL','Contract Renewal','Contracts','medium','REVIEW_QUEUE',false,ARRAY['CONTRACT'],'{}',61,NULL),
    ('PROJECT_EXPENSE','Project Expense','Projects','medium','REVIEW_QUEUE',false,ARRAY['PROJECT_EXPENSE_EVIDENCE'],'{}',70,NULL),
    ('WORK_COMPLETION','Work Completion Certificate','Projects','medium','REVIEW_QUEUE',false,ARRAY['COMPLETION_CERTIFICATE','MEASUREMENT_SHEET'],'{}',71,NULL),
    ('SERVICE_CONFIRMATION','Service Confirmation','Projects','medium','REVIEW_QUEUE',false,ARRAY['SERVICE_REPORT'],'{}',72,NULL),
    ('MAINTENANCE_REQUEST','Maintenance Request','Service','high','REVIEW_QUEUE',false,ARRAY['MAINTENANCE_REPORT'],'{}',80,NULL),
    ('WARRANTY_CLAIM','Warranty Claim','Service','medium','REVIEW_QUEUE',false,ARRAY['WARRANTY_DOCUMENT'],'{}',81,NULL),
    ('INVOICE_DISPUTE','Invoice Dispute','Accounts Payable','high','REVIEW_QUEUE',false,'{}','{}',14,NULL),
    ('MISSING_DOCUMENT_REQUEST','Missing Document Request','Communication','medium','REVIEW_QUEUE',false,'{}','{}',90,NULL),
    ('VENDOR_QUERY','Vendor Query','Communication','medium','REVIEW_QUEUE',false,'{}','{}',91,NULL),
    ('DELIVERY_DELAY','Delivery Delay','Communication','high','REVIEW_QUEUE',false,'{}','{}',92,NULL),
    ('URGENT_ESCALATION','Urgent Escalation','Communication','critical','REVIEW_QUEUE',false,'{}','{}',93,NULL),
    ('GENERAL_COMMUNICATION','General Business Communication','Communication','low','RECORD_ONLY',false,'{}','{}',98,NULL),
    ('OTHER','Other / Unclassified','Communication','low','PROJECT_ISSUE_TASK',false,'{}','{}',99,'Not matched by any rule: the customer project-issue detector (STEP261) decides')
  ) AS c(code, name, grp, prio, wf, rev, docs, req, ord, descr)
  ON CONFLICT (organization_id, code) DO NOTHING;
  GET DIAGNOSTICS v_cats = ROW_COUNT;

  -- ── document types: code, name, destination, review, fields, required, duplicate keys, order
  INSERT INTO ei_document_types (organization_id, code, name, destination, requires_review, fields, required_fields, duplicate_keys, sort_order, formats)
  SELECT v_org, d.code, d.name, d.dest, d.rev, d.flds, d.req, d.dup, d.ord, d.fmt FROM (VALUES
    ('TAX_INVOICE','Tax Invoice','INVOICE_REGISTER',false,inv_fields,ARRAY['invoice_number','invoice_date','total_amount'],ARRAY['vendor_id','invoice_number'],10,ARRAY['pdf','jpg','jpeg','png','xml']),
    ('PROFORMA_INVOICE','Proforma Invoice','REVIEW_QUEUE',false,inv_fields,'{}'::text[],'{}'::text[],11,ARRAY['pdf','jpg','jpeg','png']),
    ('REVISED_INVOICE','Revised Invoice','INVOICE_REGISTER',true,note_fields,ARRAY['invoice_number','total_amount'],ARRAY['vendor_id','invoice_number'],12,ARRAY['pdf','jpg','jpeg','png']),
    ('CREDIT_NOTE','Credit Note','CREDIT_NOTE_REVIEW',true,note_fields,ARRAY['total_amount'],ARRAY['vendor_id','invoice_number'],13,ARRAY['pdf','jpg','jpeg','png']),
    ('DEBIT_NOTE','Debit Note','CREDIT_NOTE_REVIEW',true,note_fields,ARRAY['total_amount'],ARRAY['vendor_id','invoice_number'],14,ARRAY['pdf','jpg','jpeg','png']),
    ('PURCHASE_ORDER','Purchase Order','NONE',false,'[]'::jsonb,'{}','{}',20,ARRAY['pdf']),
    ('PURCHASE_REQUISITION','Purchase Requisition','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',21,ARRAY['pdf','xlsx','xls']),
    ('QUOTATION','Quotation','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',22,ARRAY['pdf','xlsx','xls','docx']),
    ('GOODS_RECEIPT_NOTE','Goods Receipt Note','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',30,ARRAY['pdf','jpg','jpeg','png']),
    ('DELIVERY_CHALLAN','Delivery Challan','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',31,ARRAY['pdf','jpg','jpeg','png']),
    ('PACKING_LIST','Packing List','NONE',false,'[]'::jsonb,'{}','{}',32,ARRAY['pdf','xlsx','xls']),
    ('PROOF_OF_DELIVERY','Proof of Delivery','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',33,ARRAY['pdf','jpg','jpeg','png']),
    ('PAYMENT_ADVICE','Payment Advice','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',40,ARRAY['pdf','xlsx','csv']),
    ('VENDOR_STATEMENT','Vendor Statement','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',41,ARRAY['pdf','xlsx','xls','csv']),
    ('BANK_CONFIRMATION','Bank Confirmation','REVIEW_QUEUE',true,'[]'::jsonb,'{}','{}',42,ARRAY['pdf','jpg','jpeg','png']),
    ('TAX_CERTIFICATE','Tax Certificate','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',50,ARRAY['pdf','jpg','jpeg','png']),
    ('VENDOR_REGISTRATION','Vendor Registration','REVIEW_QUEUE',true,'[]'::jsonb,'{}','{}',51,ARRAY['pdf','xlsx','docx']),
    ('CONTRACT','Contract','REVIEW_QUEUE',true,'[]'::jsonb,'{}','{}',60,ARRAY['pdf','docx']),
    ('PURCHASE_AGREEMENT','Purchase Agreement','REVIEW_QUEUE',true,'[]'::jsonb,'{}','{}',61,ARRAY['pdf','docx']),
    ('WORK_ORDER','Work Order','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',62,ARRAY['pdf']),
    ('COMPLETION_CERTIFICATE','Completion Certificate','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',70,ARRAY['pdf','jpg','jpeg','png']),
    ('MEASUREMENT_SHEET','Measurement Sheet','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',71,ARRAY['pdf','xlsx','xls']),
    ('PROJECT_EXPENSE_EVIDENCE','Project Expense Evidence','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',72,ARRAY['pdf','jpg','jpeg','png']),
    ('SERVICE_REPORT','Service Report','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',80,ARRAY['pdf','docx']),
    ('MAINTENANCE_REPORT','Maintenance Report','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',81,ARRAY['pdf','docx']),
    ('WARRANTY_DOCUMENT','Warranty Document','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',82,ARRAY['pdf']),
    ('INSURANCE_CERTIFICATE','Insurance Certificate','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',83,ARRAY['pdf']),
    ('COMPLIANCE_CERTIFICATE','Compliance Certificate','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',84,ARRAY['pdf']),
    ('SPREADSHEET','Spreadsheet','NONE',false,'[]'::jsonb,'{}','{}',90,ARRAY['xlsx','xls','csv']),
    ('SUPPORTING_PHOTOGRAPH','Supporting Photograph','NONE',false,'[]'::jsonb,'{}','{}',91,ARRAY['jpg','jpeg','png']),
    ('GENERAL_ATTACHMENT','General Attachment','NONE',false,'[]'::jsonb,'{}','{}',98,ARRAY['pdf','docx','doc','xlsx','xls','csv','txt']),
    ('UNKNOWN_DOCUMENT','Unknown Document','REVIEW_QUEUE',false,'[]'::jsonb,'{}','{}',99,'{}')
  ) AS d(code, name, dest, rev, flds, req, dup, ord, fmt)
  ON CONFLICT (organization_id, code) DO NOTHING;
  GET DIAGNOSTICS v_docs = ROW_COUNT;

  -- ── keyword rules (only when the org has none, so admin deletions stay deleted)
  v_rules := 0;
  IF NOT EXISTS (SELECT 1 FROM ei_keyword_rules WHERE organization_id = v_org) THEN
    INSERT INTO ei_keyword_rules (organization_id, name, terms, combine, locations, match_mode, category_code, document_type_code, weight, is_exclusion, proposed_action)
    SELECT v_org, r.nm, r.terms, r.comb, r.locs, r.mode, r.cat, r.doc, r.w, r.excl, r.act FROM (VALUES
      -- email intents (the 16 defaults from the brief + a few supporting rules)
      ('Tax invoice', ARRAY['tax invoice'], 'ANY', ARRAY['SUBJECT','BODY','ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', 'INVOICE_SUBMISSION', 'TAX_INVOICE', 80, false, 'Classify and extract invoice'),
      ('Invoice attached', ARRAY['invoice attached','please find the invoice','attached invoice','invoice for'], 'ANY', ARRAY['SUBJECT','BODY'], 'PHRASE', 'INVOICE_SUBMISSION', NULL, 65, false, 'Inspect attachments'),
      ('Revised invoice', ARRAY['revised invoice','corrected invoice','amended invoice'], 'ANY', ARRAY['SUBJECT','BODY','ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', 'REVISED_INVOICE', 'REVISED_INVOICE', 80, false, 'Identify previous invoice version'),
      ('Purchase order', ARRAY['purchase order'], 'ANY', ARRAY['SUBJECT','ATTACHMENT_NAME'], 'PHRASE', 'PURCHASE_ORDER', 'PURCHASE_ORDER', 40, false, 'Identify PO document'),
      ('PO confirmation', ARRAY['po confirmation','order confirmation','po acknowledgement','po acknowledgment'], 'ANY', ARRAY['SUBJECT','BODY'], 'PHRASE', 'PO_ACKNOWLEDGMENT', NULL, 60, false, 'Update communication history'),
      ('Delivery challan', ARRAY['delivery challan','dc no'], 'ANY', ARRAY['SUBJECT','BODY','ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', 'DELIVERY_CHALLAN', 'DELIVERY_CHALLAN', 60, false, 'Identify delivery workflow'),
      ('Goods received', ARRAY['goods received','goods receipt','grn'], 'ANY', ARRAY['SUBJECT','BODY','ATTACHMENT_NAME'], 'WORD', 'GOODS_RECEIPT', 'GOODS_RECEIPT_NOTE', 50, false, 'Check receipt records'),
      ('Payment status', ARRAY['payment status','status of payment','when will we receive payment','pending payment'], 'ANY', ARRAY['SUBJECT','BODY'], 'PHRASE', 'PAYMENT_FOLLOW_UP', NULL, 60, false, 'Retrieve authorized payment status'),
      ('Payment advice', ARRAY['payment advice','remittance advice','remittance'], 'ANY', ARRAY['SUBJECT','BODY','ATTACHMENT_NAME'], 'WORD', 'REMITTANCE_ADVICE', 'PAYMENT_ADVICE', 60, false, 'Start payment reconciliation'),
      ('Credit note', ARRAY['credit note'], 'ANY', ARRAY['SUBJECT','BODY','ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', 'CREDIT_NOTE', 'CREDIT_NOTE', 80, false, 'Link to the referenced invoice'),
      ('Debit note', ARRAY['debit note'], 'ANY', ARRAY['SUBJECT','BODY','ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', 'DEBIT_NOTE', 'DEBIT_NOTE', 80, false, 'Link to the referenced invoice'),
      ('Vendor registration', ARRAY['vendor registration','supplier registration','vendor onboarding','vendor form'], 'ANY', ARRAY['SUBJECT','BODY','ATTACHMENT_NAME'], 'PHRASE', 'VENDOR_ONBOARDING', 'VENDOR_REGISTRATION', 60, false, 'Start onboarding workflow'),
      ('Bank account change', ARRAY['bank account change','change of bank','new bank account','change in bank details','updated bank details'], 'ANY', ARRAY['SUBJECT','BODY'], 'PHRASE', 'BANK_DETAIL_CHANGE', NULL, 95, false, 'Mandatory verification'),
      ('Material shortage', ARRAY['material shortage','short supply','short received','quantity short'], 'ANY', ARRAY['SUBJECT','BODY'], 'PHRASE', 'MATERIAL_SHORTAGE', NULL, 70, false, 'Create discrepancy task'),
      ('Contract expiry', ARRAY['contract expiry','contract renewal','agreement renewal','contract expires'], 'ANY', ARRAY['SUBJECT','BODY'], 'PHRASE', 'CONTRACT_RENEWAL', NULL, 60, false, 'Create reminder'),
      ('Urgent payment', ARRAY['urgent payment','payment overdue','overdue payment'], 'ANY', ARRAY['SUBJECT','BODY'], 'PHRASE', 'PAYMENT_FOLLOW_UP', NULL, 70, false, 'Check priority and payment status'),
      ('Missing PO', ARRAY['missing po','po not received','without po','no po number'], 'ANY', ARRAY['SUBJECT','BODY'], 'PHRASE', 'MISSING_DOCUMENT_REQUEST', NULL, 60, false, 'Create clarification task'),
      ('Damaged goods', ARRAY['damaged','broken on arrival','damaged goods','damaged material'], 'ANY', ARRAY['SUBJECT','BODY'], 'WORD', 'DAMAGED_GOODS', NULL, 60, false, 'Create discrepancy task'),
      ('Delivery delay', ARRAY['delivery delayed','delay in delivery','dispatch delayed','shipment delayed'], 'ANY', ARRAY['SUBJECT','BODY'], 'PHRASE', 'DELIVERY_DELAY', NULL, 60, false, 'Notify procurement'),
      ('Quotation', ARRAY['quotation','quote for','price quote'], 'ANY', ARRAY['SUBJECT','ATTACHMENT_NAME'], 'WORD', 'QUOTATION', 'QUOTATION', 50, false, 'Route to procurement'),
      ('Vendor statement', ARRAY['statement of account','account statement','vendor statement','ledger statement'], 'ANY', ARRAY['SUBJECT','BODY','ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', 'VENDOR_STATEMENT', 'VENDOR_STATEMENT', 60, false, 'Start reconciliation'),
      ('Work completion', ARRAY['completion certificate','work completed','work completion'], 'ANY', ARRAY['SUBJECT','BODY','ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', 'WORK_COMPLETION', 'COMPLETION_CERTIFICATE', 60, false, 'Route to project team'),
      ('Warranty claim', ARRAY['warranty claim','under warranty','warranty replacement'], 'ANY', ARRAY['SUBJECT','BODY'], 'PHRASE', 'WARRANTY_CLAIM', NULL, 60, false, 'Route to service'),
      ('Invoice dispute', ARRAY['dispute','disputed invoice','incorrect invoice','wrong invoice'], 'ANY', ARRAY['SUBJECT','BODY'], 'WORD', 'INVOICE_DISPUTE', NULL, 65, false, 'Route to accounts payable'),
      ('Newsletter / marketing (exclude invoice)', ARRAY['unsubscribe','newsletter','webinar'], 'ANY', ARRAY['BODY','SUBJECT'], 'WORD', 'INVOICE_SUBMISSION', NULL, 90, true, 'Not an invoice'),
      -- document types (attachments)
      ('Doc: tax invoice text', ARRAY['gstin','invoice no'], 'ALL', ARRAY['ATTACHMENT_TEXT'], 'PHRASE', NULL, 'TAX_INVOICE', 65, false, NULL),
      ('Doc: invoice in file name', ARRAY['invoice','inv_','inv-','bill'], 'ANY', ARRAY['ATTACHMENT_NAME'], 'PARTIAL', NULL, 'TAX_INVOICE', 45, false, NULL),
      ('Doc: proforma', ARRAY['proforma','pro forma','pro-forma'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', NULL, 'PROFORMA_INVOICE', 85, false, NULL),
      ('Doc: purchase order', ARRAY['purchase order'], 'ANY', ARRAY['ATTACHMENT_TEXT'], 'PHRASE', NULL, 'PURCHASE_ORDER', 40, false, NULL),
      ('Doc: packing list', ARRAY['packing list','packing slip'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', NULL, 'PACKING_LIST', 60, false, NULL),
      ('Doc: proof of delivery', ARRAY['proof of delivery','pod'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'WORD', NULL, 'PROOF_OF_DELIVERY', 55, false, NULL),
      ('Doc: tax certificate', ARRAY['gst registration certificate','form 16a','tds certificate','pan card'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', NULL, 'TAX_CERTIFICATE', 60, false, NULL),
      ('Doc: bank confirmation', ARRAY['cancelled cheque','bank confirmation','bank letter'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', NULL, 'BANK_CONFIRMATION', 70, false, NULL),
      ('Doc: contract', ARRAY['agreement','contract'], 'ANY', ARRAY['ATTACHMENT_NAME'], 'WORD', NULL, 'CONTRACT', 45, false, NULL),
      ('Doc: work order', ARRAY['work order'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', NULL, 'WORK_ORDER', 55, false, NULL),
      ('Doc: measurement sheet', ARRAY['measurement sheet','measurement book'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', NULL, 'MEASUREMENT_SHEET', 60, false, NULL),
      ('Doc: service report', ARRAY['service report','field service report'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', NULL, 'SERVICE_REPORT', 60, false, NULL),
      ('Doc: insurance', ARRAY['insurance certificate','policy schedule'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', NULL, 'INSURANCE_CERTIFICATE', 60, false, NULL),
      ('Doc: warranty', ARRAY['warranty certificate','warranty card'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', NULL, 'WARRANTY_DOCUMENT', 60, false, NULL),
      ('Doc: quotation', ARRAY['quotation','quote'], 'ANY', ARRAY['ATTACHMENT_NAME'], 'WORD', NULL, 'QUOTATION', 50, false, NULL),
      ('Doc: proforma is not a tax invoice', ARRAY['proforma','pro forma','pro-forma'], 'ANY', ARRAY['ATTACHMENT_NAME','ATTACHMENT_TEXT'], 'PHRASE', NULL, 'TAX_INVOICE', 90, true, NULL)
    ) AS r(nm, terms, comb, locs, mode, cat, doc, w, excl, act);
    GET DIAGNOSTICS v_rules = ROW_COUNT;
  END IF;

  INSERT INTO ei_settings (organization_id, settings) VALUES (v_org, jsonb_build_object(
    'ai', jsonb_build_object('classify_emails', true, 'classify_documents', true, 'extract_fields', true),
    'confidence', jsonb_build_object('high', 0.85, 'medium', 0.60),
    'matching', jsonb_build_object(
      'auto_create_invoice', true,          -- create in the invoice register (status "uploaded") when every check passes
      'require_po', true,                   -- invoices must reference a known PO (else Pending PO Identification)
      'require_receipt', true,              -- a GRN must exist against the PO (else Pending GRN)
      'amount_tolerance_pct', 2,            -- invoice total vs received value (or PO total)
      'amount_tolerance_abs', 100,          -- …or this absolute amount, whichever is larger
      'tax_tolerance_abs', 1,               -- taxable + tax vs total
      'duplicate_window_days', 730),
    'attachments', jsonb_build_object('max_mb', 15, 'max_count', 15,
      'allowed_ext', jsonb_build_array('pdf','jpg','jpeg','png','xlsx','xls','csv','docx','doc','xml','txt'))))
  ON CONFLICT (organization_id) DO NOTHING;

  PERFORM set_config('ei.seeding', 'off', true);
  INSERT INTO ei_config_audit (organization_id, entity, action, after, actor_id)
  VALUES (v_org, 'defaults', 'SEED', jsonb_build_object('categories', v_cats, 'document_types', v_docs, 'rules', v_rules), auth.uid());

  IF NOT EXISTS (SELECT 1 FROM ei_config_versions WHERE organization_id = v_org) THEN
    INSERT INTO ei_config_versions (organization_id, version, snapshot, note, published_by)
    VALUES (v_org, 1, _ei_snapshot(v_org), 'Default configuration', auth.uid());
    v_ver := 1;
  END IF;
  RETURN jsonb_build_object('categories', v_cats, 'document_types', v_docs, 'rules', v_rules, 'published_version', v_ver);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION ei_seed_defaults(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ei_seed_defaults(UUID) TO authenticated, service_role;

-- every org that already has an Outlook mailbox gets the defaults
DO $$ DECLARE o UUID;
BEGIN
  FOR o IN SELECT DISTINCT organization_id FROM outlook_mailboxes LOOP PERFORM ei_seed_defaults(o); END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
