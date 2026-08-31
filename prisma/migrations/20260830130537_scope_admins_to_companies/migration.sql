-- Admins become company-scoped.
--
-- Only SUPER_ADMIN now sees the whole organisation without a grant. Admins are
-- onboarded onto designated companies like everyone else, so the ones that
-- already exist are granted what they could see a moment ago — nothing
-- disappears from under them on deploy.
INSERT INTO "company_memberships" ("id", "userId", "companyId", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", c."id", 'ADMIN'::"UserRole", NOW(), NOW()
FROM "users" u
JOIN "companies" c ON c."organizationId" = u."organizationId"
WHERE u."role" = 'ADMIN'
ON CONFLICT ("userId", "companyId") DO NOTHING;
