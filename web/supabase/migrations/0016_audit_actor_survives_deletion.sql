-- Audit records must outlive the person who acted.
--
-- Found 2026-09-16 while cleaning up after the access-matrix suite: a test
-- account could not be deleted, because `role_changes.changed_by` referenced
-- its profile with no ON DELETE behaviour — which defaults to RESTRICT.
--
-- As written, nobody who had ever changed anyone's role could ever be deleted.
-- That includes the founder: the first time an admin promotes a coach, that
-- admin becomes undeletable. A deletion request from a former administrator
-- would have been impossible to honour without editing the audit table by hand.
--
-- The record of WHAT happened must survive. The link to WHO did it is personal
-- data and must be removable. So the actor reference becomes ON DELETE SET NULL:
-- the row stays, and "changed by" reads as a deleted account.
--
-- Deliberately NOT changed here:
--
--   purchases.customer_id — still RESTRICT, and correctly so. A customer with
--   financial history must not be hard-deleted; the purchase, the ledger and
--   the tax position depend on it. Honouring a deletion request for that person
--   means anonymising the profile, which is retention work in M08, not a
--   cascade that quietly erases money records.

alter table role_changes
  drop constraint if exists role_changes_changed_by_fkey;

alter table role_changes
  add constraint role_changes_changed_by_fkey
  foreign key (changed_by) references profiles (id) on delete set null;

-- The same flaw, on every other "who performed this action" column added in
-- this batch. Each one is an actor on an audit or workflow record, and each one
-- would otherwise make that actor permanently undeletable.

alter table providers drop constraint if exists providers_approved_by_fkey;
alter table providers add constraint providers_approved_by_fkey
  foreign key (approved_by) references profiles (id) on delete set null;

alter table provider_payout_destinations drop constraint if exists provider_payout_destinations_reviewed_by_fkey;
alter table provider_payout_destinations add constraint provider_payout_destinations_reviewed_by_fkey
  foreign key (reviewed_by) references profiles (id) on delete set null;

alter table provider_payout_destinations drop constraint if exists provider_payout_destinations_created_by_fkey;
alter table provider_payout_destinations add constraint provider_payout_destinations_created_by_fkey
  foreign key (created_by) references profiles (id) on delete set null;

alter table provider_credentials drop constraint if exists provider_credentials_verified_by_fkey;
alter table provider_credentials add constraint provider_credentials_verified_by_fkey
  foreign key (verified_by) references profiles (id) on delete set null;

alter table coach_invitations drop constraint if exists coach_invitations_invited_by_fkey;
alter table coach_invitations add constraint coach_invitations_invited_by_fkey
  foreign key (invited_by) references profiles (id) on delete set null;

alter table coach_invitations drop constraint if exists coach_invitations_accepted_by_fkey;
alter table coach_invitations add constraint coach_invitations_accepted_by_fkey
  foreign key (accepted_by) references profiles (id) on delete set null;

alter table offer_versions drop constraint if exists offer_versions_published_by_fkey;
alter table offer_versions add constraint offer_versions_published_by_fkey
  foreign key (published_by) references profiles (id) on delete set null;

alter table enrollment_assignments drop constraint if exists enrollment_assignments_requested_by_fkey;
alter table enrollment_assignments add constraint enrollment_assignments_requested_by_fkey
  foreign key (requested_by) references profiles (id) on delete set null;

alter table enrollment_assignments drop constraint if exists enrollment_assignments_actioned_by_fkey;
alter table enrollment_assignments add constraint enrollment_assignments_actioned_by_fkey
  foreign key (actioned_by) references profiles (id) on delete set null;

alter table refunds drop constraint if exists refunds_requested_by_fkey;
alter table refunds add constraint refunds_requested_by_fkey
  foreign key (requested_by) references profiles (id) on delete set null;

alter table payout_batches drop constraint if exists payout_batches_prepared_by_fkey;
alter table payout_batches add constraint payout_batches_prepared_by_fkey
  foreign key (prepared_by) references profiles (id) on delete set null;

alter table payout_batches drop constraint if exists payout_batches_confirmed_by_fkey;
alter table payout_batches add constraint payout_batches_confirmed_by_fkey
  foreign key (confirmed_by) references profiles (id) on delete set null;

alter table payout_batch_items drop constraint if exists payout_batch_items_paid_by_fkey;
alter table payout_batch_items add constraint payout_batch_items_paid_by_fkey
  foreign key (paid_by) references profiles (id) on delete set null;

alter table reconciliation_exceptions drop constraint if exists reconciliation_exceptions_resolved_by_fkey;
alter table reconciliation_exceptions add constraint reconciliation_exceptions_resolved_by_fkey
  foreign key (resolved_by) references profiles (id) on delete set null;

-- The `paid_by` evidence rule in 0012 requires this column at the moment an
-- item is marked paid. Setting it null LATER, when the operator's account is
-- deleted, does not re-trigger that check: the trigger fires only on the
-- transition INTO 'paid', and a deletion is not that transition.
