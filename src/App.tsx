// src/App.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import SetupPanel from './components/SetupPanel';
import PlayersPanel from './components/PlayersPanel';
import Clock from './components/Clock';
import PayoutsPanel from './components/PayoutsPanel';
import ResultsPanel from './components/ResultsPanel';
import StatsPanel from './components/StatsPanel';
import Home, { type ResumeInfo } from './screens/Home';
import {
  useTournamentEngine,
  type EngineParams,
  type ClockStatus,
} from './hooks/useTournamentEngine';
import {
  initialStack,
  inserirNivelContinuando,
  calcularCurvaBlinds,
  nivelAuto,
  type BaseSetup,
  type BreakConfig,
  type BlindLevel,
} from './utils/poker-math';
import { addAndSeat, rebalanceSeating } from './utils/seating';
import { applyElimination } from './utils/placements';
import { uuidV4 } from './utils/uuid';
import { quadraPreset } from './presets';
import { saveTournament, listKnownPlayers, type LocalEntry } from './services/tournaments';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import Login from './components/Login';
import ThemePanel from './components/ThemePanel';
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
  max_rebuys: number;      // por jogador; 0 = sem limite
  addon_enabled: boolean;  // se o torneio oferece add-on
  late_checkin_level: number | 'auto'; // 'auto' = nivelAuto(níveis, 0.5)
  ante_enabled: boolean;
  // Nível a partir do qual o ante entra — desacoplado do late check-in (REDESIGN.md S9).
  // 'auto' = nivelAuto(níveis, 0.75). Fiação no motor ao vivo é da S10.
  ante_start_level: number | 'auto';
  breaks: BreakConfig[];
}

interface ClockSnap {
  status: ClockStatus;
  anchorMs: number;
  pausedElapsedMs: number;
  savedAtMs?: number; // epoch do salvamento — reconstrói o elapsed na retomada
}
interface SavedState {
  config: AppConfig;
  entries: LocalEntry[];
  payoutPct: number[];
  screen: Screen;
  clock?: ClockSnap;
  manualLevels?: BlindLevel[] | null;
  liveShareId?: string | null;
  // Piso publicado por índice de nível: o BB que a mesa já viu não desce, nem
  // depois de fechar e reabrir o app (REDESIGN.md S10).
  publishedFloor?: number[] | null;
}

const SAVE_KEY = 'ptm_state_v2';

// Igualdade por conteúdo: o passado congelado só vira estado novo quando muda de
// verdade — identidade nova a cada render realimentaria o motor em laço.
function sameLevels(a: BlindLevel[], b: BlindLevel[]): boolean {
  return a.length === b.length && a.every((l, i) =>
    l.nivel === b[i].nivel &&
    l.small_blind === b[i].small_blind &&
    l.big_blind === b[i].big_blind &&
    (l.ante ?? null) === (b[i].ante ?? null));
}

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
    max_rebuys: 0,          // sem limite
    addon_enabled: true,
    late_checkin_level: 'auto',
    ante_enabled: true,
    ante_start_level: 'auto',
    breaks: [{ after_level: 9, minutes: 15 }], // intervalo após o último nível pré-late
  };
}

// Máquina de telas (REDESIGN.md S11): substitui o stepper fixo de 6 abas.
type Screen = 'home' | 'setup' | 'players' | 'buyin' | 'live' | 'finish' | 'ranking' | 'historico';
// Ordem sequencial navegada por Voltar/Avançar. Home, ranking e histórico só
// são alcançados pelo hub — não fazem parte da sequência.
const FLOW: Screen[] = ['setup', 'players', 'live', 'finish'];

// Formato salvo antes da S11: 6 abas fixas em vez da máquina de telas atual.
type LegacyStage = 'setup' | 'players' | 'payouts' | 'live' | 'results' | 'stats';
const LEGACY_STAGE_TO_SCREEN: Record<LegacyStage, Screen> = {
  setup: 'setup', players: 'players', payouts: 'setup', live: 'live', results: 'finish', stats: 'historico',
};

function loadSaved(): (SavedState & { stage?: LegacyStage }) | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SavedState & { stage?: LegacyStage }) : null;
  } catch {
    return null;
  }
}

