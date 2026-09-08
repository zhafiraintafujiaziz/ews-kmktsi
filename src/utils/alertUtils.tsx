import React from 'react';
import type { DisasterType } from '../types';
import earthquakeIcon from '../assets/earthquake.png';
import floodIcon from '../assets/flood.png';
import droughtIcon from '../assets/drought.png';

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

export function getDisasterIconValue(type: DisasterType | string): string {
  switch (type) {
    case 'earthquake':
    case 'gempa':
      return earthquakeIcon;
    case 'tsunami':
    case 'pasang':
      return '🌊';
    case 'flood':
    case 'banjir':
      return floodIcon;
    case 'cuaca':
    case 'extreme_weather':
      return '🌧️';
    case 'volcanic':
      return '🌋';
    case 'volcanic_ash':
    case 'abu_vulkanik':
      return 'volcano_cloud';
    case 'landslide':
      return '⛰️';
    case 'karhutla':
      return '🔥';
    case 'kekeringan':
      return droughtIcon;
    default:
      return '⚠️';
  }
}

export function getDisasterEmoji(type: DisasterType | string): string {
  return getDisasterIconValue(type);
}

export function getDisasterColor(type: DisasterType | string): string {
  switch (type) {
    case 'earthquake':
    case 'gempa':
      return '#8b5cf6'; // Violet/Purple (was Red)
    case 'tsunami':
    case 'pasang':
      return '#06b6d4'; // Cyan/Teal
    case 'flood':
    case 'banjir':
      return '#0284c7'; // Sky Blue
    case 'volcanic':
      return '#dc2626'; // Deep Red
    case 'volcanic_ash':
    case 'abu_vulkanik':
      return '#ea580c'; // Burnt Orange / Volcanic Ash
    case 'landslide':
      return '#b45309'; // Brown/Amber
    case 'extreme_weather':
    case 'cuaca':
      return '#eab308'; // Amber/Yellow
    case 'karhutla':
      return '#f97316'; // Orange
    case 'kekeringan':
      return '#d97706'; // Dark Amber
    default:
      return '#f59e0b'; // Warning Amber
  }
}

export function getDisasterIconClass(type: DisasterType | string): string {
  // Retained as a stub for compatibility
  switch (type) {
    case 'earthquake':
    case 'gempa':
      return 'wi-earthquake';
    case 'tsunami':
    case 'pasang':
      return 'wi-tsunami';
    case 'flood':
    case 'banjir':
      return 'wi-flood';
    case 'volcanic':
      return 'wi-volcano';
    case 'landslide':
      return 'wi-sandstorm';
    case 'extreme_weather':
    case 'cuaca':
      return 'wi-lightning';
    case 'karhutla':
      return 'wi-fire';
    case 'kekeringan':
      return 'wi-hot';
    default:
      return 'wi-na';
  }
}

export function getDisasterIconHtml(type: DisasterType | string, _customColor?: string): string {
  const icon = getDisasterIconValue(type);
  if (icon === 'volcano_cloud') {
    return `<svg viewBox="0 0 32 32" width="20" height="20" style="display:inline-block;vertical-align:middle;" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 2.5C13.6 2.5 11.7 4.2 11.4 6.5C9.7 6.8 8.5 8.3 8.5 10.1C8.5 12.2 10.2 13.8 12.3 13.8H20.7C22.8 13.8 24.5 12.2 24.5 10.1C24.5 8.4 23.3 7 21.6 6.6C21.3 4.3 19.4 2.5 16 2.5Z" fill="#475569"/><circle cx="16" cy="6.5" r="1.2" fill="#f97316"/><path d="M6.5 27.5L12 14.5H19L24.5 27.5H7.4L6.5 27.5Z" fill="#dc2626"/><path d="M12 14.5H19L18 16H13L12 14.5Z" fill="#ea580c"/></svg>`;
  }
  if (icon.endsWith('.png') || icon.startsWith('data:') || icon.startsWith('/') || icon.startsWith('static/') || icon.startsWith('src/')) {
    return `<img src="${icon}" style="width: 20px; height: 20px; display: inline-block; vertical-align: middle; object-fit: contain;" alt="${type}" />`;
  }
  return `<span style="font-size: 18px; display: inline-block; vertical-align: middle; line-height: 1;">${icon}</span>`;
}

export function renderDisasterIcon(
  type: DisasterType | string,
  className?: string,
  style?: React.CSSProperties
): React.ReactNode {
  const icon = getDisasterIconValue(type);
  const size = style?.width || style?.height || '20px';

  if (icon === 'volcano_cloud') {
    return <VolcanoWithCloudIcon size={size} className={className} style={style} />;
  }

  // Extract size styles for img to prevent them from causing layout issues
  const { width, height, ...restStyle } = style || {};

  if (icon.endsWith('.png') || icon.startsWith('data:') || icon.startsWith('/') || icon.startsWith('static/') || icon.startsWith('src/')) {
    const mergedStyle: React.CSSProperties = {
      width: size,
      height: size,
      display: 'inline-block',
      verticalAlign: 'middle',
      objectFit: 'contain',
      ...restStyle
    };
    return <img src={icon} className={className} style={mergedStyle} alt={type} />;
  }

  const mergedStyle: React.CSSProperties = {
    fontSize: size,
    display: 'inline-block',
    verticalAlign: 'middle',
    lineHeight: 1,
    ...style
  };
  return <span className={className} style={mergedStyle}>{icon}</span>;
}

