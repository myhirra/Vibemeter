export const dynamic = 'force-dynamic';

import { FloatingWidget } from '@/components/FloatingWidget';
import { getFloatStats } from '@/lib/float-stats';

export default async function FloatPage() {
  const stats = await getFloatStats();
  return <FloatingWidget initialStats={stats} />;
}
