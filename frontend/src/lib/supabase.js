import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const supabase = createClient(url, key);

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*, organizations(*)').eq('id', user.id).single();
  return data;
}

export async function getStations() {
  const { data } = await supabase.from('stations').select('*').eq('is_active', true).order('name');
  return data || [];
}

export async function getLatestReading(stationId) {
  const { data } = await supabase.from('readings').select('*').eq('station_id', stationId).order('timestamp', { ascending: false }).limit(1);
  return data?.[0] || null;
}

export async function getAllLatestReadings() {
  const stations = await getStations();
  return Promise.all(stations.map(async s => ({ ...s, reading: await getLatestReading(s.id) })));
}

export async function getReadingsHistory(stationId, hours = 24) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const { data } = await supabase.from('readings').select('*').eq('station_id', stationId).gte('timestamp', since).order('timestamp', { ascending: true });
  return data || [];
}

export async function createStation(station) {
  const { data, error } = await supabase.from('stations').insert(station).select().single();
  if (error) throw error;
  return data;
}

export async function updateStation(id, updates) {
  const { data, error } = await supabase.from('stations').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
