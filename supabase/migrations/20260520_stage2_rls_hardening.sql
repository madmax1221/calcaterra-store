-- Stage 2 security hardening: audit items 2.2, 2.4, 2.5.
--
-- Context: all customer order/warranty writes go through SECURITY DEFINER
-- RPCs (place_order, activate_warranty) owned by postgres (BYPASSRLS), and
-- admin writes go through is_admin() policies. So removing the permissive
-- public insert/update paths below does not break checkout, registration,
-- or cal-ops — it only closes the direct-PostgREST bypass routes.

-- ── 2.5: rate-limit table for warranty activation ────────────────────────
CREATE TABLE IF NOT EXISTS public.warranty_activation_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_waa_user_time
  ON public.warranty_activation_attempts(auth_user_id, created_at);
ALTER TABLE public.warranty_activation_attempts ENABLE ROW LEVEL SECURITY;
-- No policies → only service_role / SECURITY DEFINER can touch it.

-- ── 2.2 + 2.5: activate_warranty derives customer from auth.uid() and
--    rate-limits attempts. Signature unchanged so the client call still works;
--    p_customer_id is now ignored in favour of the authenticated identity.
CREATE OR REPLACE FUNCTION public.activate_warranty(p_code text, p_purchase_date date, p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_w           warranties%ROWTYPE;
  v_clean       text;
  v_customer_id uuid;
  v_attempts    int;
BEGIN
  -- Identity comes from the session, never the client parameter.
  SELECT id INTO v_customer_id FROM customers WHERE auth_user_id = auth.uid();
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'You must be signed in to register a watch.');
  END IF;

  -- Rate limit: max 10 attempts per user per rolling hour (blunts brute force).
  SELECT count(*) INTO v_attempts
    FROM warranty_activation_attempts
   WHERE auth_user_id = auth.uid()
     AND created_at > now() - interval '1 hour';
  IF v_attempts >= 10 THEN
    RETURN jsonb_build_object('error', 'Too many attempts. Please try again in a little while.');
  END IF;
  INSERT INTO warranty_activation_attempts (auth_user_id) VALUES (auth.uid());

  v_clean := REPLACE(UPPER(TRIM(p_code)), '-', '');
  SELECT * INTO v_w FROM warranties WHERE REPLACE(activation_code, '-', '') = v_clean;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid activation code. Please check and try again.');
  END IF;
  IF v_w.status = 'active' THEN
    RETURN jsonb_build_object('error', 'This code has already been registered.');
  END IF;
  IF v_w.status NOT IN ('inactive', 'unactivated') THEN
    RETURN jsonb_build_object('error', 'This code cannot be used.');
  END IF;

  UPDATE warranties
     SET status        = 'active',
         customer_id   = v_customer_id,   -- derived from auth.uid(), not the param
         purchase_date = p_purchase_date,
         activated_at  = NOW()
   WHERE id = v_w.id;

  RETURN jsonb_build_object('success', true, 'variant', v_w.variant, 'code', v_w.activation_code);
END;
$function$;

-- ── 2.4: close direct-PostgREST bypass routes ────────────────────────────

-- orders / order_items: customers must go through place_order (which enforces
-- the 5-watch limit + stock checks). Admins still write via *_admin_all.
DROP POLICY IF EXISTS orders_insert ON public.orders;
DROP POLICY IF EXISTS order_items_insert ON public.order_items;

-- warranties: the FOR ALL "own_data" policy let customers UPDATE/DELETE their
-- own warranty rows directly (e.g. extend warranty_end). Customers should only
-- READ; activation happens via the RPC; mutations are admin-only.
DROP POLICY IF EXISTS warranties_own_data ON public.warranties;

COMMENT ON FUNCTION public.activate_warranty IS
  'Activate a warranty code for the AUTHENTICATED user (customer_id derived from auth.uid(), client param ignored). Rate-limited to 10 attempts/user/hour.';
