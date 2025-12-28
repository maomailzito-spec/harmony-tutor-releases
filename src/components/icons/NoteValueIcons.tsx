
import React from 'react';

type IconProps = {
  className?: string;
};

const commonSvgProps = (className?: string) => ({
  className: className ?? "h-8 w-8",
  viewBox: "0 0 32 32",
  fill: "currentColor",
});

export const WholeNoteIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...commonSvgProps(className)}>
    <ellipse cx="16" cy="18" rx="8" ry="6" stroke="currentColor" strokeWidth="2" fill="none" transform="rotate(-20 16 18)" />
  </svg>
);

export const HalfNoteIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...commonSvgProps(className)}>
    <ellipse cx="12" cy="24" rx="6" ry="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" transform="rotate(-20 12 24)" />
    <line x1="17.5" y1="22.5" x2="17.5" y2="4" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const QuarterNoteIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...commonSvgProps(className)}>
    <ellipse cx="12" cy="24" rx="6" ry="4.5" fill="currentColor" transform="rotate(-20 12 24)" />
    <line x1="17.5" y1="22.5" x2="17.5" y2="4" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const EighthNoteIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...commonSvgProps(className)}>
    <ellipse cx="12" cy="24" rx="6" ry="4.5" fill="currentColor" transform="rotate(-20 12 24)" />
    <line x1="17.5" y1="22.5" x2="17.5" y2="4" stroke="currentColor" strokeWidth="2" />
    <path d="M17.5 4 C 24 6, 24 10, 22 14" stroke="currentColor" strokeWidth="2.5" fill="none" />
  </svg>
);

export const SixteenthNoteIcon: React.FC<IconProps> = ({ className }) => (
    <svg {...commonSvgProps(className)}>
      <ellipse cx="12" cy="24" rx="6" ry="4.5" fill="currentColor" transform="rotate(-20 12 24)" />
      <line x1="17.5" y1="22.5" x2="17.5" y2="4" stroke="currentColor" strokeWidth="2" />
      <path d="M17.5 4 C 24 6, 24 10, 22 14" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <path d="M17.5 9 C 24 11, 24 15, 22 19" stroke="currentColor" strokeWidth="2.5" fill="none" />
    </svg>
);

export const ThirtySecondNoteIcon: React.FC<IconProps> = ({ className }) => (
    <svg {...commonSvgProps(className)}>
      <ellipse cx="12" cy="24" rx="6" ry="4.5" fill="currentColor" transform="rotate(-20 12 24)" />
      <line x1="17.5" y1="22.5" x2="17.5" y2="4" stroke="currentColor" strokeWidth="2" />
      <path d="M17.5 4 C 24 6, 24 10, 22 14" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <path d="M17.5 9 C 24 11, 24 15, 22 19" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <path d="M17.5 14 C 24 16, 24 20, 22 24" stroke="currentColor" strokeWidth="2.5" fill="none" />
    </svg>
);

export const SixtyFourthNoteIcon: React.FC<IconProps> = ({ className }) => (
    <svg {...commonSvgProps(className)}>
      <ellipse cx="12" cy="24" rx="6" ry="4.5" fill="currentColor" transform="rotate(-20 12 24)" />
      <line x1="17.5" y1="22.5" x2="17.5" y2="4" stroke="currentColor" strokeWidth="2" />
      <path d="M17.5 4 C 24 6, 24 10, 22 14" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M17.5 8 C 24 10, 24 14, 22 18" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M17.5 12 C 24 14, 24 18, 22 22" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M17.5 16 C 24 18, 24 22, 22 26" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
);

// --- REST ICONS ---

const restSvgProps = (className?: string) => ({
  className: className ?? "h-8 w-8",
  viewBox: "0 0 32 32",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2.5",
});

export const WholeRestIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...restSvgProps(className)} fill="currentColor" stroke="none">
    <rect x="8" y="10" width="16" height="6" />
  </svg>
);

export const HalfRestIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...restSvgProps(className)} fill="currentColor" stroke="none">
    <rect x="8" y="16" width="16" height="6" />
  </svg>
);

