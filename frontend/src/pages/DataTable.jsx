import { useState, useEffect, useCallback, useRef } from 'react';
import { Database, Download, Loader2, ChevronUp, ChevronDown, ChevronsLeft, ChevronsRight, Search, AlertTriangle, Calendar } from 'lucide-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, getStations } from '../lib/supabase';
import { glass, glassInner, generateDemoHistory } from '../lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const TEAL      = '#0d9488';
const TEAL_DARK = '#0f766e';

const COLS = [
  { key: 'pm25',           label: 'PM₂.₅',  unit: 'µg/m³', dp: 1 },
  { key: 'pm10',           label: 'PM₁₀',   unit: 'µg/m³', dp: 1 },
  { key: 'so2',            label: 'SO₂',    unit: 'µg/m³', dp: 1 },
  { key: 'no2',            label: 'NO₂',    unit: 'µg/m³', dp: 1 },
  { key: 'o3',             label: 'O₃',     unit: 'µg/m³', dp: 1 },
  { key: 'co',             label: 'CO',     unit: 'µg/m³', dp: 0 },
  { key: 'temperature',    label: 'Temp',   unit: '°C',    dp: 1 },
  { key: 'humidity',       label: 'RH',     unit: '%',     dp: 1 },
  { key: 'wind_speed',     label: 'WS',     unit: 'm/s',   dp: 1 },
  { key: 'wind_direction', label: 'WD',     unit: '°',     dp: 0 },
];

// NCEC-based thresholds for per-cell color coding
const THRESHOLDS = {
  pm25:           { yellow: 25,    red: 35  },
  pm10:           { yellow: 255,   red: 340 },
  so2:            { yellow: 263,   red: 441 },
  no2:            { yellow: 150,   red: 200 },
  o3:             { yellow: 118,   red: 157 },
  co:             { yellow: 30000, red: 40000 }, // 40 mg/m³ = 40,000 µg/m³
  temperature:    null,
  humidity:       null,
  wind_speed:     null,
  wind_direction: null,
};

