const schedule = [
  { kind: 'level', level: 1, small_blind: 1000, big_blind: 2000, ante: 4000, duration_seconds: 1200, is_late_checkin: true },
  { kind: 'break', label: 'Intervalo', duration_seconds: 900 },
  { kind: 'level', level: 2, small_blind: 1500, big_blind: 3000, ante: 6000, duration_seconds: 1200, is_late_checkin: false },
];

let selectedId = 'fixture';

const rowFor = (id: string) => ({
  id,
  name: 'Mesa televisionada · Campeonato com nome excepcionalmente longo',
  schedule,
  status: 'running',
  anchor_ms: Date.now() - (id.includes('intervalo') ? 1_260_000 : 60_000),
  paused_elapsed_ms: 0,
  players_remaining: 37,
  total_chips: 7_407_369,
});

const query = {
  select() { return this; },
  eq(_column: string, value: string) { selectedId = value; return this; },
  async maybeSingle() { return { data: rowFor(selectedId), error: null }; },
};

const channel = {
  on() { return this; },
  subscribe() { return this; },
};

export const isSupabaseConfigured = true;
export const supabase = {
  from() { return query; },
  channel() { return channel; },
  removeChannel() {},
};
