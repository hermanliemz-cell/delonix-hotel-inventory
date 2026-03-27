-- ============================================================
-- Migration: Add status workflow to single_item_usage table
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add status column (DRAFT / CONFIRMED)
ALTER TABLE inventory.single_item_usage
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'DRAFT';

-- Add confirmed_by and confirmed_at columns
ALTER TABLE inventory.single_item_usage
ADD COLUMN IF NOT EXISTS confirmed_by UUID;

ALTER TABLE inventory.single_item_usage
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- Update existing records to CONFIRMED (since they already deducted stock)
UPDATE inventory.single_item_usage
SET status = 'CONFIRMED', confirmed_by = created_by, confirmed_at = created_at
WHERE status IS NULL OR status = 'DRAFT';

-- Add RLS policy for the new columns (if needed)
-- The existing permissive policies should already cover this

SELECT 'Migration completed successfully' as result;
