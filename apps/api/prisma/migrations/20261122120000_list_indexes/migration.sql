-- Indexes for the lists staff page through, newest first (part 14B, after
-- the Lighthouse audit). Without them, each page sorts the whole table.
--
-- The audit log (ADR 0017): every entry, or one admin's, one thing's, or
-- one kind of action's. Indexes only: the log stays append-only, and its
-- triggers refuse UPDATE, DELETE and TRUNCATE as before (ADR 0012).

-- CreateIndex
CREATE INDEX "audit_log_createdAt_id_idx" ON "audit_log"("createdAt", "id");

-- CreateIndex
CREATE INDEX "audit_log_actorId_createdAt_idx" ON "audit_log"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_targetId_createdAt_idx" ON "audit_log"("targetId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_action_createdAt_idx" ON "audit_log"("action", "createdAt");

-- Every order, the newest or the oldest first (ADR 0028); one status's
-- orders already have their own.

-- CreateIndex
CREATE INDEX "orders_createdAt_id_idx" ON "orders"("createdAt", "id");