const AGG_OPTIONS = [
  { value: 'raw',    label: 'Raw' },
  { value: '1min',   label: '1-Min' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily',  label: 'Daily' },
];

const PRESETS = [
  { label: '1H',   hours: 1 },
  { label: '6H',   hours: 6 },
  { label: '24H',  hours: 24 },
  { label: '7D',   hours: 168 },
  { label: '30D',  hours: 720 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toLocalInput(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTS(s) {
  return new Date(s).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function fmtTSAgg(s, agg) {
  if (agg === 'daily') {
    return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  if (agg === 'hourly' || agg === '1min') {
    return new Date(s).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
  return fmtTS(s);
}

function fmtVal(v, dp) {
  if (v == null || isNaN(Number(v))) return '—';
  return Number(v).toFixed(dp);
}

function getCellStyle(key, value, rowIdx) {
  const base = {
    padding: '5px 10px', fontSize: 12,
    fontFamily: 'DM Mono, monospace',
    borderBottom: '1px solid rgba(0,0,0,0.05)',
    textAlign: 'right',
    background: rowIdx % 2 === 0 ? '#ffffff' : '#f8fafc',
    color: '#1C1917',
  };
  const t = THRESHOLDS[key];
  if (!t || value == null || isNaN(Number(value))) return base;
  const v = Number(value);
  if (v >= t.red)    return { ...base, background: 'rgba(220,38,38,0.10)', color: '#B91C1C', fontWeight: 600 };
  if (v >= t.yellow) return { ...base, background: 'rgba(234,179,8,0.09)', color: '#92400E' };
  return base;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function bucketKey(ts, agg) {
  const d = new Date(ts);
  if (agg === '1min')   { d.setSeconds(0, 0);     return d.toISOString(); }
  if (agg === 'hourly') { d.setMinutes(0, 0, 0);  return d.toISOString(); }
  if (agg === 'daily')  return ts.slice(0, 10) + 'T00:00:00.000Z';
  return ts;
}

function aggregateReadings(readings, agg) {
  if (agg === 'raw') return readings;
  const buckets = {};
  readings.forEach(r => {
    const key = bucketKey(r.timestamp, agg);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(r);
  });
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ts, recs]) => {
      const row = { timestamp: ts, _id: ts };
      COLS.forEach(c => {
        const vals = recs.map(r => r[c.key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
        row[c.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return row;
    });
}

// ── Sort helper ───────────────────────────────────────────────────────────────

function sortRows(rows, col, asc) {
  return [...rows].sort((a, b) => {
    const va = a[col], vb = b[col];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (col === 'timestamp') return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return asc ? Number(va) - Number(vb) : Number(vb) - Number(va);
  });
}

// ── Filter helper ─────────────────────────────────────────────────────────────

function filterRows(rows, query, agg) {
  if (!query.trim()) return rows;
  const q = query.toLowerCase();
  return rows.filter(r => {
    if (fmtTSAgg(r.timestamp, agg).toLowerCase().includes(q)) return true;
    return COLS.some(c => {
      const v = r[c.key];
      return v != null && String(Number(v).toFixed(c.dp)).includes(q);
    });
  });
}

// ── Export helpers ─────────────────────────────────────────────────────────────

function doExportCSV(rows, stationName, fromStr, toStr, agg) {
  const headers = ['Timestamp', ...COLS.map(c => `${c.label} (${c.unit})`)];
  const lines = [headers.join(',')];
  rows.forEach(r => {
    lines.push([
      `"${fmtTSAgg(r.timestamp, agg)}"`,
      ...COLS.map(c => r[c.key] != null ? Number(r[c.key]).toFixed(c.dp) : ''),
    ].join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${stationName.replace(/\s+/g, '_')}_${fromStr}_${toStr}_${agg}.csv`;
  a.click();
}

function doExportExcel(rows, stationName, fromStr, toStr, agg) {
  const headers = ['Timestamp', ...COLS.map(c => `${c.label} (${c.unit})`)];
  const data = rows.map(r => [
    fmtTSAgg(r.timestamp, agg),
    ...COLS.map(c => r[c.key] != null ? +Number(r[c.key]).toFixed(c.dp) : null),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [{ wch: 22 }, ...COLS.map(() => ({ wch: 10 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${stationName.replace(/\s+/g, '_')}_${fromStr}_${toStr}_${agg}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function DataTable({ profile }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isPhone, setIsPhone] = useState(window.innerWidth < 480);
  useEffect(() => {
    const handle = () => { setIsMobile(window.innerWidth < 768); setIsPhone(window.innerWidth < 480); };
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const now       = new Date();
  const weekAgo   = new Date(now - 7 * 24 * 3600000);

  // ── Station ───────────────────────────────────────────────────────────────
  const [stations,  setStations]  = useState([]);
  const [stationId, setStationId] = useState('');

  // ── Date range mode ───────────────────────────────────────────────────────
  // rangeMode: 'preset' | 'custom' | 'all'
  const [rangeMode,    setRangeMode]    = useState('preset');
  const [presetHours,  setPresetHours]  = useState(168);   // 7D default
  const [customFrom,   setCustomFrom]   = useState(toLocalInput(weekAgo));
  const [customTo,     setCustomTo]     = useState(toLocalInput(now));
  const [pendingFrom,  setPendingFrom]  = useState(toLocalInput(weekAgo));
  const [pendingTo,    setPendingTo]    = useState(toLocalInput(now));

  // ── Aggregation ───────────────────────────────────────────────────────────
  const [agg, setAgg] = useState('raw');

  // ── Sort ──────────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState('timestamp');
  const [sortAsc, setSortAsc] = useState(false);

  // ── Search ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');

  // ── Data state ────────────────────────────────────────────────────────────
  const [displayRows,  setDisplayRows]  = useState([]);  // current page
  const [allRows,      setAllRows]      = useState([]);  // full dataset (for agg + export)
  const [totalCount,   setTotalCount]   = useState(0);   // filtered total
  const [rawTotal,     setRawTotal]     = useState(0);   // unfiltered server count (raw mode)
  const [page,         setPage]         = useState(0);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [warning,      setWarning]      = useState('');

  // ── Ref to abort in-progress fetches ─────────────────────────────────────
  const fetchIdRef = useRef(0);

  // ─────────────────────────────────────────────────────────────────────────
  // Compute effective date range
  // ─────────────────────────────────────────────────────────────────────────

  function getRange() {
    if (rangeMode === 'all') {
      return { fromISO: '2020-01-01T00:00:00.000Z', toISO: new Date().toISOString() };
    }
    if (rangeMode === 'custom') {
      return { fromISO: new Date(customFrom).toISOString(), toISO: new Date(customTo).toISOString() };
    }
    const t = new Date();
    return { fromISO: new Date(t - presetHours * 3600000).toISOString(), toISO: t.toISOString() };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fetch ALL readings for a date range via chunked pagination.
  // Supabase/PostgREST caps queries at 1,000 rows (max_rows setting).
  // We use FETCH_CHUNK = 1000 to match that cap exactly: if a chunk returns
  // exactly 1000 rows, there may be more — keep fetching. If fewer, we're done.
  // ─────────────────────────────────────────────────────────────────────────

  async function fetchAllReadings(fromISO, toISO, myId, onProgress) {
    const FETCH_CHUNK = 1000;
    let all    = [];
    let offset = 0;

    while (true) {
      const { data, error: fetchErr } = await supabase
        .from('readings')
        .select('*')
        .eq('station_id', stationId)
        .gte('timestamp', fromISO)
        .lte('timestamp', toISO)
        .order('timestamp', { ascending: true })
        .range(offset, offset + FETCH_CHUNK - 1);

      if (myId !== fetchIdRef.current) return null; // stale fetch
      if (fetchErr) throw new Error(fetchErr.message);
      if (!data || data.length === 0) break;

      all = all.concat(data);
      console.log(`[DataTable] fetchAllReadings chunk ${offset/FETCH_CHUNK + 1}: got ${data.length} rows, total so far: ${all.length}`);
      if (onProgress) onProgress(all.length);
      if (data.length < FETCH_CHUNK) break;
      offset += FETCH_CHUNK;
    }

    console.log(`[DataTable] fetchAllReadings complete: ${all.length} total rows`);
    return all;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core fetch function
  // ─────────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async (opts = {}) => {
    if (!stationId) return;
    const myId = ++fetchIdRef.current;

    const pageNum = opts.page   ?? 0;
    const sortC   = opts.sortCol ?? sortCol;
    const sortA   = opts.sortAsc ?? sortAsc;
    const searchQ = opts.search  ?? search;
    const aggMode = opts.agg     ?? agg;
    const range   = opts.range   ?? getRange();

    setLoading(true);
    setError('');
    setWarning('');

    const isDemo = stationId.startsWith('demo-');

    // ── RAW mode: server-side pagination ─────────────────────────────────
    if (aggMode === 'raw') {
      try {
        let allData;

        if (isDemo) {
          const hours = Math.max(1, Math.ceil((new Date(range.toISO) - new Date(range.fromISO)) / 3600000));
          allData = generateDemoHistory(Math.min(hours, 720));
          const sorted   = sortRows(allData, sortC, sortA);
          const filtered = filterRows(sorted, searchQ, aggMode);
          setRawTotal(allData.length);
          setTotalCount(filtered.length);
          setPage(pageNum);
          setAllRows(filtered);
          setDisplayRows(filtered.slice(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE));
          setLoading(false);
          return;
        }

        // Get total count
        const { count: total } = await supabase
          .from('readings')
          .select('*', { count: 'exact', head: true })
          .eq('station_id', stationId)
          .gte('timestamp', range.fromISO)
          .lte('timestamp', range.toISO);

        if (myId !== fetchIdRef.current) return;

        // Fetch current page with server-side sort
        const orderCol = sortC === 'timestamp' ? 'timestamp' : sortC;
        const { data, error: fetchErr } = await supabase
          .from('readings')
          .select('*')
          .eq('station_id', stationId)
          .gte('timestamp', range.fromISO)
          .lte('timestamp', range.toISO)
          .order(orderCol, { ascending: sortA })
          .order('timestamp', { ascending: sortA })
          .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

        if (myId !== fetchIdRef.current) return;
        if (fetchErr) { setError(fetchErr.message); setLoading(false); return; }

        setRawTotal(total || 0);
        setTotalCount(total || 0);
        setPage(pageNum);
        setDisplayRows(data || []);
        setAllRows(data || []);
        setLoading(false);
        return;

      } catch (e) {
        if (myId !== fetchIdRef.current) return;
        setError('Failed to load data: ' + (e.message || String(e)));
        setLoading(false);
        return;
      }
    }

    // ── AGGREGATED modes (1min / hourly / daily) ──────────────────────────
    // Always fetch the full raw dataset for the range, then aggregate in JS.
    // For large ranges this uses chunked pagination (5k rows per request).
    try {
      let allReadings;

      if (isDemo) {
        const hours = Math.max(1, Math.ceil((new Date(range.toISO) - new Date(range.fromISO)) / 3600000));
        allReadings = generateDemoHistory(Math.min(hours, 720));
      } else {
        allReadings = await fetchAllReadings(
          range.fromISO,
          range.toISO,
          myId,
          (n) => setWarning(`Loading… ${n.toLocaleString()} rows fetched`),
        );
        if (allReadings === null) return; // fetch was superseded
      }

      if (myId !== fetchIdRef.current) return;

      setWarning(''); // clear progress message

      console.log(`[DataTable] Aggregating ${allReadings.length} raw readings with mode="${aggMode}"`);
      const aggregated = aggregateReadings(allReadings, aggMode);
      console.log(`[DataTable] Aggregation result: ${aggregated.length} ${aggMode} rows`);
      const sorted     = sortRows(aggregated, sortC, sortA);
      const filtered   = filterRows(sorted, searchQ, aggMode);

      setRawTotal(allReadings.length);
      setTotalCount(filtered.length);
      setPage(pageNum);
      setAllRows(filtered);
      setDisplayRows(filtered.slice(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE));

    } catch (e) {
      if (myId !== fetchIdRef.current) return;
      setError('Failed to load data: ' + (e.message || String(e)));
    }

    setLoading(false);
  }, [stationId, sortCol, sortAsc, search, agg, rangeMode, presetHours, customFrom, customTo]); // eslint-disable-line

  // ─────────────────────────────────────────────────────────────────────────
  // Effect: load stations on mount, then auto-fetch
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    getStations().then(st => {
      if (st.length) {
        setStations(st);
        setStationId(st[0].id);
      } else {
        const demo = [
          { id: 'demo-1', name: 'Al Khobar Central',   latitude: 26.28, longitude: 50.21 },
          { id: 'demo-2', name: 'Dammam Industrial',    latitude: 26.42, longitude: 50.09 },
          { id: 'demo-3', name: 'Dhahran Tech Valley',  latitude: 26.24, longitude: 50.19 },
        ];
        setStations(demo);
        setStationId(demo[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (stationId) fetchData({ page: 0 });
  }, [stationId]); // eslint-disable-line

  // ─────────────────────────────────────────────────────────────────────────
  // Interaction handlers
  // ─────────────────────────────────────────────────────────────────────────

  function handlePreset(hours) {
    setRangeMode('preset');
    setPresetHours(hours);
    setPage(0);
    const t   = new Date();
    const f   = new Date(t - hours * 3600000);
    const range = { fromISO: f.toISOString(), toISO: t.toISOString() };
    fetchData({ page: 0, range });
  }

  function handleCustomApply() {
    if (new Date(pendingTo) <= new Date(pendingFrom)) {
      setError('"To" must be after "From".');
      return;
    }
    setCustomFrom(pendingFrom);
    setCustomTo(pendingTo);
    setRangeMode('custom');
    const range = { fromISO: new Date(pendingFrom).toISOString(), toISO: new Date(pendingTo).toISOString() };
    fetchData({ page: 0, range });
  }

  function handleLoadAll() {
    setRangeMode('all');
    const range = { fromISO: '2020-01-01T00:00:00.000Z', toISO: new Date().toISOString() };
    fetchData({ page: 0, range });
  }

  function handleAgg(newAgg) {
    setAgg(newAgg);
    setPage(0);
    fetchData({ page: 0, agg: newAgg });
  }

  function handleSort(col) {
    const newAsc = sortCol === col ? !sortAsc : col !== 'timestamp';
    setSortCol(col);
    setSortAsc(newAsc);
    if (agg !== 'raw') {
      // Re-sort in-memory
      const sorted   = sortRows(allRows, col, newAsc);
      setAllRows(sorted);
      setDisplayRows(sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
    } else {
      // Re-fetch for raw
      fetchData({ page: 0, sortCol: col, sortAsc: newAsc });
    }
  }

  function handleSearch(q) {
    setSearch(q);
    if (agg !== 'raw') {
      // Re-filter in-memory; note allRows might already be filtered, re-derive from scratch
      fetchData({ page: 0, search: q });
    }
    // For raw, search just filters current page visually
  }

  function handlePage(newPage) {
    if (agg !== 'raw') {
      setPage(newPage);
      setDisplayRows(allRows.slice(newPage * PAGE_SIZE, (newPage + 1) * PAGE_SIZE));
    } else {
      fetchData({ page: newPage });
    }
  }

  function handleExportCSV() {
    const station = stations.find(s => s.id === stationId) || { name: 'Unknown' };
    const { fromISO, toISO } = getRange();
    const rows = agg === 'raw' ? allRows : allRows;
    if (!rows.length) { setWarning('No data to export. Load data first.'); return; }
    doExportCSV(rows, station.name, fromISO.slice(0, 10), toISO.slice(0, 10), agg);
  }

  function handleExportExcel() {
    const station = stations.find(s => s.id === stationId) || { name: 'Unknown' };
    const { fromISO, toISO } = getRange();
    const rows = allRows;
    if (!rows.length) { setWarning('No data to export. Load data first.'); return; }
    doExportExcel(rows, station.name, fromISO.slice(0, 10), toISO.slice(0, 10), agg);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Derived display values
  // ─────────────────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // For raw mode with server pagination, search filters current page display
  const visibleRows = (agg === 'raw' && !stationId.startsWith('demo-'))
    ? filterRows(displayRows, search, agg)
    : displayRows;

  const showingFrom = page * PAGE_SIZE + 1;
  const showingTo   = Math.min((page + 1) * PAGE_SIZE, totalCount);

  // ─────────────────────────────────────────────────────────────────────────
  // Style helpers
  // ─────────────────────────────────────────────────────────────────────────

  const thStyle = (col) => ({
    padding: '8px 10px',
    background: TEAL,
    color: '#fff',
    fontWeight: 700,
    fontSize: 11,
    fontFamily: 'Instrument Sans, sans-serif',
    whiteSpace: 'nowrap',
    borderBottom: `2px solid ${TEAL_DARK}`,
    cursor: 'pointer',
    userSelect: 'none',
    textAlign: col === 'timestamp' ? 'left' : 'right',
    position: 'sticky',
    top: 0,
    zIndex: 2,
  });

  const btnBase = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font)', fontSize: 12, fontWeight: 600,
    transition: 'all 0.15s',
  };

  function presetActive(hours) { return rangeMode === 'preset' && presetHours === hours; }

  // ─────────────────────────────────────────────────────────────────────────
  // Pagination helpers
  // ─────────────────────────────────────────────────────────────────────────

  function pageNumbers() {
    const pages = [];
    const delta = 2;
    for (let i = 0; i < totalPages; i++) {
      if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= delta) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '…') {
        pages.push('…');
      }
    }
    return pages;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Page title ── */}
      <div style={{ marginBottom: 20, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) both' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 3px', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Database size={20} color={TEAL} /> Data
        </h1>
        <p style={{ color: '#78716C', fontSize: 13, margin: 0 }}>
          Browse and export all historical monitoring records.
        </p>
      </div>

      {/* ── Controls bar ── */}
      <div style={{ ...glass({ padding: '16px 20px' }), marginBottom: 16, animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.05s both' }}>

        {/* Row 1: station + date presets + load all */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexDirection: isMobile ? 'column' : 'row' }}>

          {/* Station */}
          <div style={{ minWidth: 180 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#78716C', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5, display: 'block' }}>
              Station
            </label>
            <select
              value={stationId}
              onChange={e => { setStationId(e.target.value); setPage(0); }}
              style={{
                padding: '7px 10px', borderRadius: 9, fontSize: 12, color: '#1C1917',
                fontFamily: 'var(--font)', outline: 'none', width: '100%',
                border: '1px solid rgba(255,255,255,0.5)',
                background: 'rgba(255,255,255,0.35)', backdropFilter: 'blur(8px)',
              }}
            >
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Presets */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#78716C', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5, display: 'block' }}>
              Time Range
            </label>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
              {PRESETS.map(p => (
                <button
                  key={p.hours}
                  onClick={() => handlePreset(p.hours)}
                  style={{
                    ...btnBase, padding: '6px 12px',
                    background: presetActive(p.hours) ? TEAL : 'rgba(255,255,255,0.38)',
                    color: presetActive(p.hours) ? '#fff' : '#44403C',
                    border: presetActive(p.hours) ? `1px solid ${TEAL}` : '1px solid rgba(255,255,255,0.55)',
                  }}
                  onMouseEnter={e => { if (!presetActive(p.hours)) e.currentTarget.style.background = 'rgba(255,255,255,0.6)'; }}
                  onMouseLeave={e => { if (!presetActive(p.hours)) e.currentTarget.style.background = 'rgba(255,255,255,0.38)'; }}
                >{p.label}</button>
              ))}

              {/* Custom button */}
              <button
                onClick={() => setRangeMode(rangeMode === 'custom' ? 'preset' : 'custom')}
                style={{
                  ...btnBase, padding: '6px 12px',
                  background: rangeMode === 'custom' ? TEAL : 'rgba(255,255,255,0.38)',
                  color: rangeMode === 'custom' ? '#fff' : '#44403C',
                  border: rangeMode === 'custom' ? `1px solid ${TEAL}` : '1px solid rgba(255,255,255,0.55)',
                }}
              >
                <Calendar size={11} />Custom
              </button>

              <div style={{ width: 1, height: 22, background: 'rgba(0,0,0,0.1)', margin: '0 3px' }} />

              {/* Load All button */}
              <button
                onClick={handleLoadAll}
                style={{
                  ...btnBase, padding: '6px 12px',
                  background: rangeMode === 'all' ? TEAL : 'rgba(255,255,255,0.38)',
                  color: rangeMode === 'all' ? '#fff' : '#44403C',
                  border: rangeMode === 'all' ? `1px solid ${TEAL}` : '1px solid rgba(255,255,255,0.55)',
                }}
              >All Data</button>
            </div>
          </div>
        </div>

        {/* Custom date picker (only when rangeMode === 'custom') */}
        {rangeMode === 'custom' && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end',
            padding: '12px 14px', marginBottom: 12,
            background: `${TEAL}0a`, border: `1px solid ${TEAL}30`, borderRadius: 10,
            flexDirection: isMobile ? 'column' : 'row',
          }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#78716C', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5, display: 'block' }}>
                From
              </label>
              <input
                type="datetime-local"
                value={pendingFrom}
                max={pendingTo}
                onChange={e => setPendingFrom(e.target.value)}
                style={{
                  padding: '7px 10px', borderRadius: 9, fontSize: 12, color: '#1C1917',
                  fontFamily: 'var(--font)', outline: 'none',
                  border: '1px solid rgba(255,255,255,0.5)',
                  background: 'rgba(255,255,255,0.5)',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#78716C', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5, display: 'block' }}>
                To
              </label>
              <input
                type="datetime-local"
                value={pendingTo}
                min={pendingFrom}
                onChange={e => setPendingTo(e.target.value)}
                style={{
                  padding: '7px 10px', borderRadius: 9, fontSize: 12, color: '#1C1917',
                  fontFamily: 'var(--font)', outline: 'none',
                  border: '1px solid rgba(255,255,255,0.5)',
                  background: 'rgba(255,255,255,0.5)',
                }}
              />
            </div>
            <button
              onClick={handleCustomApply}
              style={{
                ...btnBase, padding: '8px 18px',
                background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})`,
                color: '#fff', boxShadow: `0 2px 12px ${TEAL}40`,
              }}
            >Apply</button>
          </div>
        )}

        {/* Row 2: aggregation + search + export + count */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>

          {/* Aggregation toggle */}
          <div style={{ display: 'flex', gap: 0, borderRadius: 9, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.5)', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            {AGG_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => handleAgg(o.value)}
                style={{
                  padding: isMobile ? '9px 14px' : '6px 14px', minHeight: isMobile ? 44 : undefined,
                  border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font)', fontSize: 12, fontWeight: 600,
                  background: agg === o.value ? TEAL : 'rgba(255,255,255,0.38)',
                  color: agg === o.value ? '#fff' : '#57534E',
                  transition: 'all 0.15s',
                  borderRight: o.value !== 'daily' ? '1px solid rgba(255,255,255,0.4)' : 'none',
                }}
              >{o.label}</button>
            ))}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 160, maxWidth: isMobile ? '100%' : 300 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#A8A29E', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Filter rows…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              style={{
                width: '100%', padding: '7px 10px 7px 30px', borderRadius: 9,
                border: '1px solid rgba(255,255,255,0.5)',
                background: 'rgba(255,255,255,0.35)', backdropFilter: 'blur(8px)',
                fontSize: 12, color: '#1C1917', fontFamily: 'var(--font)', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Record count */}
          <span style={{ fontSize: 12, color: '#57534E', whiteSpace: 'nowrap', fontFamily: 'DM Mono, monospace' }}>
            {loading
              ? 'Loading…'
              : totalCount > 0
                ? `Showing ${showingFrom.toLocaleString()}–${showingTo.toLocaleString()} of ${totalCount.toLocaleString()}`
                : '0 records'
            }
          </span>

          {/* Export */}
          <button onClick={handleExportCSV} disabled={loading || !allRows.length} style={{
            ...btnBase,
            background: 'rgba(255,255,255,0.45)', color: '#1C1917',
            border: '1px solid rgba(255,255,255,0.6)',
            opacity: (!allRows.length || loading) ? 0.5 : 1,
          }}>
            <Download size={12} />CSV
          </button>
          <button onClick={handleExportExcel} disabled={loading || !allRows.length} style={{
            ...btnBase,
            background: 'rgba(255,255,255,0.45)', color: '#1C1917',
            border: '1px solid rgba(255,255,255,0.6)',
            opacity: (!allRows.length || loading) ? 0.5 : 1,
          }}>
            <Download size={12} />Excel
          </button>
        </div>

        {/* Error / Warning */}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, padding: '7px 12px', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8 }}>
            <AlertTriangle size={13} color="#DC2626" />
            <span style={{ fontSize: 12, color: '#DC2626' }}>{error}</span>
          </div>
        )}
        {warning && !error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, padding: '7px 12px', background: `${TEAL}0d`, border: `1px solid ${TEAL}30`, borderRadius: 8 }}>
            <Loader2 size={13} color={TEAL} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: TEAL_DARK }}>{warning}</span>
          </div>
        )}
      </div>

      {/* ── Data table ── */}
      <div style={{ ...glass({ padding: 0 }), animation: 'glassIn 0.5s cubic-bezier(.16,1,.3,1) 0.1s both', position: 'relative' }}>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', gap: 12 }}>
            <Loader2 size={22} color={TEAL} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 14, color: '#57534E', fontWeight: 600 }}>Loading data…</span>
          </div>
        ) : visibleRows.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', gap: 10 }}>
            <Database size={32} color="#D6D3D1" />
            <p style={{ fontSize: 14, color: '#A8A29E', fontWeight: 600, margin: 0 }}>No data for this period</p>
            <p style={{ fontSize: 12, color: '#A8A29E', margin: 0 }}>Try a different date range, station, or aggregation.</p>
          </div>
        ) : (
          <div data-scroll-x style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%', position: 'relative' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900, tableLayout: 'auto' }}>
              <thead>
                <tr>
                  {/* Timestamp header */}
                  <th
                    onClick={() => handleSort('timestamp')}
                    style={{ ...thStyle('timestamp'), minWidth: 180, paddingLeft: 16, position: 'sticky', left: 0, zIndex: 2 }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      Timestamp
                      {sortCol === 'timestamp'
                        ? sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                        : <span style={{ opacity: 0.4, fontSize: 9 }}>↕</span>
                      }
                    </span>
                  </th>
                  {COLS.map(c => (
                    <th key={c.key} onClick={() => handleSort(c.key)} style={thStyle(c.key)}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        {sortCol === c.key
                          ? sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                          : <span style={{ opacity: 0.4, fontSize: 9 }}>↕</span>
                        }
                        <span>
                          {c.label}<br />
                          <span style={{ fontSize: 8, fontWeight: 400, opacity: 0.85 }}>{c.unit}</span>
                        </span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r, i) => (
                  <tr key={r.id || r._id || r.timestamp + i} style={{ transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.96)'}
                    onMouseLeave={e => e.currentTarget.style.filter = ''}
                  >
                    <td style={{
                      padding: '5px 10px 5px 16px', fontSize: 12,
                      fontFamily: 'DM Mono, monospace',
                      borderBottom: '1px solid rgba(0,0,0,0.05)',
                      background: i % 2 === 0 ? '#ffffff' : '#f8fafc',
                      color: '#374151', fontWeight: 500, whiteSpace: 'nowrap',
                      position: 'sticky', left: 0, zIndex: 1,
                    }}>
                      {fmtTSAgg(r.timestamp, agg)}
                    </td>
                    {COLS.map(c => (
                      <td key={c.key} style={getCellStyle(c.key, r[c.key], i)}>
                        {fmtVal(r[c.key], c.dp)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ── */}
        {!loading && totalCount > PAGE_SIZE && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderTop: '1px solid rgba(0,0,0,0.06)',
            background: 'rgba(255,255,255,0.5)',
          }}>
            <span style={{ fontSize: 11, color: '#78716C', fontFamily: 'DM Mono, monospace' }}>
              Page {page + 1} of {totalPages.toLocaleString()}
            </span>

            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {/* First */}
              <button onClick={() => handlePage(0)} disabled={page === 0} style={pageBtnStyle(false, page === 0)}>
                <ChevronsLeft size={13} />
              </button>
              {/* Prev */}
              <button onClick={() => handlePage(page - 1)} disabled={page === 0} style={pageBtnStyle(false, page === 0)}>
                <ChevronLeft size={13} />
              </button>

              {/* Page numbers */}
              {isPhone
                ? <span style={{ padding: '0 8px', fontSize: 12, color: '#78716C', fontFamily: 'DM Mono, monospace' }}>{page + 1} / {totalPages.toLocaleString()}</span>
                : pageNumbers().map((p, i) =>
                    p === '…'
                      ? <span key={`ellipsis-${i}`} style={{ padding: '0 5px', color: '#A8A29E', fontSize: 12 }}>…</span>
                      : <button key={p} onClick={() => handlePage(p)} style={pageBtnStyle(p === page, false)}>
                          {p + 1}
                        </button>
                  )
              }

              {/* Next */}
              <button onClick={() => handlePage(page + 1)} disabled={page >= totalPages - 1} style={pageBtnStyle(false, page >= totalPages - 1)}>
                <ChevronRight size={13} />
              </button>
              {/* Last */}
              <button onClick={() => handlePage(totalPages - 1)} disabled={page >= totalPages - 1} style={pageBtnStyle(false, page >= totalPages - 1)}>
                <ChevronsRight size={13} />
              </button>
            </div>

            <span style={{ fontSize: 11, color: '#78716C', fontFamily: 'DM Mono, monospace' }}>
              {rawTotal > 0 && agg !== 'raw' ? `${rawTotal.toLocaleString()} raw readings` : `${totalCount.toLocaleString()} records`}
            </span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, padding: '0 4px' }}>
        <span style={{ fontSize: 10, color: '#A8A29E' }}>Color coding:</span>
        <span style={{ fontSize: 10, color: '#92400E', background: 'rgba(234,179,8,0.09)', padding: '1px 8px', borderRadius: 4 }}>Approaching threshold</span>
        <span style={{ fontSize: 10, color: '#B91C1C', background: 'rgba(220,38,38,0.10)', padding: '1px 8px', borderRadius: 4, fontWeight: 600 }}>Exceeds NCEC limit</span>
      </div>

    </div>
  );
}

function pageBtnStyle(active, disabled) {
  return {
    padding: '5px 9px', borderRadius: 7, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--font)', fontSize: 12, fontWeight: 600,
    background: active ? TEAL : 'rgba(255,255,255,0.6)',
    color: active ? '#fff' : disabled ? '#D6D3D1' : '#44403C',
    boxShadow: active ? `0 1px 6px ${TEAL}40` : 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 30,
  };
}
