-- Trigram indexes back member search by any part of a name or phone. pg_trgm is a
-- trusted extension, so the schema owner may create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "member_status" AS ENUM ('inactive', 'active', 'frozen', 'expired', 'debtor', 'blocked');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('male', 'female');

-- AlterTable
ALTER TABLE "consents" ADD COLUMN     "member_id" UUID;

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "home_location_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "birth_date" DATE,
    "gender" "gender",
    "photo_key" TEXT,
    "status" "member_status" NOT NULL DEFAULT 'inactive',
    "blocked_reason" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "members_organization_id_home_location_id_status_idx" ON "members"("organization_id", "home_location_id", "status");

-- CreateIndex
CREATE INDEX "members_first_name_trgm_idx" ON "members" USING GIN ("first_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "members_last_name_trgm_idx" ON "members" USING GIN ("last_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "members_phone_trgm_idx" ON "members" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "members_organization_id_id_key" ON "members"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "members_organization_id_phone_key" ON "members"("organization_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "members_organization_id_user_id_key" ON "members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "consents_organization_id_member_id_idx" ON "consents"("organization_id", "member_id");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_home_location_id_fkey" FOREIGN KEY ("organization_id", "home_location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
