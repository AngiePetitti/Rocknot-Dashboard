'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import CleoChat from './CleoChat';

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            aria-label="Open menu"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect y="2" width="18" height="2" rx="1" fill="currentColor"/>
              <rect y="8" width="18" height="2" rx="1" fill="currentColor"/>
              <rect y="14" width="18" height="2" rx="1" fill="currentColor"/>
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="ROCKNOT"
                className="w-full h-full object-cover"
                onError={e => {
                  e.currentTarget.style.display = 'none';
                  (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty('display');
                }}
              />
              <span style={{ display: 'none' }} className="text-white font-bold text-xs">R</span>
            </div>
            <span className="font-bold text-gray-900 text-sm tracking-wide">ROCKNOT</span>
          </div>
        </div>

        <div className="p-4 md:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* Cleo — AI analyst chat, available on every tab */}
      <CleoChat />
    </div>
  );
}
