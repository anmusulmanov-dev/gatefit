-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('uploaded', 'validated', 'queued', 'running', 'done', 'failed');

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "import_id" UUID;

-- CreateTable
CREATE TABLE "member_imports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "home_location_id" UUID,
    "status" "import_status" NOT NULL DEFAULT 'uploaded',
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "sample_rows" JSONB NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "valid_rows" INTEGER,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_count" INTEGER,
    "skipped_count" INTEGER,
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "member_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_imports_organization_id_created_at_idx" ON "member_imports"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_imports_organization_id_id_key" ON "member_imports"("organization_id", "id");

-- CreateIndex
CREATE INDEX "members_organization_id_import_id_idx" ON "members"("organization_id", "import_id");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_import_id_fkey" FOREIGN KEY ("organization_id", "import_id") REFERENCES "member_imports"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_imports" ADD CONSTRAINT "member_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_imports" ADD CONSTRAINT "member_imports_organization_id_home_location_id_fkey" FOREIGN KEY ("organization_id", "home_location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
