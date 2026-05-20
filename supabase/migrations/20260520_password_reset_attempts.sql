-- Single-use cancel tokens for the "this wasn't me" link in reset emails.
-- Closes audit item 1.5 (HIGH) properly — replaces the email-in-URL design
-- with an unguessable token bound to a specific reset request.
--
-- A row is inserted by send-password-reset every time a reset link is sent.
-- The cancel URL embeds the token (not the email). auth-cancel-recovery
-- looks up the token, validates not-cancelled and within 1h, then marks
-- it cancelled (single-use). RLS is enabled with no policies, so only
-- service role inside edge functions can read or write the table.

CREATE TABLE IF NOT EXISTS public.password_reset_attempts (
  token         text        PRIMARY KEY,
  email         text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  ip            inet
);

CREATE INDEX IF NOT EXISTS idx_password_reset_attempts_email
  ON public.password_reset_attempts(email);

CREATE INDEX IF NOT EXISTS idx_password_reset_attempts_created_at
  ON public.password_reset_attempts(created_at);

ALTER TABLE public.password_reset_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public.password_reset_attempts IS
  'Single-use tokens for password reset cancel links. Service role only.';
COMMENT ON COLUMN public.password_reset_attempts.token IS
  '32-byte base64url token shipped in the "this wasn''t me" URL.';
COMMENT ON COLUMN public.password_reset_attempts.cancelled_at IS
  'Timestamp when the user clicked the cancel link. NULL = still active.';
COMMENT ON COLUMN public.password_reset_attempts.ip IS
  'Caller IP at request time, best-effort for audit. May be NULL.';
