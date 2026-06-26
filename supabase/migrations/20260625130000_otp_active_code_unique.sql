-- Verhindert mehrdeutiges Einloesen: max. EIN aktiver (unbenutzter) OTP pro Code.
-- core/ erzeugt Codes mit Retry bei Konflikt.
create unique index connection_otps_active_code_idx
  on public.connection_otps (code)
  where used_at is null;
