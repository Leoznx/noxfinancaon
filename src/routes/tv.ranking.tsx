import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trophy,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { setRememberMe } from "@/lib/authStorage";
import {
  fetchTvSalesDashboard,
  goalForSeller,
  sellerGoalPercentage,
  type TvRankingSeller,
  type TvSalesDashboardSnapshot,
  type TvSellerType,
} from "@/lib/tv-sales-dashboard";

export const Route = createFileRoute("/tv/ranking")({
  component: TvRankingRoute,
});

const CACHE_KEY = "nox_tv_sales_dashboard_v1";
const ROWS_PER_PAGE = 5;
const FALLBACK_REFRESH_MS = 60_000;
const FULL_SYNC_MS = 60 * 60_000;
const PAGE_ROTATION_MS = 18_000;
const LIVE_TABLES = [
  "seller_signup_attributions",
  "seller_client_partnerships",
  "seller_commissions",
  "seller_team_goals",
  "seller_appointments",
] as const;

function readCachedSnapshot(): TvSalesDashboardSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "null");
    if (!parsed || !Array.isArray(parsed.ranking) || !Array.isArray(parsed.goals)) return null;
    return parsed as TvSalesDashboardSnapshot;
  } catch {
    return null;
  }
}

function TvRankingRoute() {
  const { user, isLoading, logout } = useAuth();

  if (isLoading) return <TvLoading message="Preparando o painel comercial…" />;
  if (!user) return <TvLogin />;

  const authorized =
    user.role === "admin" || user.role === "admin_master" || user.internalRole === "admin_master";

  if (!authorized) {
    return (
      <TvFrame>
        <main className="tv-center-card" role="alert">
          <ShieldCheck size={54} />
          <h1>Acesso administrativo necessário</h1>
          <p>Este painel contém indicadores internos da equipe comercial.</p>
          <button className="tv-action" type="button" onClick={() => void logout()} autoFocus>
            <LogOut size={22} /> Sair e trocar a conta
          </button>
        </main>
      </TvFrame>
    );
  }

  return <TvDashboard onLogout={logout} />;
}

function TvLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError("");
    try {
      setRememberMe(true);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <TvFrame>
      <main className="tv-login-shell">
        <section className="tv-login-brand" aria-label="NOX Fiança">
          <img src="/brand/nox-fianca-header-amarelo.svg" alt="NOX Fiança" />
          <div className="tv-login-copy">
            <span>PAINEL COMERCIAL PARA TV</span>
            <h1>Resultados que todo o time acompanha.</h1>
            <p>Ranking e metas sincronizados com o site e o aplicativo da NOX.</p>
          </div>
          <div className="tv-login-features">
            <span>
              <CheckCircle2 /> Atualização em tempo real
            </span>
            <span>
              <CheckCircle2 /> Recuperação automática
            </span>
            <span>
              <CheckCircle2 /> Operação pelo controle remoto
            </span>
          </div>
        </section>

        <form className="tv-login-card" onSubmit={submit}>
          <div className="tv-login-icon">
            <Trophy />
          </div>
          <h2>Entrar no painel</h2>
          <p>Use uma conta Admin ou Admin Master da NOX.</p>
          <label htmlFor="tv-email">E-mail</label>
          <input
            id="tv-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoFocus
          />
          <label htmlFor="tv-password">Senha</label>
          <input
            id="tv-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <div className="tv-login-error">
              <AlertTriangle /> {error}
            </div>
          ) : null}
          <button className="tv-login-submit" type="submit" disabled={submitting}>
            {submitting ? <RefreshCw className="tv-spin" /> : <ShieldCheck />}
            {submitting ? "Entrando…" : "Abrir painel"}
          </button>
        </form>
      </main>
    </TvFrame>
  );
}

function TvDashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const today = useMemo(() => new Date(), []);
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const requestSequence = useRef(0);
  const eventDebounce = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<TvSalesDashboardSnapshot | null>(readCachedSnapshot);
  const hadInitialSnapshot = useRef(Boolean(snapshot));
  const [loading, setLoading] = useState(!snapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [page, setPage] = useState(0);

  const load = useCallback(
    async (background = false) => {
      const sequence = ++requestSequence.current;
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const next = await fetchTvSalesDashboard(month, year);
        if (sequence !== requestSequence.current) return;
        setSnapshot(next);
        setError("");
        try {
          window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
        } catch {}
      } catch (cause) {
        if (sequence !== requestSequence.current) return;
        setError(cause instanceof Error ? cause.message : "Não foi possível sincronizar os dados.");
      } finally {
        if (sequence === requestSequence.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [month, year],
  );

  useEffect(() => void load(hadInitialSnapshot.current), [load]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClock(new Date()), 1_000);
    const fallbackTimer = window.setInterval(() => void load(true), FALLBACK_REFRESH_MS);
    const fullSyncTimer = window.setInterval(() => void load(true), FULL_SYNC_MS);
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(fallbackTimer);
      window.clearInterval(fullSyncTimer);
    };
  }, [load]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void load(true);
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [load]);

  useEffect(() => {
    const refreshAfterEvent = () => {
      if (eventDebounce.current) window.clearTimeout(eventDebounce.current);
      eventDebounce.current = window.setTimeout(() => void load(true), 700);
    };
    let channel = supabase.channel("nox-tv-commercial-live");
    for (const table of LIVE_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        refreshAfterEvent,
      );
    }
    channel.subscribe((status) => setRealtimeReady(status === "SUBSCRIBED"));
    return () => {
      if (eventDebounce.current) window.clearTimeout(eventDebounce.current);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const sdrs = useMemo(
    () => snapshot?.ranking.filter((seller) => seller.sellerType === "sdr") ?? [],
    [snapshot],
  );
  const closers = useMemo(
    () => snapshot?.ranking.filter((seller) => seller.sellerType === "closer") ?? [],
    [snapshot],
  );
  const pageCount = Math.max(1, Math.ceil(Math.max(sdrs.length, closers.length) / ROWS_PER_PAGE));

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
    if (pageCount <= 1) return;
    const timer = window.setInterval(
      () => setPage((current) => (current + 1) % pageCount),
      PAGE_ROTATION_MS,
    );
    return () => window.clearInterval(timer);
  }, [pageCount]);

  if (loading && !snapshot) return <TvLoading message="Sincronizando ranking e metas…" />;

  // Não soma as duas especialidades: o mesmo cliente pode aparecer na
  // atribuição do SDR e no trabalho do Closer. Cadastros pertencem ao time SDR;
  // contratos fechados pertencem ao time Closer, evitando contagem duplicada.
  const totalRegistrations = sdrs.reduce((sum, row) => sum + row.registrations, 0);
  const totalContracts = (closers.length ? closers : sdrs).reduce(
    (sum, row) => sum + row.contracts,
    0,
  );
  const conversion =
    totalRegistrations > 0 ? Math.round((totalContracts / totalRegistrations) * 100) : 0;
  const generatedAt = snapshot ? new Date(snapshot.generatedAt) : null;
  const pageStart = page * ROWS_PER_PAGE;

  return (
    <TvFrame>
      <main className="tv-dashboard">
        <header className="tv-header">
          <div className="tv-brand-row">
            <img src="/brand/nox-fianca-header-amarelo.svg" alt="NOX Fiança" />
            <span>PAINEL COMERCIAL</span>
          </div>
          <div className="tv-header-status">
            <span className={`tv-live-pill ${online && realtimeReady ? "is-live" : ""}`}>
              {online ? <Wifi size={18} /> : <WifiOff size={18} />}
              {!online ? "Sem internet" : realtimeReady ? "Tempo real ativo" : "Reconectando"}
            </span>
            <span className="tv-clock">
              <Clock3 size={18} /> {formatClock(clock)}
            </span>
            <button
              className="tv-icon-button"
              type="button"
              aria-label="Atualizar painel"
              title="Atualizar painel"
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "tv-spin" : ""} />
            </button>
            <button
              className="tv-icon-button"
              type="button"
              aria-label="Sair"
              title="Sair"
              onClick={() => void onLogout()}
            >
              <LogOut />
            </button>
          </div>
        </header>

        <section className="tv-summary-grid" aria-label="Resumo do mês">
          <SummaryCard
            icon={<Users />}
            label="Equipe comercial"
            value={snapshot?.ranking.length ?? 0}
            suffix="pessoas"
          />
          <SummaryCard
            icon={<Trophy />}
            label="Cadastros no mês"
            value={totalRegistrations}
            suffix="novos"
          />
          <SummaryCard
            icon={<CheckCircle2 />}
            label="Contratos ativos"
            value={totalContracts}
            suffix="fechados"
          />
          <SummaryCard icon={<RefreshCw />} label="Conversão geral" value={conversion} suffix="%" />
        </section>

        {error ? (
          <div className="tv-warning" role="status">
            <AlertTriangle /> {error} Exibindo a última atualização disponível.
          </div>
        ) : null}

        <section className="tv-rankings" aria-label="Ranking da equipe">
          <RankingPanel
            title="Ranking de vendedores"
            subtitle="SDR · cadastros e reuniões agendadas"
            team="sdr"
            rows={sdrs.slice(pageStart, pageStart + ROWS_PER_PAGE)}
            goals={snapshot?.goals ?? []}
          />
          <RankingPanel
            title="Ranking de closers"
            subtitle="Closer · contratos e reuniões concluídas"
            team="closer"
            rows={closers.slice(pageStart, pageStart + ROWS_PER_PAGE)}
            goals={snapshot?.goals ?? []}
          />
        </section>

        <footer className="tv-footer">
          <span>
            {pageCount > 1
              ? `Página ${page + 1} de ${pageCount} · troca automática`
              : "Ranking mensal completo"}
          </span>
          <span>
            {generatedAt
              ? `Sincronizado às ${formatClock(generatedAt)}`
              : "Aguardando sincronização"}
            {refreshing ? " · atualizando…" : ""}
          </span>
        </footer>
      </main>
    </TvFrame>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix: string;
}) {
  return (
    <article className="tv-summary-card">
      <span className="tv-summary-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{suffix}</small>
      </div>
    </article>
  );
}

