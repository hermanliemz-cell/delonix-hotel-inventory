/**
 * Contoh lengkap pattern Pre-Validation + Optimistic Locking + Rollback
 * untuk halaman yang membuat stock movement via Supabase.
 *
 * Ini adalah template — sesuaikan nama tabel, kolom, dan logic
 * sesuai kebutuhan halaman spesifik Anda.
 */

async function handleConfirm(record) {
  setSaving(true);

  try {
    // ============================================================
    // STEP 1: OPTIMISTIC LOCKING — Atomic status transition
    // ============================================================
    const { data: locked, error: lockErr } = await supabase
      .from('documents') // ganti dengan nama tabel dokumen
      .update({
        status: 'processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id)
      .eq('status', 'draft') // hanya berhasil jika masih draft
      .select()
      .maybeSingle();

    if (lockErr) throw lockErr;
    if (!locked) {
      showNotification(
        'Dokumen sedang diproses user lain atau sudah di-confirm.',
        'error'
      );
      setSaving(false);
      return;
    }

    // ============================================================
    // STEP 2: LOAD DATA — Ambil items dan warehouse
    // ============================================================
    const { data: items } = await supabase
      .from('document_items') // ganti dengan nama tabel items
      .select('*, items(code, name)')
      .eq('document_id', record.id);

    const { data: warehouse } = await supabase
      .from('warehouses')
      .select('id, code')
      .eq('organization_id', selectedOrg.id)
      .eq('code', 'HK-STORE') // sesuaikan warehouse yang relevan
      .maybeSingle();

    // ============================================================
    // STEP 3: PRE-VALIDATION — Kumpulkan semua kebutuhan OUT
    // ============================================================
    const outRequirements = {};

    for (const item of items || []) {
      const qty = parseFloat(item.quantity);
      if (qty <= 0) continue;

      if (!outRequirements[item.item_id]) {
        outRequirements[item.item_id] = {
          itemId: item.item_id,
          totalQty: 0,
          itemLabel: item.items
            ? `${item.items.code} - ${item.items.name}`
            : item.item_id,
        };
      }
      outRequirements[item.item_id].totalQty += qty;
    }

    // Cek saldo untuk SEMUA item sekaligus
    const insufficientItems = [];

    for (const req of Object.values(outRequirements)) {
      const { data: sb } = await supabase
        .from('stock_balance')
        .select('quantity')
        .eq('organization_id', selectedOrg.id)
        .eq('item_id', req.itemId)
        .eq('warehouse_id', warehouse.id)
        .maybeSingle();

      const currentQty = sb ? parseFloat(sb.quantity) || 0 : 0;

      if (currentQty < req.totalQty) {
        insufficientItems.push(
          `${req.itemLabel} di [${warehouse.code}]: saldo=${currentQty}, diminta=${req.totalQty}`
        );
      }
    }

    // Jika ada yang kurang → ABORT sepenuhnya
    if (insufficientItems.length > 0) {
      // Revert status karena kita sudah lock di atas
      await supabase
        .from('documents')
        .update({ status: 'draft' })
        .eq('id', record.id)
        .eq('status', 'processing');

      showNotification(
        'Stok tidak cukup:\n' + insufficientItems.join('\n'),
        'error'
      );
      setSaving(false);
      return;
    }

    // ============================================================
    // STEP 4: CAPTURE COST — Ambil avg_cost SEBELUM OUT movement
    // ============================================================
    const costMap = {};
    for (const req of Object.values(outRequirements)) {
      const { data: bal } = await supabase
        .from('stock_balance')
        .select('avg_cost')
        .eq('item_id', req.itemId)
        .eq('warehouse_id', warehouse.id)
        .maybeSingle();

      costMap[req.itemId] = bal?.avg_cost || 0;
    }

    // ============================================================
    // STEP 5: CREATE MOVEMENTS — Dalam try-catch untuk rollback
    // ============================================================
    const attemptStartedAt = new Date().toISOString();

    try {
      for (const item of items || []) {
        const qty = parseFloat(item.quantity);
        if (qty <= 0) continue;

        const unitCost = costMap[item.item_id] || 0;

        // OUT movement dari source warehouse
        await supabase.from('stock_movements').insert({
          organization_id: selectedOrg.id,
          item_id: item.item_id,
          warehouse_id: warehouse.id,
          movement_type: 'out',
          quantity: qty,
          unit_cost: unitCost,
          total_cost: qty * unitCost,
          document_type: 'your_document_type', // sesuaikan
          document_id: record.id,
          notes: `OUT dari ${warehouse.code}`,
          created_at: new Date().toISOString(),
        });

        // IN movement ke destination warehouse (jika transfer)
        // await supabase.from('stock_movements').insert({...});

        // Update stock_balance via RPC atau manual
        // await supabase.rpc('recalc_balance', { ... });
      }

      // ============================================================
      // STEP 6: FINALIZE — Set status confirmed
      // ============================================================
      await supabase
        .from('documents')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', record.id);

      showNotification('Dokumen berhasil di-confirm!', 'success');
    } catch (movementErr) {
      // ============================================================
      // ROLLBACK — Bersihkan movement yang sudah dibuat
      // ============================================================
      console.error('Movement creation failed, rolling back:', movementErr);

      // Hapus movements yang dibuat setelah watermark
      await supabase
        .from('stock_movements')
        .delete()
        .eq('document_id', record.id)
        .gte('created_at', attemptStartedAt);

      // Revert status ke draft
      await supabase
        .from('documents')
        .update({ status: 'draft' })
        .eq('id', record.id)
        .eq('status', 'processing');

      // Recalculate balance jika perlu
      // await supabase.rpc('recalc_balance', { ... });

      showNotification(
        'Gagal membuat movement: ' + movementErr.message,
        'error'
      );
    }
  } catch (outerErr) {
    console.error('Confirm failed:', outerErr);
    showNotification('Error: ' + outerErr.message, 'error');
  } finally {
    setSaving(false);
  }
}
