-- AirWatch Client Management Schema (additive migration)
-- Run AFTER schema.sql in Supabase SQL Editor

-- 1. Extend organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address TEXT;
-- is_active already exists, we use it as status (true=active, false=inactive)

-- 2. Extend profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
-- Expand role constraint to include new roles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('super_admin', 'admin', 'manager', 'viewer', 'client_viewer', 'client_editor'));

-- 3. station_assignments table
-- Maps which client orgs can access which stations
CREATE TABLE IF NOT EXISTS station_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    assigned_by UUID REFERENCES profiles(id),
    UNIQUE(organization_id, station_id)
);
CREATE INDEX IF NOT EXISTS idx_station_assignments_org ON station_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_station_assignments_station ON station_assignments(station_id);

-- 4. client_permissions table
CREATE TABLE IF NOT EXISTS client_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    station_id UUID REFERENCES stations(id) ON DELETE CASCADE,  -- NULL = applies to all stations
    permission_type TEXT NOT NULL,  -- 'visible_parameters', 'page_access', 'report_access', 'data_access', 'dashboard_access'
    permission_value JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(organization_id, station_id, permission_type)
);
CREATE INDEX IF NOT EXISTS idx_client_perms_org ON client_permissions(organization_id);

-- 5. RLS for new tables
ALTER TABLE station_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_permissions ENABLE ROW LEVEL SECURITY;

-- station_assignments: admins manage all, users see their org's
DROP POLICY IF EXISTS "Admins manage station_assignments" ON station_assignments;
CREATE POLICY "Admins manage station_assignments" ON station_assignments
    FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "Users see own station_assignments" ON station_assignments;
CREATE POLICY "Users see own station_assignments" ON station_assignments
    FOR SELECT USING (organization_id = get_user_org_id());

-- client_permissions: admins manage all, users see their own org
DROP POLICY IF EXISTS "Admins manage client_permissions" ON client_permissions;
CREATE POLICY "Admins manage client_permissions" ON client_permissions
    FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "Users see own client_permissions" ON client_permissions;
CREATE POLICY "Users see own client_permissions" ON client_permissions
    FOR SELECT USING (organization_id = get_user_org_id());

-- 6. Update stations RLS to include station_assignments access
-- Clients can see stations assigned to their org (even if org_id != their org_id)
DROP POLICY IF EXISTS "Users see own org stations" ON stations;
CREATE POLICY "Users see assigned stations" ON stations
    FOR SELECT USING (
        org_id = get_user_org_id()
        OR id IN (
            SELECT station_id FROM station_assignments
            WHERE organization_id = get_user_org_id()
        )
    );

-- 7. Update readings RLS similarly
DROP POLICY IF EXISTS "Users see own station readings" ON readings;
CREATE POLICY "Users see assigned readings" ON readings
    FOR SELECT USING (
        station_id IN (
            SELECT id FROM stations WHERE org_id = get_user_org_id()
            UNION
            SELECT station_id FROM station_assignments WHERE organization_id = get_user_org_id()
        )
    );

-- 8. Default permissions for new client orgs (inserted when creating an org via API)
-- These are defaults - can be overridden per station
-- No rows needed here, the API handles inserting defaults

-- 9. Trigger: update updated_at on client_permissions
DROP TRIGGER IF EXISTS tr_client_perms_updated ON client_permissions;
CREATE TRIGGER tr_client_perms_updated BEFORE UPDATE ON client_permissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
