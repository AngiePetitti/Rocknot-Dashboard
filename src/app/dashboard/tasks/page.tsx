import { Suspense } from 'react';
import TasksContent from './TasksContent';

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <TasksContent />
    </Suspense>
  );
}
