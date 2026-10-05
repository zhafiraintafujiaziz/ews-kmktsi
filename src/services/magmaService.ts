import type { VolcanoReport, VolcanoLevel, VolcanoSeismicity, DisasterAlert, AlertSeverity } from '../types';
import { fetchHtmlWithCorsProxy } from './proxy';



function parseVolcanoTable(tableEl: Element, level: VolcanoLevel): VolcanoReport[] {
  const reports: VolcanoReport[] = [];
  const rows = tableEl.querySelectorAll('tbody tr');

  rows.forEach((row) => {
    const cols = row.querySelectorAll('td');
    if (cols.length < 5) return;

    const no = parseInt(cols[0].textContent?.trim() || '0');
    const name = cols[1].textContent?.trim() || '';

    // Process Visual column
    const paragraphs = Array.from(cols[2].querySelectorAll('p'))
      .map(p => p.textContent?.trim() || '')
      .filter(Boolean);
    const visual = paragraphs.length > 0 ? paragraphs.join('\n') : cols[2].textContent?.trim() || '';

    // Process Seismicity column
    const seismicity: VolcanoSeismicity[] = [];
    const listItems = cols[3].querySelectorAll('li');
    listItems.forEach((li) => {
      const text = li.textContent?.trim() || '';
      // Matches "X kali gempa Y"
      const match = text.match(/^(\d+)\s+kali\s+(.+)$/i);
      if (match) {
        seismicity.push({
          count: parseInt(match[1]),
          type: match[2].trim()
        });
      } else if (text) {
        seismicity.push({
          count: 1,
          type: text
        });
      }
    });

    // Process Recommendations column
    const recParagraphs = Array.from(cols[4].querySelectorAll('li'))
      .map(li => li.textContent?.trim() || '')
      .filter(Boolean);
    const recommendation = recParagraphs.length > 0 ? recParagraphs.join('\n') : cols[4].textContent?.trim() || '';

    reports.push({
      no,
      name,
      visual,
      seismicity,
      recommendation,
      level
    });
  });

  return reports;
}

export function getJakartaDateString(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export const MagmaService = {
  async fetchDailyReport(dateStr: string): Promise<VolcanoReport[]> {
    const url = `https://magma.esdm.go.id/v1/gunung-api/laporan-harian/${dateStr}`;
    try {
      const htmlText = await fetchHtmlWithCorsProxy(url);
      if (!htmlText) throw new Error('Empty response from proxy');

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      // Search cards by headers
      const reports: VolcanoReport[] = [];
      const cards = doc.querySelectorAll('.card');

      cards.forEach((card) => {
        const titleEl = card.querySelector('.slim-card-title');
        if (!titleEl) return;

        const titleText = titleEl.textContent || '';
        let level: VolcanoLevel | null = null;
        if (titleText.includes('Level IV')) {
          level = 'IV';
        } else if (titleText.includes('Level III')) {
          level = 'III';
        } else if (titleText.includes('Level II')) {
          level = 'II';
        } else if (titleText.includes('Level I')) {
          level = 'I';
        }

        if (level) {
          const tableEl = card.querySelector('table');
          if (tableEl) {
            reports.push(...parseVolcanoTable(tableEl, level));
          }
        }
      });

      // Fallback to searching by IDs if card structures changed
      if (reports.length === 0) {
        const tabMapping: { id: string; level: VolcanoLevel }[] = [
          { id: 'tab-0', level: 'III' },
          { id: 'tab-1', level: 'II' },
          { id: 'tab-2', level: 'I' }
        ];

        tabMapping.forEach(({ id, level }) => {
          const tabEl = doc.getElementById(id);
          if (tabEl) {
            const tableEl = tabEl.querySelector('table');
            if (tableEl) {
              reports.push(...parseVolcanoTable(tableEl, level));
            }
          }
        });
      }

      return reports;
    } catch (e) {
      console.warn('Failed to fetch from MAGMA Indonesia:', e);
      throw e;
    }
  },

  async fetchLiveAlerts(): Promise<DisasterAlert[]> {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 3600000);

    const todayStr = getJakartaDateString(today);
    const yesterdayStr = getJakartaDateString(yesterday);

    try {
      const results = await Promise.allSettled([
        this.fetchDailyReport(todayStr),
        this.fetchDailyReport(yesterdayStr)
      ]);

      const todayReports = results[0].status === 'fulfilled' ? results[0].value : [];
      const yesterdayReports = results[1].status === 'fulfilled' ? results[1].value : [];

      if (results[0].status === 'rejected' && results[1].status === 'rejected') {
        const reason = (results[0] as PromiseRejectedResult).reason || (results[1] as PromiseRejectedResult).reason || new Error('Failed to fetch both today and yesterday MAGMA reports');
        throw reason;
      }

      const mergedMap = new Map<string, VolcanoReport>();
      
      yesterdayReports.forEach((r) => {
        mergedMap.set(r.name, r);
      });
      
      todayReports.forEach((r) => {
        mergedMap.set(r.name, r);
      });

      const finalReports = Array.from(mergedMap.values());

      return finalReports.map((report) => {
        const isToday = todayReports.some((tr) => tr.name === report.name);
        return volcanoReportToAlert(report, isToday ? todayStr : yesterdayStr);
      });
    } catch (e) {
      console.warn('Failed to load live volcano alerts:', e);
      throw e;
    }
  }
};

