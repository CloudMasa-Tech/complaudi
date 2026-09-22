-- ============================================================================
-- Supabase Atomic Stored Procedures (RPCs) for Complex Transactions
-- ============================================================================

-- ── 1. Self-Service Trial Registration ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_register_trial(
  p_user_id uuid,
  p_email text,
  p_password_hash text,
  p_name text,
  p_phone text,
  p_company_name text,
  p_entity_type "EntityType",
  p_state_code text,
  p_cin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_org_id uuid := gen_random_uuid();
  v_company_id uuid := gen_random_uuid();
  v_slug text;
  v_trial_ends_at timestamptz := now() + interval '14 days';
  v_result jsonb;
BEGIN
  -- Generate unique slug for organization
  v_slug := lower(regexp_replace(p_company_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || encode(gen_random_bytes(3), 'hex');

  -- 1. Create Organization
  INSERT INTO public.organizations (id, name, slug, "trialEndsAt", "trialSignedUpAt", "createdAt", "updatedAt")
  VALUES (v_org_id, p_company_name, v_slug, v_trial_ends_at, now(), now(), now());

  -- 2. Create User
  INSERT INTO public.users (id, "organizationId", email, "passwordHash", name, role, phone, "isActive", "createdAt", "updatedAt")
  VALUES (p_user_id, v_org_id, p_email, p_password_hash, p_name, 'SUPER_ADMIN'::"UserRole", p_phone, true, now(), now());

  -- 3. Create Company
  INSERT INTO public.companies (
    id, "organizationId", "legalName", "entityType", "stateCode", cin, "isActive", "createdAt", "updatedAt"
  )
  VALUES (
    v_company_id, v_org_id, p_company_name, p_entity_type, p_state_code, p_cin, true, now(), now()
  );

  -- 4. Create Company Membership Grant
  INSERT INTO public.company_memberships (id, "userId", "companyId", role, "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), p_user_id, v_company_id, 'SUPER_ADMIN'::"UserRole", now(), now());

  -- Return summary payload
  v_result := jsonb_build_object(
    'organizationId', v_org_id,
    'userId', p_user_id,
    'companyId', v_company_id,
    'trialEndsAt', v_trial_ends_at
  );

  RETURN v_result;
END;
$$;


-- ── 2. Permanent Company Deletion ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_delete_company_permanently(
  p_company_id uuid,
  p_confirmation_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_legal_name text;
  v_counts jsonb;
BEGIN
  SELECT "legalName" INTO v_legal_name FROM public.companies WHERE id = p_company_id;

  IF v_legal_name IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  IF lower(trim(v_legal_name)) != lower(trim(p_confirmation_name)) THEN
    RAISE EXCEPTION 'Confirmation name does not match legal name';
  END IF;

  -- Count affected child records before deletion for audit reporting
  v_counts := jsonb_build_object(
    'directors', (SELECT count(*) FROM public.directors WHERE "companyId" = p_company_id),
    'gstRegistrations', (SELECT count(*) FROM public.gst_registrations WHERE "companyId" = p_company_id),
    'msmeRegistration', (SELECT count(*) FROM public.msme_registrations WHERE "companyId" = p_company_id),
    'complianceItems', (SELECT count(*) FROM public.compliance_items WHERE "companyId" = p_company_id),
    'tasks', (SELECT count(*) FROM public.tasks WHERE "companyId" = p_company_id),
    'documents', (SELECT count(*) FROM public.documents WHERE "companyId" = p_company_id)
  );

  -- Delete company (cascades down to all child models via Prisma schema Foreign Keys)
  DELETE FROM public.companies WHERE id = p_company_id;

  RETURN v_counts;
END;
$$;
