-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "import_id" UUID,
ADD COLUMN     "import_row" INTEGER;

-- CreateTable
CREATE TABLE "membership_imports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "location_ids" JSONB,
    "status" "import_status" NOT NULL DEFAULT 'uploaded',
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "sample_rows" JSONB NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "valid_rows" INTEGER,
    "debt_minor" BIGINT,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_count" INTEGER,
    "skipped_count" INTEGER,
    "finished_at" TIMESTAMPTZ(3),
    "reverted_at" TIMESTAMPTZ(3),
    "reverted_by" UUID,
    "revert_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "membership_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_imports_organization_id_created_at_idx" ON "membership_imports"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "membership_imports_organization_id_id_key" ON "membership_imports"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_import_id_import_row_key" ON "memberships"("organization_id", "import_id", "import_row");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_import_id_fkey" FOREIGN KEY ("organization_id", "import_id") REFERENCES "membership_imports"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_imports" ADD CONSTRAINT "membership_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

