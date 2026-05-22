-- Shared per-IP rate-limit bucket for public form endpoints
-- (contact-notify, subscribe-newsletter). Service-role only.
CREATE TABLE IF NOT EXISTS public.form_rate_limit (
  key          text PRIMARY KEY,       -- '<bucket>:<sha256(ip)>'
  count        int  NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.form_rate_limit ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.form_rate_limit IS
  'Per-IP rate-limit counters for public form endpoints. Service role only.';
