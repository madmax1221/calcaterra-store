-- Calcaterra — email audit log for send-email Edge Function
-- Captures every transactional email sent from cal-ops so admins can
-- see what was dispatched (and when), without needing to dig into Resend.

create table if not exists public.email_log (
  id          uuid primary key default gen_random_uuid(),
  sent_at     timestamptz not null default now(),
  sent_by     uuid references auth.users(id) on delete set null,
  recipient   text not null,
  subject     text not null,
  provider_id text,
  meta        jsonb
);

create index if not exists email_log_sent_at_idx on public.email_log (sent_at desc);
create index if not exists email_log_recipient_idx on public.email_log (recipient);

alter table public.email_log enable row level security;

-- Only admins can read the log (writes happen via service-role from the
-- Edge Function, which bypasses RLS).
drop policy if exists "admins read email log" on public.email_log;
create policy "admins read email log"
  on public.email_log for select
  using (
    exists (
      select 1 from public.customers c
      where c.id = auth.uid() and c.role = 'admin'
    )
  );

-- Make sure admins can also read contact_submissions and
-- newsletter_subscribers from the storefront (RLS-friendly admin access).
drop policy if exists "admins read contact submissions" on public.contact_submissions;
create policy "admins read contact submissions"
  on public.contact_submissions for select
  using (
    exists (
      select 1 from public.customers c
      where c.id = auth.uid() and c.role = 'admin'
    )
  );

drop policy if exists "admins update contact submissions" on public.contact_submissions;
create policy "admins update contact submissions"
  on public.contact_submissions for update
  using (
    exists (
      select 1 from public.customers c
      where c.id = auth.uid() and c.role = 'admin'
    )
  );

drop policy if exists "admins read newsletter subscribers" on public.newsletter_subscribers;
create policy "admins read newsletter subscribers"
  on public.newsletter_subscribers for select
  using (
    exists (
      select 1 from public.customers c
      where c.id = auth.uid() and c.role = 'admin'
    )
  );

drop policy if exists "admins delete newsletter subscribers" on public.newsletter_subscribers;
create policy "admins delete newsletter subscribers"
  on public.newsletter_subscribers for delete
  using (
    exists (
      select 1 from public.customers c
      where c.id = auth.uid() and c.role = 'admin'
    )
  );

-- Mark a contact submission as resolved/replied to.
alter table public.contact_submissions
  add column if not exists status text not null default 'new';
alter table public.contact_submissions
  add column if not exists replied_at timestamptz;
alter table public.contact_submissions
  add column if not exists replied_by uuid references auth.users(id) on delete set null;
