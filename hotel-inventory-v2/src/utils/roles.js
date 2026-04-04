/**
 * Role-based page access mapping
 */
export const ROLE_PAGE_ACCESS = {
  superadmin: '*', // all pages
  gm: '*',
  warehouse: ['dashboard','items','categories','vendors','warehouses','stock','movements','pr','po','pi','gr','transfer','direct-purchase','opening-balance','writeoff','opname','single-usage','in-use-warehouse','reports','change-password'],
  housekeeping: ['dashboard','items','room-makeup-new','room-consumption','item-lost-in-room','rmu-activity-history','room-additional-request','rooms','room-types','bed-formations','in-use-warehouse','single-usage','movements','change-password'],
  engineering: ['dashboard','items','stock','movements','pr','single-usage','in-use-warehouse','change-password'],
  fnb: ['dashboard','items','stock','movements','pr','single-usage','in-use-warehouse','change-password'],
  frontoffice: ['dashboard','rooms','room-types','stock','movements','change-password'],
  opdir: ['dashboard','items','stock','movements','reports','rooms','room-makeup-new','room-consumption','item-lost-in-room','rmu-activity-history','room-additional-request','pr','po','pi','gr','transfer','opname','hotels','change-password'],
  branddir: ['dashboard','items','stock','movements','reports','hotels','change-password'],
  finhotel: ['dashboard','stock','movements','reports','pi','opname','writeoff','adjustment','hotels','change-password'],
  findir: ['dashboard','stock','movements','reports','pi','hotels','approval','opname','adjustment','change-password'],
  depthead: ['dashboard','items','stock','movements','pr','single-usage','change-password'],
  finstaff: ['dashboard','stock','movements','reports','change-password'],
  viewer: ['dashboard','stock','movements','reports','change-password'],
};

/**
 * Check if a role can access a specific page
 */
export function canAccessPage(roleCode, pageId, rolePermissions) {
  if (!roleCode) return false;
  // change-password is always accessible to any logged-in user
  if (pageId === 'change-password') return true;
  // If role has dynamic permissions from DB, use those
  if (rolePermissions) {
    // { all: true } means full access
    if (rolePermissions.all === true) return true;
    // Check menu_access
    if (rolePermissions.menu_access) {
      return !!rolePermissions.menu_access[pageId];
    }
    // If permissions object exists but no menu_access and not all:true, deny everything
    return false;
  }
  // Fallback to hardcoded ROLE_PAGE_ACCESS for roles without DB permissions
  const access = ROLE_PAGE_ACCESS[roleCode];
  if (!access) return false;
  if (access === '*') return true;
  return access.includes(pageId);
}
