import React from 'react';

interface PlusCircleIconProps {
  className?: string;
}

export const PlusCircleIcon: React.FC<PlusCircleIconProps> = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={`h-4 w-4 ${className}`}
    fill="none" 
    viewBox="0 0 24 24" 
    stroke="currentColor" 
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);