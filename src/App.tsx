// src/App.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import SetupPanel from './components/SetupPanel';
import PlayersPanel from './components/PlayersPanel';
import Clock from './components/Clock';
import PayoutsPanel from './components/PayoutsPanel';
import ResultsPanel from './components/ResultsPanel';
import StatsPanel from './components/StatsPanel';
import {
  useTournamentEngine,
  type EngineParams,
  type ClockStatus,
} from './hooks/useTournamentEngine';
import {
  initialStack,
  inserirNivelContinuando,
  type BaseSetup,
  type BreakConfig,
  type BlindLevel,
} from './utils/poker-math';
import { addAndSeat, rebalanceSeating } from './utils/seating';
import { saveTournament, listKnownPlayers, type LocalEntry } from './services/tournaments';
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

interface ClockSnap { status: ClockStatus; anchorMs: number; pausedElapsedMs: number; }
interface SavedState {
  config: AppConfig;
  entries: LocalEntry[];
  payoutPct: number[];
  stage: Stage;
  clock?: ClockSnap;
  manualLevels?: BlindLevel[] | null;
}

const SAVE_KEY = 'ptm_state_v2';

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function defaultConfig(): AppConfig {
  const setup: BaseSetup = { smallest_chip: 5, initial_sb: 5, initial_bb: 10, stack_bb: 300 };
  return {
    name: 'Home Game',
    start_time: nowLocal(),
    setup,
    target_time_minutos: 240,
    duracao_bloco_nivel: 20,
    buy_in_value: 10,
    rebuy_value: 15,
    addon_value: 20,
    chips_per_rebuy: initialStack(setup), // 3000
    chips_per_addon: initialStack(setup),
    late_checkin_level: 9,
    ante_enabled: true,
    breaks: [{ after_level: 9, minutes: 15 }], // intervalo após o último nível pré-late
  };
}

