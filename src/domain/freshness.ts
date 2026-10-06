import type { DisasterAlert } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function isCurrentlyUsable(alert: DisasterAlert, now = Date.now()): boolean {
  const issuedAt = Date.parse(alert.timestamp);
  if (!Number.isFinite(issuedAt)) return false;

  if (alert.isForecast) {
    const start = Date.parse(alert.validFrom || alert.timestamp);
    const end = Date.parse(alert.validUntil || '');
    return Number.isFinite(start) && Number.isFinite(end) && start < end && end > now;
  }
  if (issuedAt > now) return false;

  if (alert.type === 'earthquake' || alert.type === 'air_quality') {
    return now - issuedAt <= DAY_MS;
  }

  if (alert.type === 'karhutla') {
    const start = Date.parse(alert.validFrom || '');
    const end = Date.parse(alert.validUntil || '');
    return Number.isFinite(start) && Number.isFinite(end) && start <= end && end <= now && now - end <= DAY_MS;
  }

  if (alert.type === 'extreme_weather' || alert.type === 'volcanic_ash') {
    const start = alert.validFrom ? Date.parse(alert.validFrom) : issuedAt;
    const end = Date.parse(alert.validUntil || '');
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
  }

  if (alert.type === 'volcanic') {
    const reportDate = new Date(issuedAt);
    const today = new Date(now);
    const yesterday = new Date(now - DAY_MS);
    const localDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
    return localDate(reportDate) === localDate(today) || localDate(reportDate) === localDate(yesterday);
  }

  return false;
}
