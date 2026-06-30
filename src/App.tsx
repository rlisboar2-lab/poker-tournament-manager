// src/App.tsx
import { useEffect, useMemo, useState } from 'react';
import SetupPanel from './components/SetupPanel';
import PlayersPanel from './components/PlayersPanel';
import Clock from './components/Clock';
import PayoutsPanel from './components/PayoutsPanel';
import ResultsPanel from './components/ResultsPanel';
import StatsPanel from './components/StatsPanel';
import {
  useTournamentEngine,
  type EngineParams,
} from './hooks/useTournamentEngine';
import {
  defaultSetup,
  initialStack,
  type BaseSetup,
  type BreakConfig,
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
  late_checkin_level: number;
  ante_enabled: boolean;
  breaks: BreakConfig[];
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const STAGES = [
  { id: 'setup', label: '1. Torneio' },
  { id: 'players', label: '2. Jogadores' },
  { id: 'payouts', label: '3. Premiação' },
  { id: 'live', label: '4. Ao vivo' },
  { id: 'results', label: '5. Resultado' },
  { id: 'stats', label: '6. Estatísticas' },
] as const;
type Stage = (typeof STAGES)[number]['id'];

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
    late_checkin_level: 4,
    ante_enabled: true,
    breaks: [],
  });
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [payoutPct, setPayoutPct] = useState<number[]>([0.5, 0.3, 0.2]);
  const [stage, setStage] = useState<Stage>('setup');
  const [liveTab, setLiveTab] = useState<'clock' | 'mesa'>('clock');

  const totals = useMemo(() => ({
    buyins: entries.reduce((s, e) => s + e.buyins, 0),
    rebuys: entries.reduce((s, e) => s + e.rebuys, 0),
    addons: entries.reduce((s, e) => s + e.addons, 0),
  }), [entries]);

  const valorInicial = initialStack(config.setup);
  const playersRemaining = Math.max(1, entries.filter((e) => !e.eliminated).length);

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
    late_checkin_level: config.late_checkin_level,
    ante_enabled: config.ante_enabled,
    breaks: config.breaks,
  }), [totals, valorInicial, config, playersRemaining]);

  const engine = useTournamentEngine(derivedParams);

  // Feedback loop: qualquer mudança de fichas/parâmetros relança a curva
  // e recalcula os níveis futuros, preservando o tempo já decorrido.
  const sig = JSON.stringify(derivedParams);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { engine.update_curve(derivedParams); }, [sig]);

  const prizePool =
    totals.buyins * config.buy_in_value +
    totals.rebuys * config.rebuy_value +
    totals.addons * config.addon_value;

  const patchConfig = (p: Partial<AppConfig>) => setConfig((c) => ({ ...c, ...p }));

  const inserirIntervaloAgora = () => {
    const afterLvl = Math.max(1, engine.state.level_number);
    if (config.breaks.some((b) => b.after_level === afterLvl)) return;
    patchConfig({ breaks: [...config.breaks, { after_level: afterLvl, minutes: 10 }] });
  };

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
      status: 'finished',
      entries,
      levels: engine.curve.niveis,
      level_duration_seconds: Math.round(config.duracao_bloco_nivel * 60),
    });
  };

  if (!authReady) return <div className="app"><p className="notice">Carregando…</p></div>;
  if (isSupabaseConfigured && !session) return <Login />;

  const stageIdx = STAGES.findIndex((s) => s.id === stage);
  const go = (d: number) => {
    const i = Math.min(Math.max(0, stageIdx + d), STAGES.length - 1);
    setStage(STAGES[i].id);
  };

  return (
    <div className="app">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>♠ Gerenciador de Torneios — Texas Hold'em</h1>
        {session && (
          <button className="ghost" onClick={() => supabase?.auth.signOut()}>Sair</button>
        )}
      </div>
      <p className="notice">
        {totals.buyins} entradas · {totals.rebuys} rebuys · {totals.addons} add-ons ·
        {' '}{playersRemaining} na mesa · curva de {engine.curve.niveis.length} níveis
        {' '}(r={engine.curve.multiplicador_r.toFixed(3)})
      </p>

      <div className="tabs stepper">
        {STAGES.map((s) => (
          <button key={s.id} className={stage === s.id ? 'active' : ''} onClick={() => setStage(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {stage === 'setup' && <SetupPanel config={config} onChange={patchConfig} />}

      {stage === 'players' && <PlayersPanel entries={entries} onChange={setEntries} mode="setup" />}

      {stage === 'payouts' && (
        <PayoutsPanel prizePool={prizePool} playerCount={entries.length}
          percentuais={payoutPct} onChange={setPayoutPct} />
      )}

      {stage === 'live' && (
        <>
          <div className="tabs">
            <button className={liveTab === 'clock' ? 'active' : ''} onClick={() => setLiveTab('clock')}>Relógio</button>
            <button className={liveTab === 'mesa' ? 'active' : ''} onClick={() => setLiveTab('mesa')}>Mesa</button>
            <button className="ghost" onClick={inserirIntervaloAgora}>+ Intervalo após nível atual</button>
          </div>
          {liveTab === 'clock'
            ? <Clock engine={engine} />
            : <PlayersPanel entries={entries} onChange={setEntries} mode="live" />}
        </>
      )}

      {stage === 'results' && (
        <ResultsPanel entries={entries} onChange={setEntries}
          payoutPct={payoutPct} prizePool={prizePool}
          buyInValue={config.buy_in_value} rebuyValue={config.rebuy_value} addonValue={config.addon_value} />
      )}

      {stage === 'stats' && <StatsPanel onSave={onSave} />}

      <div className="row nav-row">
        <button className="ghost" disabled={stageIdx === 0} onClick={() => go(-1)}>← Voltar</button>
        <button className="primary" disabled={stageIdx === STAGES.length - 1} onClick={() => go(1)}>
          Avançar →
        </button>
      </div>
    </div>
  );
}
