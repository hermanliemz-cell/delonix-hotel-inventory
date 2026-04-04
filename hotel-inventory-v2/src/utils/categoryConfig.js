export const CATEGORY_STATUS_CONFIG = {
  LIN: {
    statuses: ['in_stock', 'in_use', 'dirty', 'in_laundry', 'damaged'],
    labels: { in_stock: 'ob.inStock', in_use: 'ob.inUse', dirty: 'ob.dirty', in_laundry: 'ob.inLaundry', damaged: 'ob.damaged' }
  },
  FA: {
    statuses: ['good', 'fair', 'poor', 'damaged'],
    labels: { good: 'ob.good', fair: 'ob.fair', poor: 'ob.poor', damaged: 'ob.damaged' }
  },
  MCH: {
    statuses: ['operational', 'maintenance', 'broken'],
    labels: { operational: 'ob.operational', maintenance: 'ob.maintenance', broken: 'ob.broken' }
  },
  DEFAULT: {
    statuses: ['on_hand'],
    labels: { on_hand: 'ob.qtyOnHand' }
  }
};

export function getCategoryConfig(categoryCode) {
  return CATEGORY_STATUS_CONFIG[categoryCode] || CATEGORY_STATUS_CONFIG.DEFAULT;
}

// Warehouse type mapping for linen category
export const LINEN_STATUS_WAREHOUSE_MAP = {
  in_stock: 'store',
  in_use: 'room',
  dirty: 'dirty',
  in_laundry: 'laundry',
  damaged: 'damage'
};
