import { Suspense } from 'react';
import InventoryContent from './InventoryContent';

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <InventoryContent />
    </Suspense>
  );
}
