-- Add the assigned_at column referenced by cal-ops assignItemCode().
--
-- Without this, the assignment UPDATE in cal-ops failed at PostgREST with
-- "could not find the 'assigned_at' column", silently breaking the warranty
-- clock since 2026-05-17. activate_warranty does not touch warranty_end, so
-- once this column exists the three-stage lifecycle works correctly:
--
--   generated  → status='inactive',   warranty_end=NULL,        assigned_at=NULL
--   assigned   → status='unactivated', warranty_end=NOW()+2yr,  assigned_at=NOW()
--   activated  → status='active',      warranty_end unchanged,  activated_at=NOW(),
--                                     customer_id=auth.uid()-derived
--
-- Idempotent.

ALTER TABLE public.warranties
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

COMMENT ON COLUMN public.warranties.assigned_at IS
  'Timestamp when an admin bound this activation code to an order item in cal-ops. The two-year warranty_end is stamped at this moment.';
