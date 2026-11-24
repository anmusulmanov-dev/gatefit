-- CreateEnum
CREATE TYPE "organization_theme" AS ENUM ('zumrad', 'olov', 'neon', 'moviy');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "theme" "organization_theme" NOT NULL DEFAULT 'zumrad';

-- The organization picks its own look: the app role may change this column too.
GRANT UPDATE (theme) ON organizations TO gatefit_app;
