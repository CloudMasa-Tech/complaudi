-- ============================================================================
-- Supabase Row Level Security (RLS) & Multi-Tenant Isolation Policies
--
-- This script enables RLS on all tenant-sensitive application tables and defines
-- strict, non-bypassable security policies.
-- ============================================================================

-- ── 1. Security Helper Functions ───────────────────────────────────────────────

-- Returns the organizationId of the authenticated caller (from public.users profile)
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid();
$$;

-- Returns true if the authenticated caller has access to the specified company
CREATE OR REPLACE FUNCTION public.has_company_access(target_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND (
        (u.role IN ('SUPER_ADMIN', 'ADMIN') AND u.organization_id = (SELECT organization_id FROM public.companies WHERE id = target_company_id))
        OR EXISTS (
          SELECT 1 FROM public.company_memberships cm 
          WHERE cm.user_id = u.id 
            AND cm.company_id = target_company_id
        )
      )
  );
$$;

-- Returns true if the caller is a SUPER_ADMIN or ADMIN in their organization
CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() 
      AND is_active = true 
      AND role IN ('SUPER_ADMIN', 'ADMIN')
  );
$$;

-- ── 2. Table RLS Activation & Policy Definitions ─────────────────────────────

-- 2.1 Organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own organization"
  ON public.organizations FOR SELECT
  USING (id = public.current_user_org_id());

-- 2.2 Users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view members in their organization"
  ON public.users FOR SELECT
  USING (organization_id = public.current_user_org_id());

CREATE POLICY "Admins can update users in their organization"
  ON public.users FOR UPDATE
  USING (organization_id = public.current_user_org_id() AND public.is_org_admin());

-- 2.3 Companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view companies they hold access to"
  ON public.companies FOR SELECT
  USING (organization_id = public.current_user_org_id() AND public.has_company_access(id));

CREATE POLICY "Admins can insert companies in their organization"
  ON public.companies FOR INSERT
  WITH CHECK (organization_id = public.current_user_org_id() AND public.is_org_admin());

CREATE POLICY "Users with edit capability can update their companies"
  ON public.companies FOR UPDATE
  USING (organization_id = public.current_user_org_id() AND public.has_company_access(id));

CREATE POLICY "Admins can delete companies in their organization"
  ON public.companies FOR DELETE
  USING (organization_id = public.current_user_org_id() AND public.is_org_admin());

-- 2.4 Company Memberships
ALTER TABLE public.company_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view company memberships in their organization"
  ON public.company_memberships FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c 
      WHERE c.id = company_id AND c.organization_id = public.current_user_org_id()
    )
  );

CREATE POLICY "Admins can manage company memberships"
  ON public.company_memberships FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c 
      WHERE c.id = company_id AND c.organization_id = public.current_user_org_id()
    ) AND public.is_org_admin()
  );

-- 2.5 Directors
ALTER TABLE public.directors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view directors of granted companies"
  ON public.directors FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users with access can manage directors"
  ON public.directors FOR ALL
  USING (public.has_company_access(company_id));

-- 2.6 GST Registrations
ALTER TABLE public.gst_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view GST registrations of granted companies"
  ON public.gst_registrations FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users with access can manage GST registrations"
  ON public.gst_registrations FOR ALL
  USING (public.has_company_access(company_id));

-- 2.7 MSME Registrations
ALTER TABLE public.msme_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view MSME registrations of granted companies"
  ON public.msme_registrations FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users with access can manage MSME registrations"
  ON public.msme_registrations FOR ALL
  USING (public.has_company_access(company_id));

-- 2.8 Compliance Items (Calendar)
ALTER TABLE public.compliance_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view compliance items of granted companies"
  ON public.compliance_items FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users with access can update compliance items"
  ON public.compliance_items FOR UPDATE
  USING (public.has_company_access(company_id));

-- 2.9 Tasks
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tasks of granted companies"
  ON public.tasks FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users with access can manage tasks"
  ON public.tasks FOR ALL
  USING (public.has_company_access(company_id));

-- 2.10 Documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view documents of granted companies"
  ON public.documents FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users with access can upload or delete documents"
  ON public.documents FOR ALL
  USING (public.has_company_access(company_id));

-- 2.11 Notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid());

-- 2.12 Audit Logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs of their organization"
  ON public.audit_logs FOR SELECT
  USING (organization_id = public.current_user_org_id() AND public.is_org_admin());

-- 2.13 Payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payments in their organization"
  ON public.payments FOR SELECT
  USING (organization_id = public.current_user_org_id());

-- 2.14 Compliance Score Snapshots
ALTER TABLE public.compliance_score_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view score snapshots of granted companies"
  ON public.compliance_score_snapshots FOR SELECT
  USING (public.has_company_access(company_id));
