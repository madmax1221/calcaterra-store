-- Block role self-promotion on the customers table.
-- Closes audit item 2.1 (HIGH).
--
-- Background: the customers_update RLS policy allows a user to UPDATE their
-- own row (auth.uid() = auth_user_id), but does not restrict which columns
-- they can write. Because is_admin() reads customers.role, anyone with a
-- regular account could send a single PATCH to set role='admin' and unlock
-- cal-ops + all admin RLS paths.
--
-- This trigger fires on UPDATE and blocks any change to the role column
-- unless the calling auth.uid() is already an admin. Existing admins can
-- still promote others (via customers_admin_all) or demote themselves.
-- INSERT is not affected; the customers_insert WITH CHECK ensures new rows
-- can only have auth.uid() = auth_user_id, and the default value of role
-- on new rows is 'customer'.

CREATE OR REPLACE FUNCTION public.block_non_admin_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT EXISTS (
      SELECT 1
      FROM customers
      WHERE auth_user_id = auth.uid()
        AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'role change requires admin privileges'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_block_role_change ON public.customers;

CREATE TRIGGER customers_block_role_change
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.block_non_admin_role_change();

COMMENT ON FUNCTION public.block_non_admin_role_change IS
  'Prevents non-admins from changing customers.role. Existing admins may promote/demote freely.';
