-- Fix RLS policies: grant full access to anon and authenticated roles
-- on all inventory tables with RLS enabled
-- Executed on 2026-03-25 via Supabase SQL Editor

-- vendors
DROP POLICY IF EXISTS anon_read ON inventory.vendors;
DROP POLICY IF EXISTS authenticated_access ON inventory.vendors;
CREATE POLICY anon_full_access ON inventory.vendors FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY auth_full_access ON inventory.vendors FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- purchase_requests
DROP POLICY IF EXISTS anon_read ON inventory.purchase_requests;
DROP POLICY IF EXISTS authenticated_access ON inventory.purchase_requests;
CREATE POLICY anon_full_access ON inventory.purchase_requests FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY auth_full_access ON inventory.purchase_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- purchase_orders
DROP POLICY IF EXISTS anon_read ON inventory.purchase_orders;
DROP POLICY IF EXISTS authenticated_access ON inventory.purchase_orders;
CREATE POLICY anon_full_access ON inventory.purchase_orders FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY auth_full_access ON inventory.purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- organizations
DROP POLICY IF EXISTS anon_read ON inventory.organizations;
DROP POLICY IF EXISTS authenticated_access ON inventory.organizations;
CREATE POLICY anon_full_access ON inventory.organizations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY auth_full_access ON inventory.organizations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- departments
DROP POLICY IF EXISTS anon_read ON inventory.departments;
DROP POLICY IF EXISTS authenticated_access ON inventory.departments;
CREATE POLICY anon_full_access ON inventory.departments FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY auth_full_access ON inventory.departments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- users
DROP POLICY IF EXISTS anon_read ON inventory.users;
DROP POLICY IF EXISTS authenticated_access ON inventory.users;
CREATE POLICY anon_full_access ON inventory.users FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY auth_full_access ON inventory.users FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- stock_opname
DROP POLICY IF EXISTS anon_read ON inventory.stock_opname;
DROP POLICY IF EXISTS authenticated_access ON inventory.stock_opname;
CREATE POLICY anon_full_access ON inventory.stock_opname FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY auth_full_access ON inventory.stock_opname FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- write_offs
DROP POLICY IF EXISTS anon_read ON inventory.write_offs;
DROP POLICY IF EXISTS authenticated_access ON inventory.write_offs;
CREATE POLICY anon_full_access ON inventory.write_offs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY auth_full_access ON inventory.write_offs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- items
DROP POLICY IF EXISTS anon_read ON inventory.items;
DROP POLICY IF EXISTS authenticated_access ON inventory.items;
CREATE POLICY anon_full_access ON inventory.items FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY auth_full_access ON inventory.items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- stock_balance
DROP POLICY IF EXISTS anon_read ON inventory.stock_balance;
DROP POLICY IF EXISTS authenticated_access ON inventory.stock_balance;
CREATE POLICY anon_full_access ON inventory.stock_balance FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY auth_full_access ON inventory.stock_balance FOR ALL TO authenticated USING (true) WITH CHECK (true);
