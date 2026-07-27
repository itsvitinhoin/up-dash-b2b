type DashboardConversionRateParams = {
  isB2C: boolean;
  orders: number;
  visits: number;
  approvedLeads: number;
};

export function calculateDashboardConversionRate({
  isB2C,
  orders,
  visits,
  approvedLeads,
}: DashboardConversionRateParams): number {
  const denominator = isB2C ? visits : approvedLeads;
  if (denominator <= 0) return 0;

  return Math.min(100, Math.max(0, (orders / denominator) * 100));
}
