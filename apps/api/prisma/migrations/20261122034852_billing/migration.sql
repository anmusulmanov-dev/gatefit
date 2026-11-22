-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('open', 'partially_paid', 'paid', 'void');

-- CreateEnum
CREATE TYPE "invoice_item_kind" AS ENUM ('membership', 'freeze_fee', 'other');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'card_terminal', 'transfer', 'online');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('succeeded', 'pending', 'failed');

-- CreateEnum
CREATE TYPE "cash_shift_status" AS ENUM ('open', 'closed');

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER,
    "response" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("organization_id","key")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "organization_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("organization_id","year")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "member_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "status" "invoice_status" NOT NULL DEFAULT 'open',
    "due_on" DATE,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "overdue_marked_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "invoice_item_kind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "membership_id" UUID,
    "freeze_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "cash_shift_id" UUID,
    "method" "payment_method" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "external_id" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'succeeded',
    "received_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "cash_shift_id" UUID,
    "method" "payment_method" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "refunded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_shifts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "status" "cash_shift_status" NOT NULL DEFAULT 'open',
    "opening_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "opened_by" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "counted_minor" BIGINT,
    "expected_minor" BIGINT,
    "difference_minor" BIGINT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_organization_id_member_id_idx" ON "invoices"("organization_id", "member_id");

-- CreateIndex
CREATE INDEX "invoices_due_at_idx" ON "invoices"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_id_key" ON "invoices"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_number_key" ON "invoices"("organization_id", "number");

-- CreateIndex
CREATE INDEX "invoice_items_organization_id_invoice_id_idx" ON "invoice_items"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "invoice_items_organization_id_membership_id_idx" ON "invoice_items"("organization_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_organization_id_id_key" ON "invoice_items"("organization_id", "id");

-- CreateIndex
CREATE INDEX "payments_organization_id_created_at_idx" ON "payments"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_organization_id_invoice_id_idx" ON "payments"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_cash_shift_id_idx" ON "payments"("organization_id", "cash_shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_id_key" ON "payments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "refunds_organization_id_payment_id_idx" ON "refunds"("organization_id", "payment_id");

-- CreateIndex
CREATE INDEX "refunds_organization_id_cash_shift_id_idx" ON "refunds"("organization_id", "cash_shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_organization_id_id_key" ON "refunds"("organization_id", "id");

-- CreateIndex
CREATE INDEX "cash_shifts_organization_id_location_id_opened_at_idx" ON "cash_shifts"("organization_id", "location_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "cash_shifts_organization_id_id_key" ON "cash_shifts"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_cash_shift_id_fkey" FOREIGN KEY ("organization_id", "cash_shift_id") REFERENCES "cash_shifts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_payment_id_fkey" FOREIGN KEY ("organization_id", "payment_id") REFERENCES "payments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_cash_shift_id_fkey" FOREIGN KEY ("organization_id", "cash_shift_id") REFERENCES "cash_shifts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: money is never negative and payments add up (CLAUDE.md rule 2).
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_check"
  CHECK (total_minor >= 0 AND paid_minor >= 0 AND paid_minor <= total_minor);
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_amounts_check"
  CHECK (quantity > 0 AND unit_minor >= 0 AND total_minor = unit_minor * quantity);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK (amount_minor > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check" CHECK (amount_minor > 0);
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_amounts_check"
  CHECK (opening_minor >= 0 AND (counted_minor IS NULL OR counted_minor >= 0)
         AND (status = 'open') = (closed_at IS NULL));

-- One open cash shift per location.
CREATE UNIQUE INDEX "cash_shifts_one_open_per_location"
  ON "cash_shifts" ("organization_id", "location_id") WHERE status = 'open';
