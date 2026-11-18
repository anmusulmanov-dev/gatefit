-- Hand-written: credentials move from the global users table to the tenant-scoped staff
-- table. See docs/ADR/0003-staff-credentials.md.
--
-- Why: users is shared by every organization. With the password there, an organization
-- that resets the password of its own staff member would also change how that person
-- signs in at any other organization, including one where they are the owner.

-- Staff profile and credentials.
ALTER TABLE "staff"
  ADD COLUMN "first_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "last_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "totp_secret" TEXT,
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- The defaults only filled existing rows; new rows must supply a name.
ALTER TABLE "staff"
  ALTER COLUMN "first_name" DROP DEFAULT,
  ALTER COLUMN "last_name" DROP DEFAULT;

-- Every existing staff record keeps the credentials its user had.
UPDATE "staff" s
SET "password_hash" = u."password_hash",
    "totp_secret" = u."totp_secret"
FROM "users" u
WHERE u."id" = s."user_id";

-- These read and wrote the columns that are about to go. Staff credentials are ordinary
-- tenant data now, protected by the staff table's RLS policy.
DROP FUNCTION auth_staff_credentials(text, uuid);
DROP FUNCTION auth_enroll_totp(uuid, text);

ALTER TABLE "users"
  DROP COLUMN "password_hash",
  DROP COLUMN "totp_secret";
