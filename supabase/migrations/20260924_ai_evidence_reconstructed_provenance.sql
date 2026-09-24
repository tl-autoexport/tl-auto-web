-- The AI evidence journal cannot currently record what the Encar batch actually has.
--
-- The 99 published cards whose price came from `ai_web_fallback` have no captured
-- provider answer: the AI wave that produced them did not write a journal row, and
-- the only provenance that survived is the automatic-reference row, whose `note`
-- holds a URL. The journal's own checks allowed provider in (gemini, deepseek) and
-- status in (approved, review_required, unresolved), so a row could only be added by
-- pretending a provider produced it — exactly the unverifiable evidence this project
-- is trying to remove.
--
-- The two checks are widened so the journal can state the truth:
--   provider = 'reference_row_backfill'  the row was reconstructed from a stored
--                                        reference row, not captured from a provider;
--   status   = 'reconstructed'           it documents provenance and still needs review.
--
-- No existing row changes meaning and no approval is implied: `approved_at` stays
-- null, and only a final value requires an approved row.

alter table public.vehicle_power_ai_evidence drop constraint if exists vehicle_power_ai_evidence_provider_check;
alter table public.vehicle_power_ai_evidence
  add constraint vehicle_power_ai_evidence_provider_check
  check (provider in ('gemini', 'deepseek', 'reference_row_backfill'));

alter table public.vehicle_power_ai_evidence drop constraint if exists vehicle_power_ai_evidence_status_check;
alter table public.vehicle_power_ai_evidence
  add constraint vehicle_power_ai_evidence_status_check
  check (status in ('approved', 'review_required', 'unresolved', 'reconstructed'));

comment on column public.vehicle_power_ai_evidence.provider is
  'Who produced the value: an AI provider, or reference_row_backfill when the row was reconstructed from a stored reference because no provider answer was captured.';

comment on column public.vehicle_power_ai_evidence.status is
  'review_required/unresolved = a provider answer awaiting a decision; reconstructed = rebuilt from a stored reference, documented but unverified; approved = accepted (see approved_at).';
