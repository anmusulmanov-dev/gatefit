-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "logo_key" TEXT;

-- The organization uploads its own logo: the app role may change this column too.
GRANT UPDATE (logo_key) ON organizations TO gatefit_app;
