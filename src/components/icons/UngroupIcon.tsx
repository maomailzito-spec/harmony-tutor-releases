import React from 'react';

type IconProps = {
  className?: string;
};

const commonSvgProps = {
  className: "h-5 w-5",
  viewBox: "0 0 32 32",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2"
};

export const UngroupIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...commonSvgProps} className={className ?? commonSvgProps.className}>
    {/* First Note with Flag */}
    <ellipse cx="8" cy="24" rx="4.5" ry="3.5" fill="currentColor" transform="rotate(-20 8 24)" stroke="none" />
    <line x1="12" y1="23" x2="12" y2="8" strokeWidth="2" />
    <path d="M12 8 C 17 9, 17 12, 16 15" strokeWidth="2.5" />
    
    {/* Second Note with Flag */}
    <ellipse cx="20" cy="24" rx="4.5" ry="3.5" fill="currentColor" transform="rotate(-20 20 24)" stroke="none" />
    <line x1="24" y1="23" x2="24" y2="8" strokeWidth="2" />
    <path d="M24 8 C 29 9, 29 12, 28 15" strokeWidth="2.5" />
  </svg>
);