function RankingPanel({
  title,
  subtitle,
  team,
  rows,
  goals,
}: {
  title: string;
  subtitle: string;
  team: TvSellerType;
  rows: TvRankingSeller[];
  goals: TvSalesDashboardSnapshot["goals"];
}) {
  return (
    <article className={`tv-ranking-panel team-${team}`}>
      <div className="tv-ranking-title">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <Trophy />
      </div>
      <div className="tv-ranking-columns" aria-hidden="true">
        <span>Posição / integrante</span>
        <span>Resultado</span>
        <span>Meta mensal</span>
      </div>
      <div className="tv-ranking-list">
        {rows.length ? (
          rows.map((seller) => (
            <RankingRow key={seller.id} seller={seller} goal={goalForSeller(seller, goals)} />
          ))
        ) : (
          <div className="tv-empty">
            <Users />
            <span>Nenhum integrante ativo neste ranking.</span>
          </div>
        )}
      </div>
    </article>
  );
}

function RankingRow({
  seller,
  goal,
}: {
  seller: TvRankingSeller;
  goal: TvSalesDashboardSnapshot["goals"][number] | null;
}) {
  const isCloser = seller.sellerType === "closer";
  const currentGoal = isCloser
    ? (goal?.meetings_completed_monthly ?? seller.contracts)
    : (goal?.clients_registered_monthly ?? seller.registrations);
  const targetGoal = isCloser
    ? (goal?.target_meetings_completed_monthly ?? null)
    : (goal?.target_clients_monthly ?? null);
  const percentage = sellerGoalPercentage(currentGoal, targetGoal);
  const resultMain = isCloser ? seller.contracts : seller.registrations;
  const resultLabel = isCloser ? "contratos" : "cadastros";
  const initials = seller.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className={`tv-ranking-row position-${Math.min(4, seller.position)}`}>
      <div className="tv-person">
        <span className="tv-position">{seller.position}º</span>
        <span className="tv-avatar">
          {seller.avatarUrl ? <img src={seller.avatarUrl} alt="" /> : initials || "NOX"}
        </span>
        <div>
          <strong>{seller.name}</strong>
          <small>{seller.openLeads} em atendimento</small>
        </div>
      </div>
      <div className="tv-result">
        <strong>{resultMain}</strong>
        <span>{resultLabel}</span>
      </div>
      <div className="tv-goal">
        <div>
          <strong>{percentage == null ? "Sem meta" : `${percentage}%`}</strong>
          <span>{targetGoal ? `${currentGoal}/${targetGoal}` : "não definida"}</span>
        </div>
        <span className="tv-progress">
          <i style={{ width: `${Math.min(100, percentage ?? 0)}%` }} />
        </span>
      </div>
    </div>
  );
}

