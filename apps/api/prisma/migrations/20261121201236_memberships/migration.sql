-- CreateEnum
CREATE TYPE "plan_type" AS ENUM ('duration', 'visits', 'single', 'trial');

-- CreateEnum
CREATE TYPE "duration_unit" AS ENUM ('day', 'month', 'year');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('scheduled', 'active', 'frozen', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "freeze_source" AS ENUM ('staff', 'member_request');

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "plan_type" NOT NULL,
    "duration_value" INTEGER NOT NULL,
    "duration_unit" "duration_unit" NOT NULL,
    "visit_limit" INTEGER,
    "price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "restrictions" JSONB NOT NULL,
    "freeze_max_days" INTEGER NOT NULL DEFAULT 0,
    "freeze_max_times" INTEGER NOT NULL DEFAULT 0,
    "freeze_min_days" INTEGER NOT NULL DEFAULT 1,
    "freeze_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "plan_name" TEXT NOT NULL,
    "plan_type" "plan_type" NOT NULL,
    "visit_limit" INTEGER,
    "price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "restrictions" JSONB NOT NULL,
    "freeze_max_days" INTEGER NOT NULL,
    "freeze_max_times" INTEGER NOT NULL,
    "freeze_min_days" INTEGER NOT NULL,
    "freeze_fee_minor" BIGINT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "visits_left" INTEGER,
    "status" "membership_status" NOT NULL,
    "status_changes_at" TIMESTAMPTZ(3),
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "sold_by" UUID NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_freezes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "source" "freeze_source" NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "ended_early_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "membership_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plans_organization_id_is_active_idx" ON "plans"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "plans_organization_id_id_key" ON "plans"("organization_id", "id");

-- CreateIndex
CREATE INDEX "memberships_organization_id_member_id_idx" ON "memberships"("organization_id", "member_id");

-- CreateIndex
CREATE INDEX "memberships_status_changes_at_idx" ON "memberships"("status_changes_at");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_id_key" ON "memberships"("organization_id", "id");

-- CreateIndex
CREATE INDEX "membership_freezes_organization_id_membership_id_idx" ON "membership_freezes"("organization_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_freezes_organization_id_id_key" ON "membership_freezes"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_plan_id_fkey" FOREIGN KEY ("organization_id", "plan_id") REFERENCES "plans"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_freezes" ADD CONSTRAINT "membership_freezes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_freezes" ADD CONSTRAINT "membership_freezes_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: money is never negative, dates run forward (CLAUDE.md rule 2).
ALTER TABLE "plans" ADD CONSTRAINT "plans_amounts_check"
  CHECK (price_minor >= 0 AND freeze_fee_minor >= 0 AND duration_value > 0
         AND freeze_max_days >= 0 AND freeze_max_times >= 0 AND freeze_min_days > 0);
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_terms_check"
  CHECK (price_minor >= 0 AND freeze_fee_minor >= 0 AND ends_on >= starts_on
         AND ends_at > starts_at AND (visits_left IS NULL OR visits_left >= 0));
ALTER TABLE "membership_freezes" ADD CONSTRAINT "membership_freezes_dates_check"
  CHECK (fee_minor >= 0 AND days >= 0 AND ends_on >= starts_on - 1);