export const QuarterRestIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...restSvgProps(className)}>
    <path d="M13 8 l3 4 l-4 4 l5 5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const EighthRestIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...restSvgProps(className)} strokeWidth="2">
    <circle cx="18" cy="11" r="4" fill="currentColor" stroke="none" />
    <path d="M18 11 A 6 6 0 0 1 12 17 L 12 25" strokeLinecap="round" />
  </svg>
);

export const SixteenthRestIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...restSvgProps(className)} strokeWidth="2">
     <path d="M19 8 A 6 6 0 0 1 13 14 L 13 26" strokeLinecap="round" />
     <circle cx="19" cy="8" r="4" fill="currentColor" stroke="none"/>
     <path d="M19 14 A 6 6 0 0 1 13 20" strokeLinecap="round" />
     <circle cx="19" cy="14" r="4" fill="currentColor" stroke="none"/>
  </svg>
);

export const ThirtySecondRestIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...restSvgProps(className)} strokeWidth="2">
     <path d="M20 5 A 6 6 0 0 1 14 11 L 14 28" strokeLinecap="round" />
     <circle cx="20" cy="5" r="4" fill="currentColor" stroke="none"/>
     <path d="M20 11 A 6 6 0 0 1 14 17" strokeLinecap="round" />
     <circle cx="20" cy="11" r="4" fill="currentColor" stroke="none"/>
     <path d="M20 17 A 6 6 0 0 1 14 23" strokeLinecap="round" />
     <circle cx="20" cy="17" r="4" fill="currentColor" stroke="none"/>
  </svg>
);

export const SixtyFourthRestIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...restSvgProps(className)} strokeWidth="2">
     <path d="M21 2 A 5 5 0 0 1 16 7 L 16 30" strokeLinecap="round" />
     <circle cx="21" cy="2" r="3.5" fill="currentColor" stroke="none"/>
     <path d="M21 8 A 5 5 0 0 1 16 13" strokeLinecap="round" />
     <circle cx="21" cy="8" r="3.5" fill="currentColor" stroke="none"/>
     <path d="M21 14 A 5 5 0 0 1 16 19" strokeLinecap="round" />
     <circle cx="21" cy="14" r="3.5" fill="currentColor" stroke="none"/>
     <path d="M21 20 A 5 5 0 0 1 16 25" strokeLinecap="round" />
     <circle cx="21" cy="20" r="3.5" fill="currentColor" stroke="none"/>
  </svg>
);

// Triplet Icon
export const TripletIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className ?? "h-8 w-8"} viewBox="0 0 32 32">
        <text x="16" y="20" fontSize="16" textAnchor="middle" fill="currentColor" fontWeight="bold">3</text>
    </svg>
);

// Tie Icon
export const TieIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className ?? "h-8 w-8"} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M8 20 Q 16 10, 24 20" />
    </svg>
);

// Dotted Note Icon
export const DotIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className ?? "h-8 w-8"} viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="4" fill="currentColor" />
    </svg>
);


// Accidental Icons
export const SharpIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className ?? "h-8 w-8"} viewBox="0 0 32 32" stroke="currentColor" fill="none" strokeWidth="2.5">
        <path d="M13 5 L11 27 M19 5 L17 27 M7 13 L24 11 M8 19 L25 17" strokeLinecap="round"/>
    </svg>
);

export const DoubleSharpIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className ?? "h-8 w-8"} viewBox="0 0 32 32">
        <text x="16" y="18" fontSize="24" textAnchor="middle" dominantBaseline="central" fill="currentColor">𝄪</text>
    </svg>
);

export const FlatIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className ?? "h-8 w-8"} viewBox="0 0 32 32" stroke="currentColor" fill="none" strokeWidth="2.5">
        <path d="M12 5 V 27 C 12 27, 12 17, 20 17 C 28 17, 28 25, 20 25 C 12 25, 12 21, 12 21" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

export const DoubleFlatIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className ?? "h-8 w-8"} viewBox="0 0 32 32">
        <text x="16" y="18" fontSize="28" textAnchor="middle" dominantBaseline="central" fill="currentColor">♭♭</text>
    </svg>
);

export const NaturalIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className ?? "h-8 w-8"} viewBox="0 0 32 32" stroke="currentColor" fill="none" strokeWidth="2.5">
        <path d="M12 7 L12 25 M18 5 L18 23 M9 13 L18 13 M12 19 L21 19" strokeLinecap="round"/>
    </svg>
);