import React from 'react';
import { Badge } from './FormElements';
import { useTranslation } from '../hooks/useTranslation';

export function StatusBadge({ status }) {
  const { t } = useTranslation();
  const map = {
    DRAFT: { color: 'gray', label: t('status.draft') },
    PENDING: { color: 'yellow', label: t('status.pending') },
    SUBMITTED: { color: 'blue', label: t('status.submitted') },
    APPROVED: { color: 'green', label: t('status.approved') },
    REJECTED: { color: 'red', label: t('status.rejected') },
    CANCELLED: { color: 'gray', label: t('status.cancelled') },
    CONVERTED: { color: 'purple', label: t('status.converted') },
    SENT: { color: 'blue', label: t('status.sent') },
    PARTIAL: { color: 'yellow', label: t('status.partial') },
    RECEIVED: { color: 'green', label: t('status.received') },
    IN_PROGRESS: { color: 'yellow', label: t('status.inProgress') },
    COMPLETED: { color: 'green', label: t('status.completed') },
    CONFIRMED: { color: 'green', label: t('status.confirmed') || 'Confirmed' },
    PROCESSING: { color: 'orange', label: 'Processing...' },
    COUNTING: { color: 'orange', label: t('opname.statusCounting') || 'Counting' },
  };
  const s = map[status] || { color: 'gray', label: status };
  return <Badge color={s.color}>{s.label}</Badge>;
}
