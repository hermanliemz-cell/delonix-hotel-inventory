# Extracted Page Components

This directory contains 12 master page components extracted from the hotel inventory management system.

## Global Master Pages
1. **HotelsPage.jsx** (374 lines) - Hotel/organization management
2. **ItemsPage.jsx** (874 lines) - Master item catalog with import/export features
3. **CategoriesPage.jsx** (240 lines) - Item category management
4. **VendorsPage.jsx** (106 lines) - Vendor management
5. **DepartmentsPage.jsx** (151 lines) - Department management

## Hotel Master Pages
6. **WarehousesPage.jsx** (191 lines) - Warehouse management
7. **RoomTypesPage.jsx** (142 lines) - Room type configuration
8. **BedFormationsPage.jsx** (854 lines) - Bed formation setup with nested modals
9. **RoomsPage.jsx** (3182 lines) - Room management (largest page)

## Operations Pages
10. **WriteOffPage.jsx** (1866 lines) - Stock write-off operations
11. **ReportsPage.jsx** (525 lines) - Business reports and analytics

## Settings Pages
12. **ChangePasswordPage.jsx** (99 lines) - User password management

## All Pages Include
- ES module imports (React, hooks, services)
- Supabase integration
- Translation support via useTranslation hook
- App context via useApp hook
- Utility functions for formatting
- Component imports (Modal, Button, Icons, etc.)
- Tailwind CSS classes (preserved exactly)
- Proper export statements

## Notes
- Some pages contain nested helper components (e.g., PeriodLocksManagement in HotelsPage)
- Large pages like RoomsPage (3182 lines) contain complete feature implementations
- All console.log statements have been removed; console.error statements preserved
- No organization_id filters were missing in critical queries
- All Tailwind classes preserved exactly as-is
