import {
  groupForItem,
  malaysiaDate,
  normaliseCellDate,
  parseCoordinate,
  parseLayout,
  poleKey,
} from '../../src/sheet-sync/sheet-sync.logic';

/**
 * Google Sheet repair-date sync (docs/PLAN-google-sheet-repair-sync.md): the
 * QR03 layout reader, item → date-group mapping and row-matching keys.
 */

// TNB Kuantan Tier 1 QR03 (2026-10-21): group heading → number of item columns.
const GROUPS: Array<[string, number]> = [
  ['Tiang', 3],
  ['Pembumian', 3],
  ['Nombor Tiang', 1],
  ['Sambungan UG-OH/Jumper', 4],
  ['Talian (Utama / Servis)', 6],
  ['Rentis', 2],
  ['Umbang', 3],
  ['IPC', 3],
  ['Aksesori', 4],
  ['Black Box', 3],
  ['Penangkap Kilat', 1],
  ['Servis', 6],
  ['Papan Tanda - OFF Point / Bekalan Dua Hala', 1],
  ['Sesalur Kaki Lima', 3],
  ['Lampu Jalan', 1],
  ['Lain-lain', 1],
];

const buildSheet = () => {
  const headings = ['', '', '', '', 'SEKSYEN', '', '', ''];
  const header = [
    'Bil',
    'FL Pencawang',
    'Nama Pencawang / Nama Feeder Pillar',
    'Feeder Name / Nama Jalan',
    'DARI',
    'KE',
    'Lokasi Kejanggalan (No Tiang / Koordinat / No Premis)',
    'Struktur Tanah',
  ];
  for (const [heading, items] of GROUPS) {
    for (let i = 0; i < items; i += 1) {
      headings.push(i === 0 ? heading : '');
      header.push(`${heading} item ${i + 1}`);
    }
    headings.push('');
    header.push('Tarikh Pembaikan');
  }
  header.push('Total Bil Janggal', 'Catitan', 'NO FILE RUJUKAN SOFTCOPY', 'COORDINATE TIANG', 'REPAIRED BY');
  return [['ENGR-750-44-QR-03 : Laporan Kejanggalan SAVR & Pembaikan'], [], headings, header];
};

describe('parseLayout', () => {
  it('finds the header row, key columns and all 16 date groups by text', () => {
    const layout = parseLayout(buildSheet());
    expect(layout.headerRow).toBe(3);
    expect(layout.flCol).toBe(1);
    expect(layout.nameCol).toBe(2);
    expect(layout.poleCol).toBe(6);
    expect(layout.groups.map((group) => group.id)).toEqual([
      'TIANG',
      'PEMBUMIAN',
      'NOMBOR_TIANG',
      'SAMBUNGAN',
      'TALIAN',
      'RENTIS',
      'UMBANG',
      'IPC',
      'AKSESORI',
      'BLACK_BOX',
      'PENANGKAP_KILAT',
      'SERVIS',
      'PAPAN_TANDA',
      'SESALUR',
      'LAMPU_JALAN',
      'LAIN_LAIN',
    ]);
    // Same positions as the real sheet: Tiang date = L (11), Umbang date = AK (36).
    expect(layout.groups[0].dateCol).toBe(11);
    expect(layout.groups.find((group) => group.id === 'UMBANG')?.dateCol).toBe(36);
    expect(layout.unknownGroups).toEqual([]);
  });

  it('still works when a column is inserted', () => {
    const sheet = buildSheet();
    sheet[2].splice(3, 0, '');
    sheet[3].splice(3, 0, 'Extra');
    const layout = parseLayout(sheet);
    expect(layout.groups[0].dateCol).toBe(12);
    expect(layout.coordCol).toBe(sheet[3].indexOf('COORDINATE TIANG'));
  });

  it('refuses a tab that is not QR03', () => {
    expect(() => parseLayout([['a', 'b'], ['c', 'd']])).toThrow(/header row/);
  });
});

describe('groupForItem', () => {
  it.each([
    ['Tiang - Reput / Retak', 'TIANG'],
    ['TIANG - KEPERLUAN UMBANG', 'TIANG'],
    ['Tiang - No. Tiang Pudar / Tiada', 'NOMBOR_TIANG'],
    ['Jumper - Tiada UV Sleeve', 'SAMBUNGAN'],
    ['Sambungan UG-OH / Jumper - Paip Kabel Rosak / Tidak Standard / Tiada Paip', 'SAMBUNGAN'],
    ['Talian (Utama / Servis) - Uzur / Usang', 'TALIAN'],
    ['Talian - Perlu Rentis', 'RENTIS'],
    ['Umbang - Ulan (Creepers)', 'RENTIS'],
    ['Rentis - Ulan (Creepers)', 'RENTIS'],
    ['Umbang - Kendur / Putus', 'UMBANG'],
    ['IPC - Kesan Bakar', 'IPC'],
    ['Black Box - Usang / Lama', 'BLACK_BOX'],
    ['Papan Tanda - OFF Point / Bekalan Dua Hala - Papan Tanda Pudar / Rosak / Tiada', 'PAPAN_TANDA'],
    ['Lain-lain - Hazard Bio (Tebuan, etc.)', 'LAIN_LAIN'],
  ])('%s → %s', (label, group) => {
    expect(groupForItem(label)).toBe(group);
  });

  it('falls back to the section title for an item without a group prefix', () => {
    expect(groupForItem('Kendur / Putus', 'Umbang')).toBe('UMBANG');
  });

  it('leaves a free-text maintenance finding without a column', () => {
    expect(groupForItem('Pokok tumbang atas talian')).toBeNull();
  });
});

describe('row matching keys', () => {
  it('compares pole numbers without spaces but keeps / and &', () => {
    expect(poleKey('FP1 B 15/1')).toBe(poleKey('FP1 B15/1'));
    expect(poleKey('B 1/1')).not.toBe(poleKey('B 11'));
    expect(poleKey('A 1 & B 1')).toBe('A1&B1');
  });

  it('reads COORDINATE TIANG', () => {
    expect(parseCoordinate('4.03752, 103.394947')).toEqual({ lat: 4.03752, lng: 103.394947 });
    expect(parseCoordinate('')).toBeNull();
    expect(parseCoordinate('TIADA')).toBeNull();
  });
});

describe('dates', () => {
  it('uses the Malaysia calendar day and the Sheets serial', () => {
    // 17:30 UTC on 4 Oct = 01:30 on 5 Oct in Malaysia.
    const date = malaysiaDate(new Date('2026-10-04T17:30:00Z'));
    expect(date.text).toBe('05/10/2026');
    // 5 Oct 2026; a typed "05/10/2026" in this en_US sheet became 46152 (10 May).
    expect(date.serial).toBe(46300);
  });

  it('compares displayed cell dates padded', () => {
    expect(normaliseCellDate('5/10/2026')).toBe('05/10/2026');
    expect(normaliseCellDate(' 21/09/2026 ')).toBe('21/09/2026');
    expect(normaliseCellDate('')).toBe('');
  });
});
