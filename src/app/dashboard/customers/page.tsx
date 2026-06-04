import { Suspense } from 'react';
import CustomersContent from './CustomersContent';

export default function CustomersPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <CustomersContent />
    </Suspense>
  );
}
