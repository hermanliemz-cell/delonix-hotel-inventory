-- Add warehouse_id column to write_offs table
-- Run this in Supabase SQL Editor before using the updated WriteOffPage

ALTER TABLE write_offs
ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);

-- Optional: add index for performance
CREATE INDEX IF NOT EXISTS idx_write_offs_warehouse_id ON write_offs(warehouse_id);
