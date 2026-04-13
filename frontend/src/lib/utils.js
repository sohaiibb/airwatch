export const AQI_LEVELS = [
  { min: 0, max: 50, label: 'Good', color: '#16A34A', soft: '#DCFCE7', desc: 'Air quality is satisfactory with minimal health risk.' },
  { min: 51, max: 100, label: 'Moderate', color: '#CA8A04', soft: '#FEF9C3', desc: 'Acceptable. Sensitive individuals may have minor issues.' },
  { min: 101, max: 150, label: 'Sensitive', color: '#EA580C', soft: '#FFEDD5', desc: 'Sensitive groups may experience health effects.' },
  { min: 151, max: 200, label: 'Unhealthy', color: '#DC2626', soft: '#FEE2E2', desc: 'Everyone may begin to experience health effects.' },
  { min: 201, max: 300, label: 'Very Unhealthy', color: '#7C3AED', soft: '#EDE9FE', desc: 'Health alert: serious effects for everyone.' },
  { min: 301, max: 500, label: 'Hazardous', color: '#991B1B', soft: '#FEE2E2', desc: 'Emergency conditions. Stay indoors.' },
];
export const getAqiLevel = (v) => AQI_LEVELS.find(l => v >= l.min && v <= l.max) || AQI_LEVELS[0];

export const NCEC_STANDARDS = {
  co: { label: 'CO', unit: 'µg/m³', color: '#10B981', standards: [
    { period: '1-hour',  limit: 40000, exceedances: '1X per year' },
    { period: '8-hour',  limit: 10000, exceedances: '2X per month' },
  ]},
  no2: { label: 'NO₂', unit: 'µg/m³', color: '#06B6D4', standards: [
    { period: '1-hour',  limit: 200,   exceedances: '24X per year' },
    { period: '1-year',  limit: 100,   exceedances: null },
  ]},
  so2: { label: 'SO₂', unit: 'µg/m³', color: '#F59E0B', standards: [
    { period: '1-hour',  limit: 441,   exceedances: '24X per year' },
    { period: '24-hour', limit: 217,   exceedances: '3X per year' },
    { period: '1-year',  limit: 65,    exceedances: null },
  ]},
  o3: { label: 'O₃', unit: 'µg/m³', color: '#EC4899', standards: [
    { period: '8-hour',  limit: 157,   exceedances: '25 days/year avg over 3 years' },
  ]},
  pm10: { label: 'PM₁₀', unit: 'µg/m³', color: '#8B5CF6', standards: [
    { period: '24-hour', limit: 340,   exceedances: '12X per year' },
    { period: '1-year',  limit: 50,    exceedances: null },
  ]},
  pm25: { label: 'PM₂.₅', unit: 'µg/m³', color: '#3B82F6', standards: [
    { period: '24-hour', limit: 35,    exceedances: '12X per year' },
    { period: '1-year',  limit: 15,    exceedances: null },
  ]},
};

export function getApplicableStandard(pollutantKey, dataPeriod) {
  const pollutant = NCEC_STANDARDS[pollutantKey];
  if (!pollutant) return null;
  const period = dataPeriod === 'annual' ? '1-year' : dataPeriod;
  const standard = pollutant.standards.find(s => s.period === period);
  if (!standard) return null;
  return { ...standard, label: pollutant.label, unit: pollutant.unit, color: pollutant.color };
}

export const glass = (x = {}) => ({ background:'var(--glass-bg)', backdropFilter:'blur(12px) saturate(1.2)', WebkitBackdropFilter:'blur(12px) saturate(1.2)', borderRadius:22, border:'1px solid var(--glass-border)', boxShadow:'var(--glass-shadow)', ...x });
export const glassInner = (x = {}) => ({ background:'var(--glass-inner-bg)', backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)', borderRadius:14, border:'1px solid var(--glass-inner-border)', ...x });

export const POLLUTANTS = [
  { key: 'pm25', name: 'PM2.5', unit: 'µg/m³', color: '#3B82F6', threshold: 35, max: 150 },
  { key: 'pm10', name: 'PM10', unit: 'µg/m³', color: '#8B5CF6', threshold: 340, max: 600 },
  { key: 'so2',  name: 'SO₂',  unit: 'µg/m³', color: '#F59E0B', threshold: 441, max: 500 },
  { key: 'no2',  name: 'NO₂',  unit: 'µg/m³', color: '#06B6D4', threshold: 200, max: 300 },
  { key: 'o3',   name: 'O₃',   unit: 'µg/m³', color: '#EC4899', threshold: 157, max: 300 },
  { key: 'co',   name: 'CO',   unit: 'µg/m³', color: '#10B981', threshold: 40000, max: 60000 },
];

export const fmt = (v, d = 1) => v != null ? Number(v).toFixed(d) : '—';
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false });
export const formatTime = fmtTime;
export const formatDate = (ts) => new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false });

export function generateDemoStations() {
  const defs = [
    { id:'demo-1', name:'Al Khobar Central', latitude:26.28, longitude:50.21, base:35 },
    { id:'demo-2', name:'Dammam Industrial', latitude:26.42, longitude:50.09, base:68 },
    { id:'demo-3', name:'Dhahran Tech Valley', latitude:26.24, longitude:50.19, base:38 },
    { id:'demo-4', name:'Jubail Port Zone', latitude:27.00, longitude:49.66, base:118 },
    { id:'demo-5', name:'Ras Tanura Coastal', latitude:26.65, longitude:50.17, base:42 },
    { id:'demo-6', name:'Qatif North', latitude:26.52, longitude:50.01, base:58 },
  ];
  const r = (v, rng) => +(v + (Math.random()-.5)*rng).toFixed(1);
  return defs.map(s => ({ ...s, reading: {
    aqi: Math.round(s.base + (Math.random()-.5)*20), pm25: r(s.base*.35,8), pm10: r(s.base*.65,14),
    so2: r(6,5), no2: r(14,10), o3: r(35,20), co: r(800,400),
    temperature: r(38,4), humidity: r(42,10), wind_speed: r(4.5,3),
    wind_direction: r(180,180), pressure: r(1013,5), visibility: r(9,3),
    timestamp: new Date().toISOString(),
  }}));
}

export function generateDemoHistory(hours = 24) {
  const d = [], now = Date.now();
  for (let i = hours; i >= 0; i--) {
    const b = 35 + Math.sin(i/4)*14;
    d.push({ timestamp: new Date(now-i*36e5).toISOString(),
      aqi: Math.round(b+Math.random()*18), pm25: +(7+Math.random()*16).toFixed(1),
      pm10: +(14+Math.random()*28).toFixed(1), so2: +(2+Math.random()*8).toFixed(1),
      no2: +(5+Math.random()*20).toFixed(1), o3: +(18+Math.random()*35).toFixed(1),
      co: +(400+Math.random()*800).toFixed(0), temperature: +(34+Math.random()*8).toFixed(1),
      humidity: +(35+Math.random()*15).toFixed(1), wind_speed: +(1+Math.random()*7).toFixed(1),
      wind_direction: Math.round(Math.random()*360),
    });
  }
  return d;
}