function loadSaved(): SavedState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SavedState) : null;
  } catch {
    return null;
  }
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
  // Auth gate.
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

  const saved = useRef<SavedState | null>(loadSaved()).current;
  const [config, setConfig] = useState<AppConfig>(saved?.config ?? defaultConfig());
  const [entries, setEntries] = useState<LocalEntry[]>(saved?.entries ?? []);
  const [payoutPct, setPayoutPct] = useState<number[]>(saved?.payoutPct ?? [0.5, 0.3, 0.2]);
  const [stage, setStage] = useState<Stage>(saved?.stage ?? 'setup');
  const [liveTab, setLiveTab] = useState<'clock' | 'mesa'>('clock');
  // Estrutura editada manualmente ao vivo (null = usar a curva calculada).
  const [manualLevels, setManualLevels] = useState<BlindLevel[] | null>(saved?.manualLevels ?? null);
  // Jogadores já cadastrados (para reaproveitar nomes ao adicionar buy-in).
  const [knownPlayers, setKnownPlayers] = useState<string[]>([]);
  useEffect(() => {
    listKnownPlayers().then((ps) => setKnownPlayers(ps.map((p) => p.display_name))).catch(() => {});
  }, [session]);

  const totals = useMemo(() => ({
    buyins: entries.reduce((s, e) => s + e.buyins, 0),
    rebuys: entries.reduce((s, e) => s + e.rebuys, 0),
    addons: entries.reduce((s, e) => s + e.addons, 0),
  }), [entries]);

  const valorInicial = initialStack(config.setup);
  const playersRemaining = Math.max(1, entries.filter((e) => !e.eliminated).length);
  const sumBreakMin = config.breaks.reduce((s, b) => s + (b.minutes || 0), 0);
  // Mantém o torneio dentro do tempo máximo: desconta os intervalos do orçamento.
  const effectiveTarget = Math.max(
    config.duracao_bloco_nivel * 2,
    config.target_time_minutos - sumBreakMin
  );

  const derivedParams: EngineParams = useMemo(() => ({
    qnt_entradas_primarias: Math.max(1, totals.buyins),
    valor_fichas_inicial: valorInicial,
    qnt_acumulada_rebuys: totals.rebuys,
    fichas_por_rebuy: config.chips_per_rebuy,
    qnt_acumulada_addons: totals.addons,
    fichas_por_addon: config.chips_per_addon,
    target_time_minutos: effectiveTarget,
    duracao_bloco_nivel: config.duracao_bloco_nivel,
    initial_bb: config.setup.initial_bb,
    smallest_chip: config.setup.smallest_chip,
    players_remaining: playersRemaining,
    late_checkin_level: config.late_checkin_level,
    ante_enabled: config.ante_enabled,
    breaks: config.breaks,
    override_levels: manualLevels,
  }), [totals, valorInicial, config, playersRemaining, effectiveTarget, manualLevels]);

  const engine = useTournamentEngine(derivedParams);

  // Restaura o relógio salvo uma única vez (retomar após fechar).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!restoredRef.current && saved?.clock) {
      engine.restore(saved.clock);
    }
    restoredRef.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sig = JSON.stringify(derivedParams);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { engine.update_curve(derivedParams); }, [sig]);

  // Autosave: estado geral + snapshot do relógio (a cada 2s e ao fechar).
  useEffect(() => {
    const write = () => {
      const s: SavedState = { config, entries, payoutPct, stage, manualLevels, clock: engine.snapshot() };
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* quota */ }
    };
    write();
    const id = window.setInterval(write, 2000);
    window.addEventListener('beforeunload', write);
    return () => { clearInterval(id); window.removeEventListener('beforeunload', write); };
  }, [config, entries, payoutPct, stage, manualLevels, engine]);

  // Posições aleatórias ao iniciar a fase ao vivo (se ninguém sentado ainda).
  useEffect(() => {
    if (stage === 'live' && entries.some((e) => !e.eliminated) && !entries.some((e) => e.table)) {
      setEntries((prev) => rebalanceSeating(prev));
    }
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Congela a estrutura atual em níveis editáveis manualmente.
  const materialize = (): BlindLevel[] =>
    (manualLevels ?? engine.curve.niveis).map((n) => ({ ...n }));
  const renumber = (arr: BlindLevel[]) => arr.map((n, i) => ({ ...n, nivel: i + 1 }));

  // Adiciona um nível após `levelNumber`, reprojetando a cauda da curva
  // (a progressão continua suave até o BB final e o tempo total aumenta).
  const addLevelAfter = (levelNumber: number) => {
    setManualLevels(inserirNivelContinuando(materialize(), levelNumber, config.setup.smallest_chip));
  };

  // Remove um nível (recalcula o tempo total, que diminui).
  const deleteLevel = (levelNumber: number) => {
    const base = materialize().filter((n) => n.nivel !== levelNumber);
    if (base.length < 2) return;
    setManualLevels(renumber(base));
  };

  // Remove um intervalo — sem alterar o tempo total de jogo (níveis ficam iguais).
  const deleteBreak = (afterLevelNumber: number) => {
    setManualLevels(materialize()); // congela níveis para o total não mudar
    patchConfig({ breaks: config.breaks.filter((b) => b.after_level !== afterLevelNumber) });
  };

  // Eliminação ao vivo → preenche colocação e prêmio automaticamente.
  // Quem cai primeiro fica em último; o último de pé é o 1º.
  const toggleEliminated = (index: number, eliminate: boolean) => {
    setEntries((prev) => {
      const activeCount = prev.filter((e) => !e.eliminated).length;
      let next = prev.map((e, i) => {
        if (i !== index) return e;
        if (eliminate) {
          const placement = activeCount; // termina nesta colocação
          const pct = payoutPct[placement - 1] ?? 0;
          return { ...e, eliminated: true, table: undefined, seat: undefined,
            final_placement: placement, payout_amount: prizePool * pct };
        }
        return { ...e, eliminated: false, final_placement: undefined, payout_amount: undefined };
      });
      // Sobrando 1 ativo, ele é o campeão (1º); com mais de 1, ninguém é 1º ainda.
      const active = next.filter((e) => !e.eliminated);
      if (active.length === 1) {
        const champ = active[0];
        next = next.map((e) => e === champ
          ? { ...e, final_placement: 1, payout_amount: prizePool * (payoutPct[0] ?? 0) }
          : e);
      } else {
        next = next.map((e) => (!e.eliminated && e.final_placement === 1)
          ? { ...e, final_placement: undefined, payout_amount: undefined } : e);
      }
      return next;
    });
  };

  const novoTorneio = () => {
    if (!confirm('Começar um torneio novo? Os dados atuais serão apagados.')) return;
    localStorage.removeItem(SAVE_KEY);
    engine.reset();
    setConfig(defaultConfig());
    setEntries([]);
    setPayoutPct([0.5, 0.3, 0.2]);
    setManualLevels(null);
    setStage('setup');
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
  const go = (d: number) => setStage(STAGES[Math.min(Math.max(0, stageIdx + d), STAGES.length - 1)].id);

  return (
    <div className="app">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>♠ Gerenciador de Torneios — Texas Hold'em</h1>
          <p className="credit">Criado por @RodLisboa_</p>
        </div>
        <div className="row">
          <button className="ghost" onClick={novoTorneio}>Novo torneio</button>
          {session && <button className="ghost" onClick={() => supabase?.auth.signOut()}>Sair</button>}
        </div>
      </div>
      <p className="notice">
        {totals.buyins} entradas · {totals.rebuys} rebuys · {totals.addons} add-ons ·
        {' '}{playersRemaining} na mesa · {engine.state.total_levels} níveis
        {manualLevels ? ' (editado)' : ` (r=${engine.curve.multiplicador_r.toFixed(3)})`}
      </p>

      <div className="tabs stepper">
        {STAGES.map((s) => (
          <button key={s.id} className={stage === s.id ? 'active' : ''} onClick={() => setStage(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {stage === 'setup' && (
        <SetupPanel config={config} onChange={patchConfig}
          onRestoreDefaults={() => { const d = defaultConfig(); setConfig({ ...d, start_time: config.start_time }); setManualLevels(null); }} />
      )}

      {stage === 'players' && <PlayersPanel entries={entries} onChange={setEntries} mode="setup" knownPlayers={knownPlayers} />}

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
            ? <Clock engine={engine} editable
                onAddLevelAfter={addLevelAfter} onDeleteLevel={deleteLevel} onDeleteBreak={deleteBreak} />
            : <PlayersPanel entries={entries} onChange={setEntries} mode="live" knownPlayers={knownPlayers}
                onAddLive={(name) => setEntries((prev) => addAndSeat(prev, name))}
                onRebalance={() => setEntries((prev) => rebalanceSeating(prev))}
                onEliminate={toggleEliminated} />}
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
