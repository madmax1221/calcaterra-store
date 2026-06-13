-- Two findings from the post-audit website leak hunt.
--
-- 1) products.stock_qty was publicly readable via PostgREST. The actual value
--    is 0 (the parent product carries no live stock — stock lives per-variant)
--    so no real intel was leaked, but the column was visible to anon, which
--    contradicts the inventory-hiding work we shipped on product_variants.
--    Same column-grant pattern as 20260520_inventory_and_buy_limit.sql.
--
-- 2) The trigger-only helper functions (handle_new_user, handle_user_update,
--    sync_customer_email, sync_variant_in_stock, block_non_admin_role_change)
--    are SECURITY DEFINER and end up listed in PostgREST's RPC catalog. They
--    cannot actually be called via /rest/v1/rpc/* because their trigger
--    context (NEW/OLD) is absent — PostgREST returns PGRST202 — but the
--    EXECUTE permission to anon/authenticated should still be removed so the
--    function names don't appear at all and there is no surface to probe.

-- 1) Lock products.stock_qty from anon / authenticated
REVOKE SELECT ON public.products FROM anon, authenticated;
GRANT  SELECT (id, collection_id, name, slug, description, image_url, images,
               price, compare_at_price, is_active, created_at)
  ON public.products TO anon, authenticated;

-- 2) Remove EXECUTE on trigger-only helpers from anon / authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user()            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_update()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_customer_email()        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_variant_in_stock()      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_non_admin_role_change() FROM anon, authenticated;
