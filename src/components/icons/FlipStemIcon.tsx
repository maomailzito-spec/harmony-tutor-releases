import React from 'react';

type IconProps = {
  className?: string;
};

export const FlipStemIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className ?? "h-8 w-8"} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {/* Note */}
    <ellipse cx="12" cy="24" rx="4" ry="3" fill="currentColor" stroke="none" transform="rotate(-20 12 24)" />
    <line x1="15.5" y1="23" x2="15.5" y2="8" />
    {/* Arrow */}
    <path d="M25,12 A 6,6 0 1,1 25,20" />
    <path d="M25 8 L 25 12 L 21 12" />
    <path d="M25 24 L 25 20 L 29 20" />
  </svg>
);
