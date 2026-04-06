-- BACKUP TRIGGER ASLI: fn_apply_stock_movement
-- Tanggal backup: 6 April 2026
-- Gunakan ini untuk ROLLBACK jika trigger fix bermasalah

CREATE OR REPLACE FUNCTION inventory.fn_apply_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'inventory', 'pg_temp'
AS $function$
DECLARE
  v_sb_id      UUID;
  v_old_qty    NUMERIC;
  v_old_avg    NUMERIC;
  v_new_qty    NUMERIC;
  v_new_avg    NUMERIC;
  v_new_total  NUMERIC;
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'stock_movements.quantity harus > 0 (got %)', NEW.quantity;
  END IF;

  SELECT id, quantity, avg_cost
    INTO v_sb_id, v_old_qty, v_old_avg
  FROM inventory.stock_balance
  WHERE organization_id = NEW.organization_id
    AND item_id         = NEW.item_id
    AND warehouse_id    = NEW.warehouse_id
  FOR UPDATE;

  v_old_qty := COALESCE(v_old_qty, 0);
  v_old_avg := COALESCE(v_old_avg, 0);

  IF NEW.movement_type = 'IN' THEN
    v_new_qty := v_old_qty + NEW.quantity;
    IF v_new_qty > 0 THEN
      v_new_avg := ((v_old_qty * v_old_avg) + (NEW.quantity * COALESCE(NEW.unit_cost, v_old_avg))) / v_new_qty;
    ELSE
      v_new_avg := 0;
    END IF;
  ELSIF NEW.movement_type = 'OUT' THEN
    v_new_qty := v_old_qty - NEW.quantity;
    IF v_new_qty < 0 THEN
      RAISE EXCEPTION 'Stok tidak cukup untuk OUT: item=% warehouse=% saldo=% diminta=%', NEW.item_id, NEW.warehouse_id, v_old_qty, NEW.quantity USING ERRCODE = 'check_violation';
    END IF;
    v_new_avg := v_old_avg;
  ELSE
    RAISE EXCEPTION 'Unknown movement_type: %', NEW.movement_type;
  END IF;

  v_new_total := v_new_qty * v_new_avg;

  IF v_sb_id IS NOT NULL THEN
    UPDATE inventory.stock_balance
       SET quantity=v_new_qty, avg_cost=v_new_avg, total_value=v_new_total,
           department_id=COALESCE(NEW.department_id, department_id),
           last_movement_at=NOW(), updated_at=NOW(), last_updated=NOW()
     WHERE id = v_sb_id;
  ELSE
    INSERT INTO inventory.stock_balance (
      organization_id, item_id, warehouse_id, department_id,
      quantity, avg_cost, total_value,
      last_movement_at, updated_at, last_updated
    ) VALUES (
      NEW.organization_id, NEW.item_id, NEW.warehouse_id, NEW.department_id,
      v_new_qty, v_new_avg, v_new_total, NOW(), NOW(), NOW()
    );
  END IF;

  NEW.balance_after := v_new_qty;
  RETURN NEW;
END;
$function$;
