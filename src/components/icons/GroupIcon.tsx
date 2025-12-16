import React from 'react';

const commonSvgProps = {
  className: "h-8 w-8",
  viewBox: "0 0 32 32",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2"
};

export const GroupIcon: React.FC = () => (
  <svg {...commonSvgProps}>
    {/* First Note */}
    <ellipse cx="8" cy="24" rx="4.5" ry="3.5" fill="currentColor" transform="rotate(-20 8 24)" stroke="none" />
    <line x1="12" y1="23" x2="12" y2="8" strokeWidth="2" />
    {/* Second Note */}
    <ellipse cx="20" cy="24" rx="4.5" ry="3.5" fill="currentColor" transform="rotate(-20 20 24)" stroke="none" />
    <line x1="24" y1="23" x2="24" y2="8" strokeWidth="2" />
    {/* Beam */}
    <rect x="12" y="6" width="12" height="4" fill="currentColor" stroke="none" />
  </svg>
);