export function getProvinceIdForVolcano(volcanoName: string): string {
  const name = volcanoName.toLowerCase();
  if (name.includes('awu')) return 'ID-SA'; // Sulawesi Utara
  if (name.includes('lewotobi')) return 'ID-NT'; // Nusa Tenggara Timur
  if (name.includes('merapi')) return 'ID-YO'; // DI Yogyakarta
  if (name.includes('semeru')) return 'ID-JI'; // Jawa Timur
  if (name.includes('krakatau')) return 'ID-LA'; // Lampung
  if (name.includes('bromo')) return 'ID-JI'; // Jawa Timur
  if (name.includes('dukono')) return 'ID-MU'; // Maluku Utara
  if (name.includes('gamalama')) return 'ID-MU'; // Maluku Utara
  if (name.includes('lewo')) return 'ID-NT'; // Nusa Tenggara Timur (Ili Lewotolok)
  if (name.includes('kerinci')) return 'ID-JA'; // Jambi
  if (name.includes('marapi')) return 'ID-SB'; // Sumatera Barat
  if (name.includes('ebulobo')) return 'ID-NT'; // Nusa Tenggara Timur
  if (name.includes('egon')) return 'ID-NT'; // Nusa Tenggara Timur
  if (name.includes('werung')) return 'ID-NT'; // Nusa Tenggara Timur
  if (name.includes('wurlali')) return 'ID-MA'; // Maluku
  if (name.includes('ibu')) return 'ID-MU'; // Maluku Utara
  if (name.includes('sinabung')) return 'ID-SU'; // Sumatera Utara
  if (name.includes('karangetang')) return 'ID-SA'; // Sulawesi Utara
  if (name.includes('soputan')) return 'ID-SA'; // Sulawesi Utara
  if (name.includes('raung')) return 'ID-JI'; // Jawa Timur
  if (name.includes('lokon')) return 'ID-SA'; // Sulawesi Utara
  return 'unknown';
}

export function getVolcanoCoordinates(name: string): [number, number] | null {
  const n = name.toLowerCase();
  if (n.includes('awu')) return [3.682, 125.446];
  if (n.includes('lewotobi')) return [-8.542, 122.775];
  if (n.includes('merapi')) return [-7.540, 110.446];
  if (n.includes('semeru')) return [-8.108, 112.922];
  if (n.includes('krakatau')) return [-6.102, 105.423];
  if (n.includes('bromo')) return [-7.942, 112.953];
  if (n.includes('dukono')) return [1.693, 127.894];
  if (n.includes('gamalama')) return [0.80, 127.325];
  if (n.includes('lewo')) return [-8.272, 123.505]; // Ili Lewotolok
  if (n.includes('kerinci')) return [-1.697, 101.264];
  if (n.includes('marapi')) return [-0.381, 100.473];
  if (n.includes('ebulobo')) return [-8.814, 121.185];
  if (n.includes('egon')) return [-8.677, 122.454];
  if (n.includes('werung')) return [-8.52, 123.58];
  if (n.includes('wurlali')) return [-7.125, 128.675];
  if (n.includes('ibu')) return [1.488, 127.63];
  if (n.includes('sinabung')) return [3.17, 98.392];
  if (n.includes('karangetang')) return [2.78, 125.40];
  if (n.includes('soputan')) return [1.112, 124.73];
  if (n.includes('raung')) return [-8.125, 114.042];
  if (n.includes('lokon')) return [1.358, 124.792];
  return null;
}

export function volcanoReportToAlert(report: VolcanoReport, dateStr: string): DisasterAlert {
  const coords = getVolcanoCoordinates(report.name);
  const severityMap: Record<VolcanoLevel | string, AlertSeverity> = {
    'IV': 3,
    'III': 3,
    'II': 2,
    'I': 1
  };

  const statusLabel = {
    'IV': 'Level IV (Awas)',
    'III': 'Level III (Siaga)',
    'II': 'Level II (Waspada)',
    'I': 'Level I (Normal)'
  }[report.level] || 'Level III (Siaga)';

  const seismicityText = report.seismicity
    .map(s => `• ${s.count} kali ${s.type}`)
    .join('\n');

  const fullDescription = `Visual:
${report.visual}

Kegempaan:
${seismicityText || 'Tidak terdeteksi gempa signifikan.'}

Rekomendasi:
${report.recommendation}`;

  return {
    id: `volcano-${report.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${dateStr}`,
    type: 'volcanic',
    severity: severityMap[report.level] || 3,
    provinceId: getProvinceIdForVolcano(report.name),
    title: `Gunung ${report.name} - ${statusLabel}`,
    description: fullDescription,
    timestamp: new Date(dateStr).toISOString(),
    ...(coords ? { latitude: coords[0], longitude: coords[1] } : {})
  };
}
