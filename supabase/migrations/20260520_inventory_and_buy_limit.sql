-- Inventory tracking + 5-watch buy limit + stock notification capture.
--
-- 1) stock_notifications — public form captures emails for restock alerts.
--    Service-role inserts only via edge function, admin reads via RLS.
--
-- 2) product_variants.stock_qty no longer readable by anon/authenticated.
--    Storefront uses the generated `in_stock` boolean column. Cal-ops reads
--    real counts via the new admin_list_variants() RPC, gated by is_admin().
--
-- 3) place_order extended to enforce buy limit (≤5 watches per order),
--    check variant availability, and atomically decrement stock_qty under
--    row locks to prevent oversell on concurrent checkouts.

-- ── 1. Restock notification list ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  email         text NOT NULL,
  first_name    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  notified_at   timestamptz,
  ip            inet,
  UNIQUE (variant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_stock_notifications_variant
  ON public.stock_notifications(variant_id) WHERE notified_at IS NULL;

ALTER TABLE public.stock_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_notifications_admin_all ON public.stock_notifications;
CREATE POLICY stock_notifications_admin_all
  ON public.stock_notifications FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

COMMENT ON TABLE public.stock_notifications IS
  'Restock interest capture. Public inserts go through the stock-notify edge function.';

-- ── 2. Hide stock_qty from public, expose in_stock instead ───────────────
-- Generated column requires removing the column default temporarily and is
-- safest as a regular boolean kept in sync by a tiny trigger. We use a
-- trigger so cal-ops can still UPDATE stock_qty and in_stock follows.

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.sync_variant_in_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.in_stock := COALESCE(NEW.stock_qty, 0) > 0 AND COALESCE(NEW.is_active, false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_variants_sync_in_stock ON public.product_variants;
CREATE TRIGGER product_variants_sync_in_stock
  BEFORE INSERT OR UPDATE ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_variant_in_stock();

-- Backfill in_stock for existing rows
UPDATE public.product_variants SET in_stock = (stock_qty > 0 AND is_active);

-- Revoke direct stock_qty visibility from the storefront roles.
-- Postgres column-level REVOKE doesn't work while a broader table-level
-- GRANT SELECT exists, so we revoke the table-level grant and re-grant
-- only the safe columns explicitly. Service-role keeps full access for
-- edge functions + the admin RPCs defined below.
REVOKE SELECT ON public.product_variants FROM anon, authenticated;
GRANT SELECT (id, product_id, name, sku, price_modifier, attributes, images,
              is_active, created_at, in_stock)
  ON public.product_variants TO anon, authenticated;

-- ── 3. Admin RPCs for stock management ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_variants()
RETURNS TABLE (
  id            uuid,
  name          text,
  sku           text,
  stock_qty     int,
  in_stock      boolean,
  is_active     boolean,
  price_modifier numeric,
  attributes    jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT v.id, v.name, v.sku, v.stock_qty, v.in_stock, v.is_active,
           v.price_modifier, v.attributes
      FROM product_variants v
     ORDER BY v.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_variant_stock(p_id uuid, p_stock_qty int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_stock_qty IS NULL OR p_stock_qty < 0 THEN
    RAISE EXCEPTION 'stock_qty must be a non-negative integer';
  END IF;
  UPDATE product_variants
     SET stock_qty = p_stock_qty
   WHERE id = p_id
   RETURNING stock_qty INTO v_new;
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'variant % not found', p_id;
  END IF;
  RETURN v_new;
END;
$$;

-- ── 4. Update place_order: buy limit + stock check + atomic decrement ───
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_id      uuid,
  p_total            numeric,
  p_shipping_address jsonb,
  p_items            jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id    uuid;
  v_item        jsonb;
  v_total_qty   int := 0;
  v_variant_id  uuid;
  v_qty         int;
  v_avail       int;
BEGIN
  -- 1) Validate buy limit across all line items (max 5 watches total).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty < 1 THEN
      RAISE EXCEPTION 'quantity must be at least 1';
    END IF;
    v_total_qty := v_total_qty + v_qty;
  END LOOP;

  IF v_total_qty > 5 THEN
    RAISE EXCEPTION 'order exceeds the 5-watch limit (% requested)', v_total_qty
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2) For each item: lock the variant row, check stock, decrement.
  --    FOR UPDATE serializes concurrent checkouts on the same variant.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_qty := (v_item->>'quantity')::int;

    SELECT stock_qty INTO v_avail
      FROM product_variants
     WHERE id = v_variant_id
       AND is_active = true
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'variant % is unavailable', v_variant_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_avail < v_qty THEN
      RAISE EXCEPTION 'insufficient stock for variant % (% available, % requested)',
        v_variant_id, v_avail, v_qty
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE product_variants
       SET stock_qty = stock_qty - v_qty
     WHERE id = v_variant_id;
  END LOOP;

  -- 3) Insert the order header.
  INSERT INTO orders (customer_id, status, total, discount_amount, shipping_address, notes)
  VALUES (p_customer_id, 'pending', p_total, 0, p_shipping_address, null)
  RETURNING id INTO v_order_id;

  -- 4) Insert the line items.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO order_items (order_id, product_id, variant_id, quantity, unit_price)
    VALUES (
      v_order_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'variant_id')::uuid,
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric
    );
  END LOOP;

  RETURN v_order_id;
END;
$$;

COMMENT ON FUNCTION public.place_order IS
  'Place a customer order. Enforces 5-watch buy limit, validates stock per variant, and atomically decrements stock under row locks to prevent oversell.';
