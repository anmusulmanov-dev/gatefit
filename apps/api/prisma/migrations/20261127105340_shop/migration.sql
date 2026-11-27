-- CreateEnum
CREATE TYPE "invoice_kind" AS ENUM ('standard', 'shop');

-- CreateEnum
CREATE TYPE "product_base_unit" AS ENUM ('piece', 'gram', 'ml');

-- CreateEnum
CREATE TYPE "stock_movement_kind" AS ENUM ('receipt', 'sale', 'return', 'write_off', 'count_adjust');

-- AlterEnum
ALTER TYPE "invoice_item_kind" ADD VALUE 'product';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "credited_minor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "invoice_kind" NOT NULL DEFAULT 'standard',
ALTER COLUMN "member_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "member_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "barcode" TEXT,
    "base_unit" "product_base_unit" NOT NULL,
    "low_stock_threshold" INTEGER,
    "ikpu_code" TEXT,
    "vat_rate_bp" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_units" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_quantity" INTEGER NOT NULL,
    "price_minor" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "value_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "kind" "stock_movement_kind" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "value_delta_minor" BIGINT NOT NULL,
    "revenue_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "unit_name" TEXT,
    "unit_count" INTEGER,
    "unit_base" INTEGER,
    "reason" TEXT,
    "supplier" TEXT,
    "invoice_id" UUID,
    "invoice_item_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_organization_id_name_idx" ON "products"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_id_key" ON "products"("organization_id", "id");

-- CreateIndex
CREATE INDEX "product_units_organization_id_product_id_idx" ON "product_units"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_units_organization_id_id_key" ON "product_units"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_organization_id_id_key" ON "stock_levels"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_organization_id_product_id_location_id_key" ON "stock_levels"("organization_id", "product_id", "location_id");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_location_id_created_at_idx" ON "stock_movements"("organization_id", "location_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_product_id_idx" ON "stock_movements"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_invoice_item_id_idx" ON "stock_movements"("organization_id", "invoice_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_organization_id_id_key" ON "stock_movements"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_invoice_item_id_fkey" FOREIGN KEY ("organization_id", "invoice_item_id") REFERENCES "invoice_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
