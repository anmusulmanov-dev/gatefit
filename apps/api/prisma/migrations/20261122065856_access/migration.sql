-- CreateEnum
CREATE TYPE "CheckInDirection" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('qr', 'manual', 'qr_offline');

-- CreateEnum
CREATE TYPE "CheckInResult" AS ENUM ('allowed', 'denied');

-- CreateTable (edited by hand: partitioned by month, partitions in the access_rls migration)
CREATE TABLE "check_ins" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "location_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "membership_id" UUID,
    "direction" "CheckInDirection" NOT NULL,
    "method" "CheckInMethod" NOT NULL,
    "result" "CheckInResult" NOT NULL,
    "deny_reason" TEXT,
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id","at")
) PARTITION BY RANGE ("at");

-- CreateIndex
CREATE INDEX "check_ins_organization_id_location_id_at_idx" ON "check_ins"("organization_id", "location_id", "at");

-- CreateIndex
CREATE INDEX "check_ins_organization_id_member_id_at_idx" ON "check_ins"("organization_id", "member_id", "at");

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
