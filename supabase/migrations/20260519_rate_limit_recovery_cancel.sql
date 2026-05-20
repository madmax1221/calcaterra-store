-- Rate-limit table for auth-cancel-recovery edge function.
-- Closes audit item 1.5 (HIGH) — without this, an attacker who knows a
-- target email can loop the cancel endpoint to globally sign the victim out
-- on every call and email-bomb them.
--
-- The table stores SHA-256 hashes of the email, not the email itself.
-- - Service role inserts / updates from inside the edge function.
-- - No RLS policies for anon / authenticated → nobody but service role can
--   read or write. RLS is enabled so the default-deny applies.

CREATE TABLE IF NOT EXISTS public.recovery_cancel_attempts (
  email_hash   text        PRIMARY KEY,
  count        int         NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recovery_cancel_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public.recovery_cancel_attempts IS
  'Rate-limit counter for the auth-cancel-recovery edge function. Service role only.';
COMMENT ON COLUMN public.recovery_cancel_attempts.email_hash IS
  'SHA-256 hex of the lowercased email address.';
