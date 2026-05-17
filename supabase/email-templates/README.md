# Supabase auth email templates

These HTML files match the branded shell used by every other Calcaterra email
(welcome, order confirmation, watch registration, cancellation, etc).
Supabase's built-in auth flow does NOT route through our edge functions ·
the only way to brand `resetPasswordForEmail()`, signup confirmations, etc
is to paste the HTML directly into the Supabase dashboard.

## How to apply

1. Supabase Dashboard → **Authentication** → **Email Templates**
2. Pick the template (Reset Password / Magic Link / Confirm Signup / etc)
3. Replace the entire body with the matching file in this folder
4. Set **Subject** to the matching value below
5. Save

## Available templates

| File | Supabase template | Subject |
|---|---|---|
| `password-reset.html` | **Reset Password** | `Reset your Calcaterra password` |

## Template variables (Supabase mail merge)

- `{{ .ConfirmationURL }}` — the full magic link (recovery / signup confirm / etc)
- `{{ .SiteURL }}` — site URL configured in Auth settings
- `{{ .Email }}` — recipient's email address
- `{{ .Token }}` — OTP token if using token-based flow
- `{{ .TokenHash }}` — token hash
- `{{ .Data }}` — user metadata JSON

For password reset, `{{ .ConfirmationURL }}` points to the redirect URL we
pass into `auth.resetPasswordForEmail(email, { redirectTo: '...' })`
with the recovery hash appended.

## Notes

- Site URL in Auth Settings must be `https://calcaterra.co`
- Redirect URLs allow-list must include `https://calcaterra.co/forgot-password`
- The shell mirrors `buildBrandedEmailShell()` in cal-ops.html · keep them in sync
  if either is updated in the future.
