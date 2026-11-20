-- An Admin's emailed link is an invitation, or a new start for the
-- authenticator app after a Super User reset it (ADR 0038). Existing links
-- are invitations.
CREATE TYPE "StaffLinkPurpose" AS ENUM ('INVITE', 'AUTHENTICATOR_RESET');

ALTER TABLE "staff_invitations"
  ADD COLUMN "purpose" "StaffLinkPurpose" NOT NULL DEFAULT 'INVITE',
  ADD COLUMN "pendingMfaSecret" TEXT;