// Tela salva pré-S11 usava `stage`; tolera o valor antigo mapeando pra tela nova.
function resolveScreen(saved: (SavedState & { stage?: LegacyStage }) | null): Screen {
  if (!saved) return 'home';
  if (saved.screen) return saved.screen;
  if (saved.stage && LEGACY_STAGE_TO_SCREEN[saved.stage]) return LEGACY_STAGE_TO_SCREEN[saved.stage];
  return 'home';
}

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

  // localStorage é lido uma única vez, no inicializador preguiçoso do useState
  // (fora do corpo do render, que precisa ser puro).
  const [saved] = useState(loadSaved);
  const [config, setConfig] = useState<AppConfig>(saved?.config ?? defaultConfig());
  const [entries, setEntries] = useState<LocalEntry[]>(saved?.entries ?? []);
  const [payoutPct, setPayoutPct] = useState<number[]>(saved?.payoutPct ?? [0.5, 0.3, 0.2]);
  // Reabrir com torneio ao vivo pousa na home (oferece "Retomar"), não direto no
  // relógio — só honra a tela salva quando o torneio ainda não começou.
  const [screen, setScreen] = useState<Screen>(() => {
    const clockStatus = saved?.clock?.status;
    if (clockStatus === 'running' || clockStatus === 'paused') return 'home';
    return resolveScreen(saved);
  });
  const [liveTab, setLiveTab] = useState<'clock' | 'mesa'>('clock');
  // Estrutura editada manualmente ao vivo (null = usar a curva calculada).
  const [manualLevels, setManualLevels] = useState<BlindLevel[] | null>(saved?.manualLevels ?? null);
  // Passado congelado e piso publicado — devolvidos ao motor a cada recalibração.
  const [frozenLevels, setFrozenLevels] = useState<BlindLevel[]>([]);
  const [publishedFloor, setPublishedFloor] = useState<number[] | null>(saved?.publishedFloor ?? null);
  // Transmissão ao vivo (link público /watch/:id).
  const [liveShareId, setLiveShareId] = useState<string | null>(saved?.liveShareId ?? null);
  const [copied, setCopied] = useState(false);
  // Erro da publicação ao vivo (antes só ia para o console).
  const [liveError, setLiveError] = useState<string | null>(null);
  // Aviso quando o relógio salvo não pôde ser retomado como estava.
  const [clockNotice, setClockNotice] = useState<string | null>(null);
  // Painel de personalização visual (cores/fontes/zoom — src/theme.ts).
  const [showTheme, setShowTheme] = useState(false);
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

  // Nº de níveis projetados, só para resolver 'auto' — o motor recalcula a
  // curva de novo internamente (função pura, custo desprezível).
  const projectedLevelCount = useMemo(() => {
    if (manualLevels && manualLevels.length) return manualLevels.length;
    return calcularCurvaBlinds({
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
    }).qnt_niveis_projetados;
  }, [totals, valorInicial, config, effectiveTarget, manualLevels]);

  const resolvedLateCheckinLevel = config.late_checkin_level === 'auto'
    ? nivelAuto(projectedLevelCount, 0.5)
    : config.late_checkin_level;

  // Ante desacoplado do late check-in: default 'auto' = 75% dos níveis.
  const resolvedAnteStartLevel = config.ante_start_level === 'auto'
    ? nivelAuto(projectedLevelCount, 0.75)
    : config.ante_start_level;

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
    late_checkin_level: resolvedLateCheckinLevel,
    ante_enabled: config.ante_enabled,
    ante_start_level: resolvedAnteStartLevel,
    breaks: config.breaks,
    override_levels: manualLevels,
    frozen_levels: frozenLevels,
    published_floor: publishedFloor,
  }), [
    totals, valorInicial, config, playersRemaining, effectiveTarget, manualLevels,
    resolvedLateCheckinLevel, resolvedAnteStartLevel, frozenLevels, publishedFloor,
  ]);

  const engine = useTournamentEngine(derivedParams);

  // Restaura o relógio salvo uma única vez (retomar após fechar).
  // A âncora é epoch absoluto: reabrir horas depois com status `running` faria o
  // elapsed passar da duração total e o torneio nasceria `finished`. Nesse caso
  // volta como `paused` no ponto do último autosave e avisa.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const snap = saved?.clock;
    if (!snap) return;

    const totalMs = engine.items.reduce((acc, it) => acc + it.duration_seconds, 0) * 1000;
    if (snap.status === 'running' && Date.now() - snap.anchorMs > totalMs) {
      const atClose = snap.savedAtMs != null ? Math.max(0, snap.savedAtMs - snap.anchorMs) : 0;
      if (atClose < totalMs) {
        engine.restore({ status: 'paused', anchorMs: snap.anchorMs, pausedElapsedMs: atClose });
        setClockNotice(
          snap.savedAtMs != null
            ? 'Relógio pausado na retomada: o app ficou fechado por mais tempo que a duração do torneio. Restaurado no ponto do último salvamento — confira o nível antes de iniciar.'
            : 'Relógio pausado e zerado na retomada: o app ficou fechado por mais tempo que a duração do torneio e o estado salvo não guardava o horário do salvamento. Ajuste o nível antes de iniciar.'
        );
        return;
      }
    }
    engine.restore(snap);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Passado congelado + piso publicado (REDESIGN.md S10) ────────────────
  // O motor expõe os níveis já jogados; o App guarda em estado (não em ref lido
  // no render) e devolve em `frozen_levels`. A comparação por conteúdo corta o
  // laço: identidade nova a cada render recalcularia a curva para sempre.
  const engineFrozen = engine.frozenLevels;
  useEffect(() => {
    setFrozenLevels((prev) => (sameLevels(prev, engineFrozen) ? prev : engineFrozen));
  }, [engineFrozen]);

  // Piso: a cada recalibração, floor[i] = max(floor[i], bb_novo[i]). Só acumula
  // com o relógio andando — antes de começar, a estrutura pode subir e descer à
  // vontade. Zerar o relógio (novo torneio/preset) descarta o piso.
  const clockStatus = engine.snapshot.status;
  const curveLevels = engine.curve.niveis;
  const prevClockStatusRef = useRef<ClockStatus | null>(null);
  useEffect(() => {
    const prevStatus = prevClockStatusRef.current;
    prevClockStatusRef.current = clockStatus;
    if (clockStatus === 'idle') {
      if (prevStatus && prevStatus !== 'idle') setPublishedFloor(null);
      return;
    }
    setPublishedFloor((prev) => {
      const next = curveLevels.map((n, i) => Math.max(prev?.[i] ?? 0, n.big_blind));
      // Encurtar a curva não apaga o piso dos índices que ficaram de fora.
      if (prev && prev.length > next.length) next.push(...prev.slice(next.length));
      if (prev && prev.length === next.length && prev.every((v, i) => v === next[i])) return prev;
      return next;
    });
  }, [clockStatus, curveLevels]);

  // Autosave: estado geral + snapshot do relógio (a cada 2s e ao fechar).
  // O que gravar vive num ref atualizado por effect (nunca durante o render),
  // então o intervalo é montado uma única vez — sem depender das deps de estado
  // nem do `engine`, que muda de identidade a cada tick.
  const saveRef = useRef<SavedState | null>(null);
  useEffect(() => {
    saveRef.current = {
      config, entries, payoutPct, screen, manualLevels, liveShareId, publishedFloor,
      clock: engine.snapshot,
    };
  });
  useEffect(() => {
    // Sem gravação imediata na montagem: nesse commit o relógio ainda é `idle`
    // (o restore só entra no próximo) e o snapshot bom seria sobrescrito.
    const write = () => {
      const s = saveRef.current;
      if (!s) return;
      const payload: SavedState = {
        ...s,
        clock: s.clock ? { ...s.clock, savedAtMs: Date.now() } : undefined,
      };
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(payload)); } catch { /* quota */ }
    };
    const id = window.setInterval(write, 2000);
    window.addEventListener('beforeunload', write);
    return () => { clearInterval(id); window.removeEventListener('beforeunload', write); };
  }, []);

  // Transmissão ao vivo: publica o estado no Supabase a cada evento relevante
  // (mudou nível/status/âncora/parâmetros/jogadores). O relógio no /watch conta
  // sozinho a partir da âncora, então NÃO publicamos a cada segundo.
  // Com `params` puro, `items`, `curve` e `snapshot` têm identidade estável entre
  // ticks — as deps do effect bastam, sem a assinatura por JSON.stringify.
  const liveSnap = engine.snapshot;
  const liveItems = engine.items;
  const liveChips = engine.curve.c_total;
  useEffect(() => {
    if (!liveShareId || !supabase) return;
    supabase.from('live_state').upsert({
      id: liveShareId,
      name: config.name,
      schedule: liveItems,
      status: liveSnap.status,
      anchor_ms: Math.round(liveSnap.anchorMs),
      paused_elapsed_ms: Math.round(liveSnap.pausedElapsedMs),
      players_remaining: playersRemaining,
      total_chips: Math.round(liveChips),
      updated_at: new Date().toISOString(),
    }).then(({ error }) => {
      setLiveError(error ? error.message : null);
      if (error) console.warn('live upsert:', error.message);
    });
  }, [liveShareId, config.name, liveItems, liveSnap, playersRemaining, liveChips]);

  // Posições aleatórias ao iniciar a fase ao vivo (se ninguém sentado ainda).
  useEffect(() => {
    if (screen === 'live' && entries.some((e) => !e.eliminated) && !entries.some((e) => e.table)) {
      setEntries((prev) => rebalanceSeating(prev));
    }
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  const prizePool =
    totals.buyins * config.buy_in_value +
    totals.rebuys * config.rebuy_value +
    totals.addons * config.addon_value;

  // Prêmios sempre em dia: recalcula o valor de todos os colocados quando o
  // pote (rebuys/add-ons) ou os percentuais da premiação mudam.
  useEffect(() => {
    setEntries((prev) => {
      let changed = false;
      const next = prev.map((e) => {
        if (!e.final_placement) return e;
        const target = prizePool * (payoutPct[e.final_placement - 1] ?? 0);
        if (Math.abs((e.payout_amount ?? 0) - target) > 1e-6) { changed = true; return { ...e, payout_amount: target }; }
        return e;
      });
      return changed ? next : prev;
    });
  }, [prizePool, payoutPct]);

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
  // O engine reancora sozinho para preservar o nível em jogo; apagar justamente
  // o nível corrente é a exceção — aí o relógio muda de nível, então confirma.
  const deleteLevel = (levelNumber: number) => {
    const base = materialize().filter((n) => n.nivel !== levelNumber);
    if (base.length < 2) return;
    if (
      engine.state.status !== 'idle' &&
      engine.state.kind === 'level' &&
      levelNumber === engine.state.level_number &&
      !confirm(
        `O nível ${levelNumber} é o que está em jogo agora. Apagar mesmo assim? ` +
        'O relógio passará para o nível que ocupar o lugar dele, no mesmo tempo decorrido.'
      )
    ) return;
    setManualLevels(renumber(base));
  };

  // Remove um intervalo — sem alterar o tempo total de jogo (níveis ficam iguais).
  const deleteBreak = (afterLevelNumber: number) => {
    setManualLevels(materialize()); // congela níveis para o total não mudar
    patchConfig({ breaks: config.breaks.filter((b) => b.after_level !== afterLevelNumber) });
  };

  // Transmissão ao vivo.
  const liveUrl = liveShareId ? `${window.location.origin}/watch/${liveShareId}` : '';
  const publicarAoVivo = () => {
    setLiveError(null);
    setLiveShareId(uuidV4());
  };
  const pararTransmissao = () => {
    setLiveError(null);
    if (liveShareId && supabase) {
      supabase.from('live_state').delete().eq('id', liveShareId).then(({ error }) => {
        if (error) console.warn('Erro ao deletar live_state:', error.message);
      });
    }
    setLiveShareId(null);
  };
  const copiarLink = async () => {
    try { await navigator.clipboard.writeText(liveUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard indisponível */ }
  };

  // Eliminação ao vivo → preenche colocação e prêmio automaticamente.
  // Renumera a lista inteira: reviver um jogador muda a colocação de todos os
  // que caíram antes dele (ver src/utils/placements.ts).
  const toggleEliminated = (index: number, eliminate: boolean) => {
    setEntries((prev) => applyElimination(prev, index, eliminate, prizePool, payoutPct));
  };

  // Apaga o torneio atual e volta para a tela indicada. Usado tanto pelo botão
  // "Novo torneio" do cabeçalho (sempre confirma, volta pra home) quanto pelo
  // "Criar torneio" da home quando já existe um torneio ao vivo em andamento.
  const resetTorneio = (target: Screen) => {
    localStorage.removeItem(SAVE_KEY);
    engine.reset();
    setConfig(defaultConfig());
    setEntries([]);
    setPayoutPct([0.5, 0.3, 0.2]);
    setManualLevels(null);
    setFrozenLevels([]);
    setPublishedFloor(null);
    setLiveShareId(null);
    setScreen(target);
  };

  const novoTorneio = () => {
    if (!confirm('Começar um torneio novo? Os dados atuais serão apagados.')) return;
    resetTorneio('home');
  };

  // "● Criar torneio" da home: só confirma/apaga se houver torneio ao vivo em
  // andamento (relógio rodando ou pausado). Sem torneio ativo, só navega.
  const criarTorneio = () => {
    const emAndamento = engine.state.status === 'running' || engine.state.status === 'paused';
    if (emAndamento) {
      if (!confirm('Um torneio está em andamento. Começar um novo agora apaga o progresso atual. Continuar?')) return;
      resetTorneio('setup');
      return;
    }
    setScreen('setup');
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

  // Voltar/Avançar só navegam dentro da sequência do torneio (setup→players→
  // live→finish). Home, ranking e histórico não têm posição nela — só chegam
  // lá pelo hub — então a nav-row fica escondida nessas três telas.
  const flowIdx = FLOW.indexOf(screen);
  const go = (d: number) => setScreen(FLOW[Math.min(Math.max(0, flowIdx + d), FLOW.length - 1)]);
  const showNavRow = flowIdx !== -1;
  const resumeInfo: ResumeInfo | null =
    (engine.state.status === 'running' || engine.state.status === 'paused')
      ? { name: config.name, levelNumber: engine.state.level_number, totalLevels: engine.state.total_levels, playersRemaining }
      : null;

  return (
    <div className="app">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>♠ Gerenciador de Torneios — Texas Hold'em</h1>
          <p className="credit">Criado por @RodLisboa_</p>
        </div>
        <div className="row">
          {screen !== 'home' && <button className="ghost" onClick={() => setScreen('home')}>← Início</button>}
          <button className="ghost" onClick={() => setShowTheme(true)} title="Personalização visual">🎨 Personalizar</button>
          <button className="ghost" onClick={novoTorneio}>Novo torneio</button>
          {session && <button className="ghost" onClick={() => supabase?.auth.signOut()}>Sair</button>}
        </div>
      </div>
      {screen !== 'home' && (
        <p className="notice">
          {totals.buyins} entradas · {totals.rebuys} rebuys · {totals.addons} add-ons ·
          {' '}{playersRemaining} na mesa · {engine.state.total_levels} níveis
          {manualLevels ? ' (editado)' : ` (r=${engine.curve.multiplicador_r.toFixed(3)})`}
          {engine.floorHeld && ' · estrutura recalibrada (piso mantido)'}
        </p>
      )}

      {clockNotice && (
        <div className="panel" style={{ borderColor: 'var(--gold)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <p className="notice" style={{ margin: 0, color: 'var(--gold)' }}>⚠ {clockNotice}</p>
            <button className="ghost" onClick={() => setClockNotice(null)}>Entendi</button>
          </div>
        </div>
      )}

      {screen === 'home' && (
        <Home
          resume={resumeInfo}
          onResume={() => setScreen('live')}
          onCreate={criarTorneio}
          onOpenRanking={() => setScreen('ranking')}
          onOpenHistorico={() => setScreen('historico')}
        />
      )}

      {screen === 'setup' && (
        <>
          <SetupPanel config={config} onChange={patchConfig}
            onRestoreDefaults={() => { const d = defaultConfig(); setConfig({ ...d, start_time: config.start_time }); setManualLevels(null); }}
            onPreset={(p) => {
              engine.reset();
              if (p === 'custom') { setConfig({ ...defaultConfig(), start_time: config.start_time }); setManualLevels(null); }
              else if (p === 'quadra') { const q = quadraPreset(); setConfig({ ...q.config, start_time: config.start_time }); setManualLevels(q.manualLevels); if (q.payoutPct) setPayoutPct(q.payoutPct); }
            }} />
          {/* Premiação incorporada à tela de configuração (não é mais etapa própria).
              Vira bloco recolhível dentro do SetupPanel na S12 (wizard). */}
          <PayoutsPanel prizePool={prizePool} playerCount={entries.length}
            percentuais={payoutPct} onChange={setPayoutPct} />
        </>
      )}

      {screen === 'players' && <PlayersPanel entries={entries} onChange={setEntries} mode="setup" knownPlayers={knownPlayers}
        maxRebuys={config.max_rebuys} addonEnabled={config.addon_enabled} />}

      {screen === 'live' && (
        <>
          {isSupabaseConfigured && session && (
            <div className="panel live-share">
              {!liveShareId ? (
                <button className="ghost" onClick={publicarAoVivo}>🔴 Publicar ao vivo (gerar link)</button>
              ) : (
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="row" style={{ flex: 1, minWidth: 0 }}>
                    <span className="pill" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>● no ar</span>
                    <input readOnly value={liveUrl} style={{ flex: 1, minWidth: 120 }} onFocus={(e) => e.target.select()} />
                    <button className="ghost" onClick={copiarLink}>{copied ? '✓ copiado' : 'Copiar'}</button>
                  </div>
                  <button className="danger" onClick={pararTransmissao}>Parar</button>
                </div>
              )}
              {liveError && (
                <p className="notice" style={{ marginTop: 6, color: 'var(--danger)' }}>
                  ⚠ Transmissão não publicada: {liveError}
                </p>
              )}
              <p className="notice" style={{ marginTop: 6 }}>
                Quem abrir o link acompanha o relógio em tempo real, sem login. Abra numa TV/tela.
              </p>
            </div>
          )}
          <div className="tabs">
            <button className={liveTab === 'clock' ? 'active' : ''} onClick={() => setLiveTab('clock')}>Relógio</button>
            <button className={liveTab === 'mesa' ? 'active' : ''} onClick={() => setLiveTab('mesa')}>Mesa</button>
            <button className="ghost" onClick={inserirIntervaloAgora}>+ Intervalo após nível atual</button>
          </div>
          {liveTab === 'clock'
            ? <Clock engine={engine} editable
                onAddLevelAfter={addLevelAfter} onDeleteLevel={deleteLevel} onDeleteBreak={deleteBreak} />
            : <PlayersPanel entries={entries} onChange={setEntries} mode="live" knownPlayers={knownPlayers}
                maxRebuys={config.max_rebuys} addonEnabled={config.addon_enabled}
                onAddLive={(name) => setEntries((prev) => addAndSeat(prev, name))}
                onRebalance={() => setEntries((prev) => rebalanceSeating(prev))}
                onEliminate={toggleEliminated} />}
        </>
      )}

      {screen === 'finish' && (
        <ResultsPanel entries={entries} onChange={setEntries}
          payoutPct={payoutPct} prizePool={prizePool}
          buyInValue={config.buy_in_value} rebuyValue={config.rebuy_value} addonValue={config.addon_value} />
      )}

      {/* Ranking e Histórico reaproveitam o StatsPanel até a S14 separá-los em
          telas próprias (Ranking.tsx / Historico.tsx). */}
      {(screen === 'ranking' || screen === 'historico') && <StatsPanel onSave={onSave} />}

      {showTheme && <ThemePanel onClose={() => setShowTheme(false)} />}

      {showNavRow && (
        <div className="row nav-row">
          <button className="ghost" disabled={flowIdx === 0} onClick={() => go(-1)}>← Voltar</button>
          <button className="primary" disabled={flowIdx === FLOW.length - 1} onClick={() => go(1)}>
            Avançar →
          </button>
        </div>
      )}
    </div>
  );
}
