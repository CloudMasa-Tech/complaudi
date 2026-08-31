-- Preserve what people can already see.
--
-- Before this change every user saw every company in their organisation.
-- SUPER_ADMIN and ADMIN still do and need no rows. Everyone else is granted the
-- companies that existed at this moment, so nothing disappears from under them
-- on deploy. Companies created from here need a deliberate grant.
INSERT INTO "company_memberships" ("id", "userId", "companyId", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", c."id", u."role", NOW(), NOW()
FROM "users" u
JOIN "companies" c ON c."organizationId" = u."organizationId"
WHERE u."role" NOT IN ('SUPER_ADMIN', 'ADMIN')
ON CONFLICT ("userId", "companyId") DO NOTHING;
