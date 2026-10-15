const months: Record<string, string> = {
  januari: '01', februari: '02', maret: '03', april: '04', mei: '05', juni: '06',
  juli: '07', agustus: '08', september: '09', oktober: '10', november: '11', desember: '12',
};

// Parse only explicit offsets and source zones, never the device's timezone.
export function parseSourceTime(raw: string): { observedAt: string | null; issue?: 'ambiguous_timestamp' | 'invalid_timestamp' } {
  let value = raw.trim();
  if (!value) return { observedAt: null };
  const zone = value.match(/\s+(WIB|WITA|WIT|UTC|GMT)$/i);
  if (zone) {
    const offsets: Record<string, string> = { WIB: '+07:00', WITA: '+08:00', WIT: '+09:00', UTC: 'Z', GMT: 'Z' };
    value = value.slice(0, -zone[0].length).trim();
    const indonesian = value.match(/^(\d{1,2})[-\s]+([a-z]+)[-\s]+(\d{4})[ ,]+(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/i);
    if (indonesian && months[indonesian[2].toLowerCase()]) {
      const [, day, month, year, hour, minute, second] = indonesian;
      value = `${year}-${months[month.toLowerCase()]}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second || '00'}`;
    }
    value += offsets[zone[1].toUpperCase()];
  }
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return { observedAt: null, issue: 'ambiguous_timestamp' };
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/i);
  if (!match) return { observedAt: null, issue: 'invalid_timestamp' };
  const [, year, month, day, hour, minute, second = '00', fraction = '', offset] = match;
  const calendar = `${year}-${month}-${day}`;
  const midnight = Date.parse(`${calendar}T00:00:00Z`);
  const invalid = !Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== calendar
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59;
  const normalizedOffset = offset.toUpperCase() === 'Z' ? 'Z' : offset.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const time = Date.parse(`${calendar}T${hour}:${minute}:${second}${fraction}${normalizedOffset}`);
  if (invalid || !Number.isFinite(time)) return { observedAt: null, issue: 'invalid_timestamp' };
  return { observedAt: new Date(time).toISOString() };
}