function TvLoading({ message }: { message: string }) {
  return (
    <TvFrame>
      <main className="tv-loading">
        <RefreshCw className="tv-spin" />
        <strong>{message}</strong>
      </main>
    </TvFrame>
  );
}

function TvFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="tv-board">
      {children}
      <style>{TV_STYLES}</style>
    </div>
  );
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

const TV_STYLES = `
  :root { color-scheme: dark; }
  html, body { margin: 0; min-width: 100%; min-height: 100%; background: #070708; overflow: hidden; }
  .tv-board { min-height: 100vh; background: radial-gradient(circle at 8% 0%, #312a0b 0, #0b0b0d 25%, #070708 65%); color: #f7f7f5; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .tv-board * { box-sizing: border-box; }
  .tv-board button, .tv-board input { font: inherit; }
  .tv-board button:focus-visible, .tv-board input:focus-visible { outline: 4px solid #ffd300; outline-offset: 4px; }
  .tv-dashboard { width: 100vw; height: 100vh; padding: clamp(20px, 2.2vw, 42px) clamp(28px, 3vw, 58px) 24px; display: flex; flex-direction: column; gap: clamp(12px, 1.2vw, 22px); }
  .tv-header { min-height: 62px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .tv-brand-row { display: flex; align-items: center; gap: 22px; }
  .tv-brand-row img { width: clamp(190px, 15vw, 290px); max-height: 55px; object-fit: contain; object-position: left center; }
  .tv-brand-row > span { border-left: 1px solid #4c4c50; padding-left: 22px; color: #a5a5aa; font-size: clamp(14px, 1vw, 20px); font-weight: 800; letter-spacing: .18em; }
  .tv-header-status { display: flex; align-items: center; gap: 14px; color: #b8b8bc; }
  .tv-live-pill, .tv-clock { height: 42px; border: 1px solid #323237; border-radius: 999px; background: #141417; display: inline-flex; align-items: center; gap: 9px; padding: 0 16px; font-size: clamp(13px, .9vw, 18px); font-weight: 700; white-space: nowrap; }
  .tv-live-pill svg { color: #ffb000; }
  .tv-live-pill.is-live { border-color: #185c38; background: #0d251a; color: #baf4d1; }
  .tv-live-pill.is-live svg { color: #31d67b; }
  .tv-icon-button { width: 44px; height: 44px; border: 1px solid #38383d; border-radius: 12px; color: #dddde0; background: #17171a; display: grid; place-items: center; cursor: pointer; }
  .tv-icon-button svg { width: 21px; }
  .tv-summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: clamp(10px, 1.1vw, 20px); }
  .tv-summary-card { min-height: clamp(82px, 7.8vw, 118px); border: 1px solid #29292e; border-radius: 18px; background: linear-gradient(145deg, #18181b, #101012); padding: 15px clamp(14px, 1.2vw, 24px); display: flex; align-items: center; gap: clamp(12px, 1vw, 20px); box-shadow: 0 12px 28px #0005; }
  .tv-summary-icon { width: clamp(42px, 3.2vw, 62px); height: clamp(42px, 3.2vw, 62px); border-radius: 15px; background: #ffd300; color: #111; display: grid; place-items: center; flex: 0 0 auto; }
  .tv-summary-icon svg { width: 48%; }
  .tv-summary-card div { display: grid; grid-template-columns: auto auto; align-items: baseline; column-gap: 8px; }
  .tv-summary-card div > span { grid-column: 1 / -1; color: #9c9ca2; font-size: clamp(12px, .86vw, 17px); font-weight: 700; }
  .tv-summary-card strong { font-size: clamp(27px, 2.15vw, 42px); line-height: 1; }
  .tv-summary-card small { color: #85858b; font-size: clamp(11px, .75vw, 15px); }
  .tv-warning { min-height: 42px; border: 1px solid #684d08; border-radius: 12px; background: #2c2108; color: #ffe699; padding: 8px 16px; display: flex; align-items: center; gap: 10px; font-size: clamp(12px, .85vw, 17px); }
  .tv-warning svg { width: 20px; flex: 0 0 auto; }
  .tv-rankings { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: clamp(13px, 1.3vw, 25px); }
  .tv-ranking-panel { min-height: 0; border: 1px solid #2b2b30; border-radius: 20px; background: #101012eF; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 18px 40px #0007; }
  .tv-ranking-panel.team-sdr { border-top: 3px solid #ffd300; }
  .tv-ranking-panel.team-closer { border-top: 3px solid #5f8cff; }
  .tv-ranking-title { min-height: clamp(72px, 5.2vw, 98px); padding: 14px clamp(16px, 1.4vw, 28px); display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #26262a; }
  .tv-ranking-title h2 { margin: 0; font-size: clamp(19px, 1.45vw, 29px); letter-spacing: -.02em; }
  .tv-ranking-title p { margin: 5px 0 0; color: #8f8f95; font-size: clamp(11px, .76vw, 15px); }
  .tv-ranking-title > svg { width: clamp(30px, 2.2vw, 44px); height: auto; color: #ffd300; }
  .team-closer .tv-ranking-title > svg { color: #7199ff; }
  .tv-ranking-columns { min-height: 32px; padding: 0 clamp(14px, 1.2vw, 24px); display: grid; grid-template-columns: 1fr 110px 150px; align-items: center; gap: 10px; color: #626269; font-size: clamp(9px, .62vw, 12px); font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
  .tv-ranking-columns span:not(:first-child) { text-align: right; }
  .tv-ranking-list { flex: 1; min-height: 0; padding: 0 clamp(10px, .85vw, 16px) 12px; display: flex; flex-direction: column; gap: clamp(5px, .45vw, 9px); }
  .tv-ranking-row { flex: 1; min-height: 64px; max-height: 96px; border: 1px solid #26262b; border-radius: 14px; background: #17171a; padding: 7px clamp(8px, .75vw, 14px); display: grid; grid-template-columns: minmax(0, 1fr) 100px 145px; align-items: center; gap: 10px; }
  .tv-ranking-row.position-1 { border-color: #6f5d16; background: linear-gradient(90deg, #2b260e, #18181a 35%); }
  .tv-person { min-width: 0; display: flex; align-items: center; gap: 10px; }
  .tv-position { width: 34px; flex: 0 0 34px; text-align: center; color: #b2b2b7; font-size: clamp(14px, 1vw, 20px); font-weight: 900; }
  .position-1 .tv-position { color: #ffd300; }
  .tv-avatar { width: clamp(38px, 2.8vw, 54px); height: clamp(38px, 2.8vw, 54px); flex: 0 0 auto; border-radius: 50%; background: #303036; color: #fff; display: grid; place-items: center; overflow: hidden; font-size: clamp(11px, .75vw, 15px); font-weight: 900; }
  .position-1 .tv-avatar { box-shadow: 0 0 0 2px #ffd300; }
  .tv-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .tv-person div { min-width: 0; }
  .tv-person strong, .tv-person small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tv-person strong { font-size: clamp(13px, .94vw, 19px); }
  .tv-person small { margin-top: 3px; color: #84848a; font-size: clamp(10px, .67vw, 13px); }
  .tv-result { text-align: right; }
  .tv-result strong, .tv-result span { display: block; }
  .tv-result strong { font-size: clamp(20px, 1.45vw, 29px); line-height: 1; }
  .tv-result span { margin-top: 3px; color: #85858b; font-size: clamp(9px, .65vw, 13px); }
  .tv-goal { min-width: 0; }
  .tv-goal > div { display: flex; align-items: baseline; justify-content: flex-end; gap: 6px; }
  .tv-goal strong { font-size: clamp(13px, .9vw, 18px); }
  .tv-goal span { color: #77777d; font-size: clamp(9px, .62vw, 12px); }
  .tv-progress { display: block; height: 6px; margin-top: 7px; border-radius: 99px; overflow: hidden; background: #2f2f34; }
  .tv-progress i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #e4b900, #ffd900); }
  .team-closer .tv-progress i { background: linear-gradient(90deg, #416ee2, #7ba0ff); }
  .tv-empty { flex: 1; display: grid; place-items: center; align-content: center; gap: 10px; color: #74747a; text-align: center; }
  .tv-footer { min-height: 22px; display: flex; justify-content: space-between; color: #67676d; font-size: clamp(10px, .7vw, 14px); }
  .tv-center-card, .tv-loading { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 18px; text-align: center; padding: 40px; }
  .tv-center-card h1 { margin: 0; font-size: clamp(28px, 3vw, 58px); }
  .tv-center-card p { margin: 0; color: #a0a0a6; font-size: clamp(16px, 1.3vw, 25px); }
  .tv-action { margin-top: 15px; min-height: 58px; border: 0; border-radius: 14px; background: #ffd300; color: #111; padding: 0 24px; display: inline-flex; align-items: center; gap: 10px; font-weight: 900; cursor: pointer; }
  .tv-loading svg { width: 50px; height: 50px; color: #ffd300; }
  .tv-loading strong { font-size: clamp(20px, 1.6vw, 32px); }
  .tv-login-shell { width: 100vw; min-height: 100vh; display: grid; grid-template-columns: 1.25fr .75fr; }
  .tv-login-brand { padding: clamp(50px, 6vw, 110px); display: flex; flex-direction: column; justify-content: center; background: radial-gradient(circle at 15% 20%, #554608 0, #171606 25%, transparent 55%); }
  .tv-login-brand > img { width: clamp(230px, 20vw, 390px); object-position: left; }
  .tv-login-copy { margin-top: clamp(55px, 7vh, 100px); max-width: 820px; }
  .tv-login-copy > span { color: #ffd300; font-size: clamp(13px, 1vw, 20px); font-weight: 900; letter-spacing: .18em; }
  .tv-login-copy h1 { margin: 18px 0; max-width: 760px; font-size: clamp(42px, 4.2vw, 82px); line-height: .98; letter-spacing: -.055em; }
  .tv-login-copy p { max-width: 700px; margin: 0; color: #a2a2a7; font-size: clamp(17px, 1.35vw, 27px); line-height: 1.5; }
  .tv-login-features { margin-top: 45px; display: flex; flex-wrap: wrap; gap: 16px 28px; color: #c0c0c4; }
  .tv-login-features span { display: flex; align-items: center; gap: 8px; font-size: clamp(13px, .9vw, 18px); }
  .tv-login-features svg { width: 19px; color: #ffd300; }
  .tv-login-card { align-self: center; width: min(82%, 560px); margin: auto; border: 1px solid #303036; border-radius: 28px; background: #141416; padding: clamp(30px, 3.2vw, 58px); box-shadow: 0 30px 90px #000a; }
  .tv-login-icon { width: 66px; height: 66px; border-radius: 18px; background: #ffd300; color: #111; display: grid; place-items: center; }
  .tv-login-card h2 { margin: 26px 0 6px; font-size: clamp(26px, 2vw, 39px); }
  .tv-login-card > p { margin: 0 0 30px; color: #8d8d93; font-size: clamp(13px, .9vw, 18px); }
  .tv-login-card label { display: block; margin: 20px 0 8px; color: #c5c5c8; font-size: clamp(13px, .85vw, 17px); font-weight: 800; }
  .tv-login-card input { width: 100%; height: clamp(54px, 4vw, 72px); border: 1px solid #3b3b41; border-radius: 12px; background: #0b0b0d; color: #fff; padding: 0 18px; font-size: clamp(16px, 1.1vw, 22px); }
  .tv-login-error { margin-top: 18px; border: 1px solid #6a2929; border-radius: 10px; background: #331515; color: #ffbcbc; padding: 12px; display: flex; gap: 9px; font-size: clamp(12px, .8vw, 16px); }
  .tv-login-error svg { width: 20px; flex: 0 0 auto; }
  .tv-login-submit { width: 100%; height: clamp(58px, 4.2vw, 76px); margin-top: 24px; border: 0; border-radius: 13px; background: #ffd300; color: #101010; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: clamp(16px, 1.05vw, 21px); font-weight: 950; cursor: pointer; }
  .tv-login-submit:disabled { opacity: .65; }
  .tv-spin { animation: tv-spin .8s linear infinite; }
  @keyframes tv-spin { to { transform: rotate(360deg); } }
  @media (max-width: 1000px) {
    html, body { overflow: auto; }
    .tv-board { min-height: 100vh; }
    .tv-dashboard { height: auto; min-height: 100vh; }
    .tv-header { align-items: flex-start; }
    .tv-header-status { flex-wrap: wrap; justify-content: flex-end; }
    .tv-clock { display: none; }
    .tv-summary-grid { grid-template-columns: 1fr 1fr; }
    .tv-rankings { grid-template-columns: 1fr; }
    .tv-ranking-row { min-height: 74px; }
    .tv-login-shell { grid-template-columns: 1fr; }
    .tv-login-brand { display: none; }
    .tv-login-card { margin: 40px auto; }
  }
`;
