import React from 'react';

const QuarterRestIcon = ({ x = 0, y = 0, width, height }: { x?: number, y?: number, width?: number, height?: number, color?: string }) => (
  <svg 
    x={x} 
    y={y} 
    width={width || 25} 
    height={height || 75} 
    viewBox="50 0 450 450"
    preserveAspectRatio="xMidYMid meet"
    fill="currentColor"
  >
    <path
      d="M118 56c-34 92-114 117-114 203 0 88 72 136 138 136 87 0 128-66 128-132 0-82-96-125-138-232-10-26-25-32-38-32-15 0-20 10-24 21-12 36-23 74-23 115 0 54 30 80 68 80 43 0 68-35 68-80 0-40-23-86-45-136-17-41-15-58 13-58 20 0 34 16 34 38 0 23-14 58-14 58s-2 3-5 3c-4 0-5-3-5-3s-26-70-26-96c0-42 45-81 92-81 53 0 94 45 94 98 0 81-70 158-159 271-12 15-28 21-47 21-25 0-46-12-58-35-24-48-31-101-31-140 0-72 49-141 127-141 53 0 88 33 103 80 2 6 2 11 2 11s2-8 17-48c10-26 28-44 51-44 32 0 54 26 54 57z"
    />
  </svg>
);

export default QuarterRestIcon;