-- Company-scoped access control.
--
-- Roles move from "what you are in the organisation" to "what you are on a
-- given company". SUPER_ADMIN and ADMIN still see everything in the
-- organisation; everyone else sees only the companies they hold a membership
-- for. Tenant isolation by organisation is unchanged and is never crossed.

-- Map the old vocabulary onto the new one *in place*, so no user loses a role.
--   OWNER  -> SUPER_ADMIN      MEMBER -> CA
--   ADMIN and VIEWER carry over unchanged.
ALTER TYPE "UserRole" RENAME VALUE 'OWNER' TO 'SUPER_ADMIN';
ALTER TYPE "UserRole" RENAME VALUE 'MEMBER' TO 'CA';

-- Rebuild the type so its declaration order matches the schema, now that every
-- stored value has a home in the new set.
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'CA', 'COMPANY_OWNER', 'VIEWER');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
-- A new account now sees nothing until it is granted a company.
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'VIEWER';
COMMIT;

CREATE TABLE "company_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_memberships_companyId_idx" ON "company_memberships"("companyId");
CREATE INDEX "company_memberships_userId_idx" ON "company_memberships"("userId");
CREATE UNIQUE INDEX "company_memberships_userId_companyId_key" ON "company_memberships"("userId", "companyId");

ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
