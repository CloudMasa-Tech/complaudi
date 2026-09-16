-- Add the 8th entity type for businesses not registered under the Companies
-- Act, LLP Act or any other constitution the toolkit models (sole traders,
-- freelancers, informal partnerships, pre-incorporation ventures).
ALTER TYPE "EntityType" ADD VALUE 'UNREGISTERED';