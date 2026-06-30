// src/App.tsx
import { useEffect, useMemo, useState } from 'react';
import SetupPanel from './components/SetupPanel';
import PlayersPanel from './components/PlayersPanel';
import BlindClock from './components/BlindClock';
import PayoutsPanel from './components/PayoutsPanel';
import StatsPanel from './components/StatsPanel';
import {
  useTournamentEngine,
  type EngineParams,
} from './hooks/useTournamentEngine';
import {
  defaultSetup,
  initialStack,
  type BaseSetup,
} from './utils/poker-math';
import { saveTournament, type LocalEntry } from './services/tournaments';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import Login from './components/Login';
import type { Session } from '@supabase/supabase-js';

export interface AppConfig {
  name: string;
  start_time: string; // datetime-local
  setup: BaseSetup;
  target_time_minutos: number;
  duracao_bloco_nivel: number;
  buy_in_value: number;
  rebuy_value: number;
  addon_value: number;
  chips_per_rebuy: number;
  chips_per_addon: number;
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const TABS = ['Setup', 'Relógio', 'Jogadores', 'Premiação', 'Estatísticas'] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  // Auth gate: quando o Supabase está configurado, exige login (RLS no banco).
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const initialSetup = defaultSetup();
  const [config, setConfig] = useState<AppConfig>({
    name: 'Home Game',
    start_time: nowLocal(),
    setup: initialSetup,
    target_time_minutos: 240,
    duracao_bloco_nivel: 20,
    buy_in_value: 50,
    rebuy_value: 50,
    addon_value: 50,
    chips_per_rebuy: initialStack(initialSetup),
    chips_per_addon: initialStack(initialSetup),
  });
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [payoutPct, setPayoutPct] = useState<number[]>([0.5, 0.3, 0.2]);
  const [tab, setTab] = useState<Tab>('Setup');

  const totals = useMemo(() => {
    const buyins = entries.reduce((s, e) => s + e.buyins, 0);
    const rebuys = entries.reduce((s, e) => s + e.rebuys, 0);
    const addons = entries.reduce((s, e) => s + e.addons, 0);
    return { buyins, rebuys, addons };
  }, [entries]);

  const valorInicial = initialStack(config.setup);
  const playersRemaining = Math.max(1, entries.length);

  const derivedParams: EngineParams = useMemo(() => ({
    qnt_entradas_primarias: Math.max(1, totals.buyins),
    valor_fichas_inicial: valorInicial,
    qnt_acumulada_rebuys: totals.rebuys,
    fichas_por_rebuy: config.chips_per_rebuy,
    qnt_acumulada_addons: totals.addons,
    fichas_por_addon: config.chips_per_addon,
    target_time_minutos: config.target_time_minutos,
    duracao_bloco_nivel: config.duracao_bloco_nivel,
    initial_bb: config.setup.initial_bb,
    smallest_chip: config.setup.smallest_chip,
    players_remaining: playersRemaining,
  }), [totals, valorInicial, config, playersRemaining]);

  const engine = useTournamentEngine(derivedParams);

  // Feedback loop: qualquer mudança de fichas/parâmetros relança a curva
  // e recalcula os níveis futuros, preservando o tempo já decorrido.
  const sig = JSON.stringify(derivedParams);
  useEffect(() => { engine.update_curve(derivedParams); /* eslint-disable-next-line */ }, [sig]);

  const prizePool =
    totals.buyins * config.buy_in_value +
    totals.rebuys * config.rebuy_value +
    totals.addons * config.addon_value;

  const onSave = async () => {
    const start = new Date(config.start_time);
    const end = new Date(start.getTime() + config.target_time_minutos * 60_000);
    await saveTournament({
      name: config.name,
      start_time: start.toISOString(),
      end_time_projected: end.toISOString(),
      total_prize_pool: prizePool,
      buy_in_value: config.buy_in_value,
      rebuy_value: config.rebuy_value,
      addon_value: config.addon_value,
      initial_stack: valorInicial,
      curve_params: {
        ...config.setup,
        target_time_minutos: config.target_time_minutos,
        duracao_bloco_nivel: config.duracao_bloco_nivel,
      },
      payout_structure: payoutPct.map((p, i) => ({
        posicao: i + 1, percentual: p, premio: prizePool * p,
      })),
      status: engine.state.status === 'finished' ? 'finished' : 'running',
      entries,
      levels: engine.levels,
      level_duration_seconds: Math.round(config.duracao_bloco_nivel * 60),
    });
  };

  if (!authReady) return <div className="app"><p className="notice">Carregando…</p></div>;
  if (isSupabaseConfigured && !session) return <Login />;

  return (
    <div className="app">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>♠ Gerenciador Paramétrico de Torneios — Texas Hold'em</h1>
        {session && (
          <button className="ghost" onClick={() => supabase?.auth.signOut()}>Sair</button>
        )}
      </div>
      <p className="notice">
        {totals.buyins} entradas · {totals.rebuys} rebuys · {totals.addons} add-ons ·
        curva de {engine.levels.length} níveis (r={engine.curve.multiplicador_r.toFixed(3)})
      </p>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Setup' && <SetupPanel config={config} onChange={(p) => setConfig({ ...config, ...p })} />}
      {tab === 'Relógio' && <BlindClock engine={engine} />}
      {tab === 'Jogadores' && <PlayersPanel entries={entries} onChange={setEntries} />}
      {tab === 'Premiação' && (
        <PayoutsPanel prizePool={prizePool} playerCount={entries.length}
          percentuais={payoutPct} onChange={setPayoutPct} />
      )}
      {tab === 'Estatísticas' && <StatsPanel onSave={onSave} />}
    </div>
  );
}
