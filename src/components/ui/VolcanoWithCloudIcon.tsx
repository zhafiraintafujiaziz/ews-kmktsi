import type React from 'react';

export const VolcanoWithCloudIcon: React.FC<{ size?: string | number; className?: string; style?: React.CSSProperties }> = ({
  size = '20px',
  className,
  style,
}) => (
  <svg
    viewBox="0 0 32 32"
    width={size}
    height={size}
    className={className}
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Ash Cloud (Awan Abu Vulkanik Membumbung) */}
    <path
      d="M16 2.5C13.6 2.5 11.7 4.2 11.4 6.5C9.7 6.8 8.5 8.3 8.5 10.1C8.5 12.2 10.2 13.8 12.3 13.8H20.7C22.8 13.8 24.5 12.2 24.5 10.1C24.5 8.4 23.3 7 21.6 6.6C21.3 4.3 19.4 2.5 16 2.5Z"
      fill="#475569"
    />
    <path
      d="M13.5 5C14.5 4 16.5 4 17.5 5C18.5 6 18 7.5 18 8.5H13C13 7.3 12.8 5.7 13.5 5Z"
      fill="#94a3b8"
    />
    {/* Glowing particles / bara debu */}
    <circle cx="16" cy="6.5" r="1.2" fill="#f97316" />
    <circle cx="19" cy="8" r="1" fill="#f59e0b" />
    <circle cx="13" cy="9" r="0.9" fill="#ea580c" />
    {/* Volcano Mountain Cone (Gunung Api) */}
    <path
      d="M6.5 27.5L12 14.5H19L24.5 27.5C24.8 28.1 24.3 28.5 23.6 28.5H7.4C6.7 28.5 6.2 28.1 6.5 27.5Z"
      fill="#dc2626"
    />
    {/* Crater Rim & Shading */}
    <path
      d="M12 14.5L13.8 19.5L15.5 14.5L17.2 19.5L19 14.5L24.5 27.5H18L15.5 20.5L13.5 27.5H7.5L12 14.5Z"
      fill="#991b1b"
    />
    <path
      d="M12 14.5H19L18 16H13L12 14.5Z"
      fill="#ea580c"
    />
  </svg>
);

