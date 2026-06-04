'use client';

import { CohortData } from '@/src/lib/mockData';

interface CustomerCohortProps {
  data: CohortData[];
}

function getColor(value: number): string {
  if (value === 0) return '#f8fafc';
  if (value === 100) return '#c4b5fd';
  if (value >= 30) return '#ddd6fe';
  if (value >= 20) return '#ede9fe';
  if (value >= 15) return '#f5f3ff';
  return '#fdf4ff';
}

function getTextColor(value: number): string {
  if (value === 0) return '#e2e8f0';
  return '#4b5563';
}

export default function CustomerCohort({ data }: CustomerCohortProps) {
  const months = ['Month 0', 'Month 1', 'Month 2', 'Month 3', 'Month 4', 'Month 5'];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left text-gray-500 font-semibold pb-2 pr-4 whitespace-nowrap">
              Cohort
            </th>
            {months.map(m => (
              <th key={m} className="text-center text-gray-400 font-medium pb-2 px-2 whitespace-nowrap">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const values = [row.month0, row.month1, row.month2, row.month3, row.month4, row.month5];
            return (
              <tr key={row.cohort}>
                <td className="pr-4 py-1 font-semibold text-gray-700 whitespace-nowrap">
                  {row.cohort}
                </td>
                {values.map((v, i) => (
                  <td key={i} className="px-2 py-1 text-center">
                    <span
                      className="inline-block w-14 py-1.5 rounded-lg font-semibold text-xs"
                      style={{
                        backgroundColor: getColor(v),
                        color: getTextColor(v),
                      }}
                    >
                      {v === 0 ? '—' : `${v}%`}
                    </span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
