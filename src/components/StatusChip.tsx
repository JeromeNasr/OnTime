import React from 'react';

interface StatusChipProps {
  status: string;
  className?: string;
}

export function formatStatus(status: string): { label: string; className: string } {
  const s = status ? status.toUpperCase() : '';
  switch (s) {
    case 'DELIVERED':
      return { label: 'Delivered', className: 'bg-[#22c55e]/15 text-[#22c55e]' };
    case 'CANCELLED':
      return { label: 'Cancelled', className: 'bg-[#ef4444]/15 text-[#ef4444]' };
    case 'IN_TRANSIT':
      return { label: 'In Transit', className: 'bg-[#3b82f6]/15 text-[#3b82f6]' };
    case 'PICKED_UP':
      return { label: 'Picked Up', className: 'bg-[#3b82f6]/15 text-[#3b82f6]' };
    case 'EN_ROUTE_DELIVERY':
      return { label: 'En Route', className: 'bg-[#3b82f6]/15 text-[#3b82f6]' };
    case 'EN_ROUTE_PICKUP':
    case 'DRIVER_EN_ROUTE_PICKUP':
      return { label: 'To Pickup', className: 'bg-[#3b82f6]/15 text-[#3b82f6]' };
    case 'ARRIVED_PICKUP':
      return { label: 'At Pickup', className: 'bg-[#f59e0b]/15 text-[#f59e0b]' };
    case 'ARRIVED_DESTINATION':
      return { label: 'At Destination', className: 'bg-[#f59e0b]/15 text-[#f59e0b]' };
    case 'ASSIGNED':
      return { label: 'Assigned', className: 'bg-[#3b82f6]/15 text-[#3b82f6]' };
    case 'AVAILABLE':
      return { label: 'Available', className: 'bg-[#22c55e]/15 text-[#22c55e]' };
    case 'ONLINE':
      return { label: 'Online', className: 'bg-[#22c55e]/15 text-[#22c55e]' };
    case 'OFFLINE':
      return { label: 'Offline', className: 'bg-[#ef4444]/15 text-[#ef4444]' };
    case 'BUSY':
      return { label: 'Busy', className: 'bg-[#f59e0b]/15 text-[#f59e0b]' };
    case 'PAUSED':
      return { label: 'Paused', className: 'bg-[#f59e0b]/15 text-[#f59e0b]' };
    case 'CREATED':
    default:
      return { label: 'Created', className: 'bg-white/10 text-white/70' };
  }
}

export const StatusChip: React.FC<StatusChipProps> = ({ status, className = '' }) => {
  const { label, className: colorClass } = formatStatus(status);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${colorClass} ${className}`}
    >
      {label}
    </span>
  );
};
