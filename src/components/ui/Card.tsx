import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  accentColor?: string;
}

export default function Card({ children, className = '', accentColor }: CardProps) {
  const style = accentColor
    ? { borderTopColor: accentColor, borderTopWidth: 3 }
    : {};

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-5 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
