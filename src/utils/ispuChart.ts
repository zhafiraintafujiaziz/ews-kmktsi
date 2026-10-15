import type { IspuSeriesPoint } from '../domain/ispuHistory.ts';

export function ispuChartScale(values: number[]) {
  const maximum = values.reduce((max, value) => Math.max(max, value), 100);
  const rough = maximum * 1.1 / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(value => value * power).find(value => value >= rough)!;
  const max = Math.ceil(maximum * 1.1 / step) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step) };
}

export function ispuChartSegments(points: IspuSeriesPoint[]) {
  const segments: { index: number; point: IspuSeriesPoint }[][] = [];
  let current: { index: number; point: IspuSeriesPoint }[] = [];
  points.forEach((point, index) => {
    if (point.value === null) { if (current.length) segments.push(current); current = []; }
    else current.push({ index, point });
  });
  if (current.length) segments.push(current);
  return segments;
}

export function ispuStationColor(stationId: string) {
  let hash = 0;
  for (const char of stationId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.round(((hash * 137.508 % 360) + 360) % 360)}, 65%, 36%)`;
}
