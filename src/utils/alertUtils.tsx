import React from 'react';
import type { DisasterType, DisasterAlert } from '../types';
import earthquakeIcon from '../assets/earthquake.png';
import floodIcon from '../assets/flood.png';
import droughtIcon from '../assets/drought.png';
import lightningIcon from '../assets/lightning.png';
import airQualityIcon from '../assets/air-quality.svg';

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

export interface DisasterIconSource {
  id?: string;
  title?: string;
  description?: string;
}

type ExtremeWeatherKind = 'hujan' | 'hujan_lebat' | 'hujan_petir' | 'badai' | 'angin';

const EXTREME_WEATHER_EMOJI: Record<ExtremeWeatherKind, string> = {
  hujan: '🌦️',
  hujan_lebat: '🌧️',
  hujan_petir: lightningIcon,
  badai: lightningIcon,
  angin: '💨',
};

export function classifyExtremeWeather(source?: DisasterIconSource): ExtremeWeatherKind {
  const id = source?.id ?? '';
  const title = source?.title ?? '';
  if (id.startsWith('bmkg-early-warning') || title.toLowerCase().includes('peringatan dini')) {
    return 'hujan';
  }

  const text = `${title} ${source?.description ?? ''}`.toLowerCase();
  if (text.includes('badai')) return 'badai';
  if (text.includes('petir') || text.includes('kilat') || text.includes('guntur')) return 'hujan_petir';
  if (text.includes('hujan lebat') || text.includes('lebat')) return 'hujan_lebat';
  if (text.includes('angin kencang') || text.includes('angin')) return 'angin';
  return 'hujan';
}

export function getDisasterIconValue(type: DisasterType | string, source?: DisasterIconSource): string {
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
      return EXTREME_WEATHER_EMOJI[classifyExtremeWeather(source)];
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
    case 'air_quality':
    case 'kualitas_udara':
    case 'ispu':
      return airQualityIcon;
    default:
      return '⚠️';
  }
}

export function getDisasterEmoji(type: DisasterType | string): string {
  const val = getDisasterIconValue(type);
  if (val === 'volcano_cloud') return '🌋';
  return val;
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
    case 'air_quality':
    case 'kualitas_udara':
    case 'ispu':
      return '#0284c7'; // Sky Blue / Air
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
    case 'air_quality':
    case 'kualitas_udara':
    case 'ispu':
      return 'wi-dust';
    default:
      return 'wi-na';
  }
}

export function getDisasterIconHtml(type: DisasterType | string, _customColor?: string, source?: DisasterIconSource): string {
  const icon = getDisasterIconValue(type, source);
  if (icon === 'volcano_cloud') {
    return `<svg viewBox="0 0 32 32" width="20" height="20" style="display:inline-block;vertical-align:middle;" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 2.5C13.6 2.5 11.7 4.2 11.4 6.5C9.7 6.8 8.5 8.3 8.5 10.1C8.5 12.2 10.2 13.8 12.3 13.8H20.7C22.8 13.8 24.5 12.2 24.5 10.1C24.5 8.4 23.3 7 21.6 6.6C21.3 4.3 19.4 2.5 16 2.5Z" fill="#475569"/><circle cx="16" cy="6.5" r="1.2" fill="#f97316"/><path d="M6.5 27.5L12 14.5H19L24.5 27.5H7.4L6.5 27.5Z" fill="#dc2626"/><path d="M12 14.5H19L18 16H13L12 14.5Z" fill="#ea580c"/></svg>`;
  }
  if (icon.endsWith('.png') || icon.endsWith('.svg') || icon.includes('.svg') || icon.startsWith('data:') || icon.startsWith('/') || icon.startsWith('static/') || icon.startsWith('src/')) {
    return `<img src="${icon}" style="width: 20px; height: 20px; display: inline-block; vertical-align: middle; object-fit: contain;" alt="${type}" />`;
  }
  return `<span style="font-size: 18px; display: inline-block; vertical-align: middle; line-height: 1;">${icon}</span>`;
}

export function renderDisasterIcon(
  type: DisasterType | string,
  className?: string,
  style?: React.CSSProperties,
  source?: DisasterIconSource
): React.ReactNode {
  const icon = getDisasterIconValue(type, source);
  const size = style?.width || style?.height || '20px';

  if (icon === 'volcano_cloud') {
    return <VolcanoWithCloudIcon size={size} className={className} style={style} />;
  }

  // Extract size styles for img to prevent them from causing layout issues
  const { width, height, ...restStyle } = style || {};

  if (icon.endsWith('.png') || icon.endsWith('.svg') || icon.includes('.svg') || icon.startsWith('data:') || icon.startsWith('/') || icon.startsWith('static/') || icon.startsWith('src/')) {
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

export function getDisasterTypeStatus(
  type: DisasterType | 'all' | string,
  alerts: DisasterAlert[] = []
): { color: string; label: string; count: number } {
  if (type === 'all') {
    if (!alerts || alerts.length === 0) {
      return { color: '#10b981', label: 'Normal / Aman (0 Peringatan)', count: 0 };
    }
    const maxSev = Math.max(...alerts.map((a) => a.severity || 1));
    if (maxSev === 3) return { color: '#ef4444', label: `Tinggi / Kritis (${alerts.length} Peringatan)`, count: alerts.length };
    if (maxSev === 2) return { color: '#f59e0b', label: `Sedang / Waspada (${alerts.length} Peringatan)`, count: alerts.length };
    return { color: '#0284c7', label: `Rendah / Informasi (${alerts.length} Peringatan)`, count: alerts.length };
  }

  if (type === 'air_quality' || type === 'kualitas_udara') {
    const ispuAlerts = alerts.filter((a) => a.type === 'air_quality');
    if (ispuAlerts.length === 0) {
      return { color: '#10b981', label: 'Baik / Normal', count: 0 };
    }
    const worst = ispuAlerts.reduce((prev, curr) => ((curr.ispuValue || 0) > (prev.ispuValue || 0) ? curr : prev), ispuAlerts[0]);
    const cat = worst.ispuCategory || 'BAIK';
    const maxSev = Math.max(...ispuAlerts.map((a) => a.severity || 1));
    const color = maxSev === 3 ? '#ef4444' : maxSev === 2 ? '#f59e0b' : '#0284c7';
    return { color, label: `${cat} (ISPU ${worst.ispuValue || '-'})`, count: ispuAlerts.length };
  }

  const typeAlerts = alerts.filter((a) => a.type === type);
  if (typeAlerts.length === 0) {
    return { color: '#10b981', label: 'Normal (0 Peringatan)', count: 0 };
  }
  const maxSev = Math.max(...typeAlerts.map((a) => a.severity || 1));
  if (maxSev === 3) return { color: '#ef4444', label: `Tinggi / Kritis (${typeAlerts.length} Aktif)`, count: typeAlerts.length };
  if (maxSev === 2) return { color: '#f59e0b', label: `Sedang / Waspada (${typeAlerts.length} Aktif)`, count: typeAlerts.length };
  return { color: '#0284c7', label: `Rendah / Informasi (${typeAlerts.length} Aktif)`, count: typeAlerts.length };
}


