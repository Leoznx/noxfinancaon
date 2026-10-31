import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Flame,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAuth,
  type InternalRole,
  type Role,
  type SellerType as AuthSellerType,
} from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { setRememberMe } from "@/lib/authStorage";
import {
  fetchTvSalesDashboard,
  rankDailyCompetition,
  summarizeDailyTeam,
  type TvDailyCompetitionSeller,
  type TvDailyTeamSummary,
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
const TV_LOGIN_TIMEOUT_MS = 25_000;
const LIVE_TABLES = [
  "seller_signup_attributions",
  "seller_client_partnerships",
  "seller_commissions",
  "seller_team_goals",
  "seller_appointments",
] as const;

const INTERNAL_ROLES = new Set<InternalRole>([
  "admin_master",
  "juridico",
  "financeiro",
  "marketing",
  "suporte",
  "vendedor",
]);

async function withTvLoginTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("tv_login_timeout")),
          TV_LOGIN_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function tvLoginErrorMessage(cause: unknown): string {
  const error = cause as { code?: string; message?: string } | null;
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();

  if (message.includes("tv_login_timeout")) {
    return "A autenticação demorou demais. Verifique a internet da TV e tente novamente.";
  }
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos. Confira os dados e tente novamente.";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "Este e-mail ainda não foi confirmado. Confirme-o antes de entrar na TV.";
  }
  if (message.includes("tv_admin_required")) {
    return "Esta conta não possui acesso de Admin ou Admin Master ao painel da TV.";
  }
  if (message.includes("tv_profile_missing")) {
    return "A conta foi autenticada, mas o perfil administrativo não foi encontrado.";
  }
  if (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed")
  ) {
    return "A TV não conseguiu acessar o servidor. Verifique a internet e tente novamente.";
  }
  return "Não foi possível concluir o acesso. Tente novamente em alguns instantes.";
}

declare global {
  interface Window {
    NoxTvAndroid?: {
      markReady: () => void;
    };
  }
}

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

  useEffect(() => {
    if (isLoading || typeof window === "undefined") return;
    document.documentElement.dataset.noxTvReady = "true";
    try {
      window.NoxTvAndroid?.markReady();
    } catch {
      // O mesmo painel continua funcionando normalmente fora do aplicativo da TV.
    }
  }, [isLoading, user]);

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

  return <TvDashboard />;
}

function TvLogin() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitLabel, setSubmitLabel] = useState("Abrir painel");
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const normalizedEmail = String(formData.get("email") ?? email)
      .trim()
      .toLowerCase();
    const submittedPassword = String(formData.get("password") ?? password);
    if (!normalizedEmail || !submittedPassword) {
      setError("Preencha o e-mail e a senha para entrar.");
      return;
    }
    setSubmitting(true);
    setSubmitLabel("Autenticando…");
    setError("");
    try {
      setRememberMe(true);
      const { data: authData, error: signInError } = await withTvLoginTimeout(
        supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: submittedPassword,
        }),
      );
      if (signInError) throw signInError;
      if (!authData.user) throw new Error("tv_profile_missing");

      setSubmitLabel("Validando acesso…");
      const [profileResult, internalUserResult] = await withTvLoginTimeout(
        Promise.all([
          supabase.from("profiles").select("role,status").eq("id", authData.user.id).maybeSingle(),
          supabase
            .from("internal_users" as any)
            .select("role,status,seller_type,time_clock_enabled")
            .eq("auth_user_id", authData.user.id)
            .maybeSingle(),
        ]),
      );
      if (profileResult.error) throw profileResult.error;

      const profile = profileResult.data as { role?: Role | null } | null;
      if (!profile?.role) throw new Error("tv_profile_missing");
      const internalUser = internalUserResult.error
        ? null
        : (internalUserResult.data as {
            role?: string | null;
            status?: string | null;
            seller_type?: string | null;
            time_clock_enabled?: boolean | null;
          } | null);
      const internalRole =
        internalUser?.status === "ativo" && INTERNAL_ROLES.has(internalUser.role as InternalRole)
          ? (internalUser.role as InternalRole)
          : !internalUser && INTERNAL_ROLES.has(profile.role as InternalRole)
            ? (profile.role as InternalRole)
            : null;
      const authorized =
        profile.role === "admin" ||
        profile.role === "admin_master" ||
        internalRole === "admin_master";

      if (!authorized) {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error("tv_admin_required");
      }

      const sellerType = ["sdr", "closer"].includes(internalUser?.seller_type ?? "")
        ? (internalUser!.seller_type as AuthSellerType)
        : null;
      login(
        authData.user.email ?? normalizedEmail,
        profile.role,
        authData.user.id,
        internalRole,
        sellerType,
        internalUser?.status === "ativo" && internalUser.time_clock_enabled === true,
      );
    } catch (cause) {
      setError(tvLoginErrorMessage(cause));
    } finally {
      setSubmitting(false);
      setSubmitLabel("Abrir painel");
    }
  };

  return (
    <TvFrame>
      <main className="tv-login-shell">
        <section className="tv-login-brand" aria-label="NOX Fiança">
          <img src="/brand/nox-fianca-tv.svg" alt="NOX Fiança" />
          <div className="tv-login-copy">
            <span>ARENA DE RESULTADOS</span>
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
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoFocus
          />
          <label htmlFor="tv-password">Senha</label>
          <input
            id="tv-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <div className="tv-login-error" role="alert" aria-live="assertive">
              <AlertTriangle /> {error}
            </div>
          ) : null}
          <button className="tv-login-submit" type="submit" disabled={submitting}>
            {submitting ? <RefreshCw className="tv-spin" /> : <ShieldCheck />}
            {submitLabel}
          </button>
        </form>
      </main>
    </TvFrame>
  );
}

function TvDashboard() {
  const today = useMemo(() => new Date(), []);
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const requestSequence = useRef(0);
  const eventDebounce = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<TvSalesDashboardSnapshot | null>(readCachedSnapshot);
  const hadInitialSnapshot = useRef(Boolean(snapshot));
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);

  const load = useCallback(
    async (background = false) => {
      const sequence = ++requestSequence.current;
      if (!background) setLoading(true);
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
          if (!background) setLoading(false);
        }
      }
    },
    [month, year],
  );

  useEffect(() => void load(hadInitialSnapshot.current), [load]);

  useEffect(() => {
    const fallbackTimer = window.setInterval(() => void load(true), FALLBACK_REFRESH_MS);
    const fullSyncTimer = window.setInterval(() => void load(true), FULL_SYNC_MS);
    return () => {
      window.clearInterval(fallbackTimer);
      window.clearInterval(fullSyncTimer);
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
    channel.subscribe();
    return () => {
      if (eventDebounce.current) window.clearTimeout(eventDebounce.current);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const sdrCompetition = useMemo(
    () =>
      rankDailyCompetition(
        snapshot?.ranking.filter((seller) => seller.sellerType === "sdr") ?? [],
        snapshot?.goals ?? [],
      ),
    [snapshot],
  );
  const closerCompetition = useMemo(
    () =>
      rankDailyCompetition(
        snapshot?.ranking.filter((seller) => seller.sellerType === "closer") ?? [],
        snapshot?.goals ?? [],
      ),
    [snapshot],
  );
  const pageCount = Math.max(
    1,
    Math.ceil(Math.max(sdrCompetition.length, closerCompetition.length) / ROWS_PER_PAGE),
  );

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

  const sdrSummary = summarizeDailyTeam(
    snapshot?.ranking.filter((seller) => seller.sellerType === "sdr") ?? [],
    snapshot?.goals ?? [],
  );
  const closerSummary = summarizeDailyTeam(
    snapshot?.ranking.filter((seller) => seller.sellerType === "closer") ?? [],
    snapshot?.goals ?? [],
  );
  const pageStart = page * ROWS_PER_PAGE;

  return (
    <TvFrame>
      <main className="tv-dashboard">
        <header className="tv-header">
          <img src="/brand/nox-fianca-tv.svg" alt="NOX Fiança" />
        </header>

        <div className="tv-arena-heading">
          <span>
            <Sparkles /> Desafio do dia
          </span>
          <strong>Quem acelera hoje, lidera amanhã.</strong>
        </div>

        <section className="tv-daily-grid" aria-label="Metas diárias da equipe">
          <DailyChallengeCard
            team="sdr"
            title="Força SDR"
            summary={sdrSummary}
            primaryLabel="Cadastros"
            secondaryLabel="Reuniões agendadas"
          />
          <DailyChallengeCard
            team="closer"
            title="Força Closer"
            summary={closerSummary}
            primaryLabel="Reuniões concluídas"
            secondaryLabel="Cadastros"
          />
        </section>

        {error ? (
          <div className="tv-warning" role="status">
            <AlertTriangle /> {error} Exibindo a última atualização disponível.
          </div>
        ) : null}

        <section className="tv-rankings" aria-label="Ranking da equipe">
          <RankingPanel
            title="Arena SDR"
            subtitle="Cadastros + reuniões agendadas hoje"
            team="sdr"
            rows={sdrCompetition.slice(pageStart, pageStart + ROWS_PER_PAGE)}
          />
          <RankingPanel
            title="Arena Closer"
            subtitle="Reuniões concluídas + cadastros hoje"
            team="closer"
            rows={closerCompetition.slice(pageStart, pageStart + ROWS_PER_PAGE)}
          />
        </section>
      </main>
    </TvFrame>
  );
}

function DailyChallengeCard({
  team,
  title,
  summary,
  primaryLabel,
  secondaryLabel,
}: {
  team: TvSellerType;
  title: string;
  summary: TvDailyTeamSummary;
  primaryLabel: string;
  secondaryLabel: string;
}) {
  const score = summary.score;
  const message =
    score == null
      ? "Metas aguardando definição"
      : score >= 100
        ? "Meta batida. Agora é recorde!"
        : score >= 70
          ? "Reta final. Ninguém tira o pé."
          : score >= 35
            ? "O ritmo subiu. Vamos buscar."
            : "A disputa começou. Bora acelerar!";

  return (
    <article className={`tv-daily-card team-${team}`}>
      <div className="tv-daily-score">
        <span>
          <Flame /> Meta diária
        </span>
        <strong>{score == null ? "—" : `${score}%`}</strong>
      </div>
      <div className="tv-daily-content">
        <div className="tv-daily-title">
          <div>
            <span>{team === "sdr" ? "Time amarelo" : "Time azul"}</span>
            <h2>{title}</h2>
          </div>
          <Target />
        </div>
        <div className="tv-daily-metrics">
          <DailyMetric
            label={primaryLabel}
            current={summary.primaryCurrent}
            target={summary.primaryTarget}
          />
          <DailyMetric
            label={secondaryLabel}
            current={summary.secondaryCurrent}
            target={summary.secondaryTarget}
          />
        </div>
        <p>{message}</p>
      </div>
    </article>
  );
}

function DailyMetric({
  label,
  current,
  target,
}: {
  label: string;
  current: number;
  target: number | null;
}) {
  const percentage = target && target > 0 ? Math.round((current / target) * 100) : 0;
  return (
    <div className="tv-daily-metric">
      <span>{label}</span>
      <strong>
        {current}
        <small>{target && target > 0 ? `/${target}` : "/—"}</small>
      </strong>
      <span className="tv-mini-progress">
        <i style={{ width: `${Math.min(100, percentage)}%` }} />
      </span>
    </div>
  );
}

function RankingPanel({
  title,
  subtitle,
  team,
  rows,
}: {
  title: string;
  subtitle: string;
  team: TvSellerType;
  rows: TvDailyCompetitionSeller[];
}) {
  return (
    <article className={`tv-ranking-panel team-${team}`}>
      <div className="tv-ranking-title">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <Crown />
      </div>
      <div className="tv-ranking-columns" aria-hidden="true">
        <span>Competidor</span>
        <span>Hoje</span>
        <span>Ritmo da meta</span>
      </div>
      <div className="tv-ranking-list">
        {rows.length ? (
          rows.map((seller) => <RankingRow key={seller.id} seller={seller} />)
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

function RankingRow({ seller }: { seller: TvDailyCompetitionSeller }) {
  const isCloser = seller.sellerType === "closer";
  const resultLabel = isCloser ? "reuniões" : "cadastros";
  const secondaryLabel = isCloser ? "cadastros" : "reuniões";
  const initials = seller.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className={`tv-ranking-row position-${Math.min(4, seller.dailyPosition)}`}>
      <div className="tv-person">
        <span className="tv-position">{seller.dailyPosition}º</span>
        <span className="tv-avatar">
          {seller.avatarUrl ? <img src={seller.avatarUrl} alt="" /> : initials || "NOX"}
        </span>
        <div>
          <strong>{seller.name}</strong>
          <small>
            {seller.secondaryCurrent} {secondaryLabel} hoje
          </small>
        </div>
      </div>
      <div className="tv-result">
        <strong>{seller.primaryCurrent}</strong>
        <span>{resultLabel}</span>
      </div>
      <div className="tv-goal">
        <div>
          <strong>{seller.dailyScore == null ? "Sem meta" : `${seller.dailyScore}%`}</strong>
          <span>
            {seller.primaryTarget
              ? `${seller.primaryCurrent}/${seller.primaryTarget}`
              : "não definida"}
          </span>
        </div>
        <span className="tv-progress">
          <i style={{ width: `${Math.min(100, seller.dailyScore ?? 0)}%` }} />
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
  const [isNativeApp, setIsNativeApp] = useState(false);

  useEffect(() => {
    setIsNativeApp(typeof window !== "undefined" && Boolean(window.NoxTvAndroid));
  }, []);

  return (
    <div className={`tv-board${isNativeApp ? " is-native-app" : ""}`}>
      {children}
      <style>{TV_STYLES}</style>
    </div>
  );
}

const TV_STYLES = `
  :root { color-scheme: dark; }
  html, body { margin: 0; min-width: 100%; min-height: 100%; background: #070708; overflow: hidden; }
  .tv-board { min-height: 100vh; background: radial-gradient(circle at 8% 0%, #312a0b 0, #0b0b0d 25%, #070708 65%); color: #f7f7f5; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .tv-board * { box-sizing: border-box; }
  .tv-board button, .tv-board input { font: inherit; }
  .tv-board button:focus-visible, .tv-board input:focus-visible { outline: 4px solid #ffd300; outline-offset: 4px; }
  .tv-dashboard { width: 100vw; height: 100vh; padding: clamp(18px, 1.8vw, 34px) clamp(28px, 3vw, 58px) 24px; display: flex; flex-direction: column; gap: clamp(10px, 1vw, 18px); }
  .tv-header { min-height: clamp(66px, 5vw, 92px); display: flex; align-items: center; justify-content: center; }
  .tv-header > img { width: clamp(230px, 18vw, 350px); max-height: clamp(66px, 5vw, 92px); object-fit: contain; filter: drop-shadow(0 0 18px #ffd30055) drop-shadow(0 10px 24px #000); }
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
  .tv-arena-heading { min-height: 42px; display: flex; align-items: center; justify-content: center; gap: 16px; text-align: center; }
  .tv-arena-heading span { border: 1px solid #6f5d16; border-radius: 999px; background: #2b260e; color: #ffd917; padding: 7px 13px; display: inline-flex; align-items: center; gap: 7px; font-size: clamp(10px, .72vw, 14px); font-weight: 950; letter-spacing: .13em; text-transform: uppercase; }
  .tv-arena-heading span svg { width: 16px; height: 16px; }
  .tv-arena-heading > strong { font-size: clamp(15px, 1.15vw, 23px); letter-spacing: -.02em; }
  .tv-daily-grid { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(13px, 1.3vw, 25px); }
  .tv-daily-card { min-height: clamp(118px, 10vw, 168px); border: 1px solid #3f3715; border-radius: 20px; background: linear-gradient(120deg, #30280a 0, #171612 42%, #111113 100%); display: grid; grid-template-columns: clamp(105px, 8vw, 150px) 1fr; overflow: hidden; box-shadow: 0 18px 42px #0008, inset 0 1px #ffd90020; }
  .tv-daily-card.team-closer { border-color: #27417f; background: linear-gradient(120deg, #12265a 0, #151925 42%, #111113 100%); }
  .tv-daily-score { position: relative; padding: 17px 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; background: #ffd300; color: #111; text-align: center; }
  .team-closer .tv-daily-score { background: #5f8cff; color: #07102a; }
  .tv-daily-score span { display: flex; align-items: center; gap: 5px; font-size: clamp(9px, .62vw, 12px); font-weight: 950; letter-spacing: .09em; text-transform: uppercase; }
  .tv-daily-score span svg { width: 17px; height: 17px; }
  .tv-daily-score strong { font-size: clamp(34px, 3vw, 56px); line-height: .95; letter-spacing: -.065em; }
  .tv-daily-content { min-width: 0; padding: 14px clamp(15px, 1.25vw, 25px); display: flex; flex-direction: column; justify-content: center; }
  .tv-daily-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .tv-daily-title span { color: #a2955f; font-size: clamp(9px, .58vw, 11px); font-weight: 900; letter-spacing: .13em; text-transform: uppercase; }
  .team-closer .tv-daily-title span { color: #7e9eee; }
  .tv-daily-title h2 { margin: 1px 0 0; font-size: clamp(17px, 1.25vw, 25px); line-height: 1; }
  .tv-daily-title > svg { width: clamp(24px, 1.8vw, 35px); height: auto; color: #ffd300; }
  .team-closer .tv-daily-title > svg { color: #7199ff; }
  .tv-daily-metrics { margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .tv-daily-metric { min-width: 0; }
  .tv-daily-metric > span:first-child { display: block; color: #9a9aa0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: clamp(9px, .65vw, 13px); font-weight: 800; }
  .tv-daily-metric strong { display: block; margin-top: 2px; font-size: clamp(19px, 1.5vw, 29px); line-height: 1; }
  .tv-daily-metric small { color: #77777e; font-size: 55%; }
  .tv-mini-progress { display: block; height: 4px; margin-top: 5px; border-radius: 99px; overflow: hidden; background: #343438; }
  .tv-mini-progress i { display: block; height: 100%; border-radius: inherit; background: #ffd300; }
  .team-closer .tv-mini-progress i { background: #7199ff; }
  .tv-daily-content > p { margin: 8px 0 0; color: #c8c8cc; font-size: clamp(9px, .66vw, 13px); font-weight: 750; }
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
  .tv-ranking-row.position-1 { border-color: #9d7e08; background: linear-gradient(90deg, #3a3007, #1b1913 40%, #17171a); box-shadow: inset 4px 0 #ffd300, 0 0 26px #ffd30012; }
  .tv-ranking-row.position-2 { border-color: #67676f; background: linear-gradient(90deg, #29292d, #18181a 38%); }
  .tv-ranking-row.position-3 { border-color: #754a2e; background: linear-gradient(90deg, #302016, #18181a 38%); }
  .tv-person { min-width: 0; display: flex; align-items: center; gap: 10px; }
  .tv-position { width: 34px; flex: 0 0 34px; text-align: center; color: #b2b2b7; font-size: clamp(14px, 1vw, 20px); font-weight: 900; }
  .position-1 .tv-position { color: #ffd300; }
  .position-2 .tv-position { color: #d8d8dd; }
  .position-3 .tv-position { color: #db8f5d; }
  .tv-avatar { width: clamp(38px, 2.8vw, 54px); height: clamp(38px, 2.8vw, 54px); flex: 0 0 auto; border-radius: 50%; background: #303036; color: #fff; display: grid; place-items: center; overflow: hidden; font-size: clamp(11px, .75vw, 15px); font-weight: 900; }
  .position-1 .tv-avatar { box-shadow: 0 0 0 3px #ffd300, 0 0 18px #ffd30055; }
  .position-2 .tv-avatar { box-shadow: 0 0 0 2px #c8c8cf; }
  .position-3 .tv-avatar { box-shadow: 0 0 0 2px #ba7044; }
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
  .tv-login-card input:focus, .tv-login-submit:focus-visible { outline: 4px solid #fff; outline-offset: 4px; border-color: #ffd300; }
  .tv-login-error { margin-top: 18px; border: 1px solid #6a2929; border-radius: 10px; background: #331515; color: #ffbcbc; padding: 12px; display: flex; gap: 9px; font-size: clamp(12px, .8vw, 16px); }
  .tv-login-error svg { width: 20px; flex: 0 0 auto; }
  .tv-login-submit { width: 100%; height: clamp(58px, 4.2vw, 76px); margin-top: 24px; border: 0; border-radius: 13px; background: #ffd300; color: #101010; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: clamp(16px, 1.05vw, 21px); font-weight: 950; cursor: pointer; }
  .tv-login-submit:disabled { opacity: .65; }
  .tv-spin { animation: tv-spin .8s linear infinite; }
  @keyframes tv-spin { to { transform: rotate(360deg); } }
  @supports not (width: clamp(1px, 2px, 3px)) {
    .tv-dashboard { padding: 24px 36px; gap: 16px; }
    .tv-header > img { width: 290px; max-height: 76px; }
    .tv-arena-heading > strong { font-size: 20px; }
    .tv-daily-card { min-height: 145px; grid-template-columns: 130px 1fr; }
    .tv-daily-score strong { font-size: 44px; }
    .tv-daily-title h2 { font-size: 22px; }
    .tv-daily-metric strong { font-size: 25px; }
    .tv-daily-content > p { font-size: 12px; }
    .tv-brand-row img { width: 240px; }
    .tv-brand-row > span { font-size: 16px; }
    .tv-live-pill, .tv-clock { font-size: 15px; }
    .tv-summary-grid { gap: 14px; }
    .tv-summary-card { min-height: 96px; padding: 15px 18px; gap: 16px; }
    .tv-summary-icon { width: 52px; height: 52px; }
    .tv-summary-card div > span { font-size: 14px; }
    .tv-summary-card strong { font-size: 34px; }
    .tv-summary-card small { font-size: 13px; }
    .tv-warning { font-size: 14px; }
    .tv-rankings { gap: 18px; }
    .tv-ranking-title { min-height: 84px; padding: 14px 20px; }
    .tv-ranking-title h2 { font-size: 23px; }
    .tv-ranking-title p { font-size: 13px; }
    .tv-ranking-title > svg { width: 36px; }
    .tv-ranking-columns { padding: 0 18px; font-size: 10px; }
    .tv-ranking-list { padding: 0 12px 12px; gap: 7px; }
    .tv-ranking-row { padding: 7px 10px; }
    .tv-position { font-size: 16px; }
    .tv-avatar { width: 46px; height: 46px; font-size: 13px; }
    .tv-person strong { font-size: 16px; }
    .tv-person small { font-size: 11px; }
    .tv-result strong { font-size: 24px; }
    .tv-result span { font-size: 11px; }
    .tv-goal strong { font-size: 16px; }
    .tv-goal span { font-size: 10px; }
    .tv-footer { font-size: 12px; }
    .tv-center-card h1 { font-size: 42px; }
    .tv-center-card p { font-size: 20px; }
    .tv-loading strong { font-size: 25px; }
    .tv-login-brand { padding: 70px; }
    .tv-login-brand > img { width: 300px; }
    .tv-login-copy { margin-top: 70px; }
    .tv-login-copy > span { font-size: 16px; }
    .tv-login-copy h1 { font-size: 60px; }
    .tv-login-copy p { font-size: 22px; }
    .tv-login-features span { font-size: 15px; }
    .tv-login-card { width: 520px; max-width: 82%; padding: 44px; }
    .tv-login-card h2 { font-size: 32px; }
    .tv-login-card > p, .tv-login-card label { font-size: 15px; }
    .tv-login-card input { height: 62px; font-size: 18px; }
    .tv-login-submit { height: 64px; font-size: 18px; }
  }
  @media (max-width: 1000px) {
    html, body { overflow: auto; }
    .tv-board { min-height: 100vh; }
    .tv-dashboard { height: auto; min-height: 100vh; }
    .tv-arena-heading { flex-direction: column; gap: 7px; }
    .tv-daily-grid { grid-template-columns: 1fr; }
    .tv-summary-grid { grid-template-columns: 1fr 1fr; }
    .tv-rankings { grid-template-columns: 1fr; }
    .tv-ranking-row { min-height: 74px; }
    .tv-login-shell { grid-template-columns: 1fr; }
    .tv-login-brand { display: none; }
    .tv-login-card { margin: 40px auto; }
  }
  .tv-board.is-native-app { min-height: 100vh; background: radial-gradient(circle at 50% -5%, #4c3f05 0, #11100a 16%, #070708 42%); }
  .tv-board.is-native-app .tv-dashboard { width: 100vw; height: 100vh; min-height: 100vh; overflow: hidden; padding: 22px 24px 24px; gap: 12px; }
  .tv-board.is-native-app .tv-header { min-height: 92px; }
  .tv-board.is-native-app .tv-header > img { width: min(54vw, 430px); max-height: 92px; }
  .tv-board.is-native-app .tv-arena-heading { min-height: 58px; flex-direction: column; gap: 5px; }
  .tv-board.is-native-app .tv-arena-heading span { font-size: 13px; }
  .tv-board.is-native-app .tv-arena-heading > strong { font-size: 22px; }
  .tv-board.is-native-app .tv-daily-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
  .tv-board.is-native-app .tv-daily-card { min-height: 205px; grid-template-columns: 112px 1fr; border-radius: 18px; }
  .tv-board.is-native-app .tv-daily-score { padding: 14px 9px; }
  .tv-board.is-native-app .tv-daily-score span { font-size: 10px; }
  .tv-board.is-native-app .tv-daily-score strong { font-size: 43px; }
  .tv-board.is-native-app .tv-daily-content { padding: 14px 16px; }
  .tv-board.is-native-app .tv-daily-title h2 { font-size: 22px; }
  .tv-board.is-native-app .tv-daily-title span { font-size: 10px; }
  .tv-board.is-native-app .tv-daily-metrics { grid-template-columns: 1fr; gap: 8px; }
  .tv-board.is-native-app .tv-daily-metric > span:first-child { font-size: 11px; }
  .tv-board.is-native-app .tv-daily-metric strong { font-size: 24px; }
  .tv-board.is-native-app .tv-daily-content > p { font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tv-board.is-native-app .tv-rankings { grid-template-columns: 1fr; grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .tv-board.is-native-app .tv-ranking-panel { border-radius: 18px; }
  .tv-board.is-native-app .tv-ranking-title { min-height: 78px; padding: 12px 20px; }
  .tv-board.is-native-app .tv-ranking-title h2 { font-size: 24px; }
  .tv-board.is-native-app .tv-ranking-title p { font-size: 12px; }
  .tv-board.is-native-app .tv-ranking-columns { min-height: 28px; grid-template-columns: 1fr 96px 142px; padding: 0 18px; font-size: 10px; }
  .tv-board.is-native-app .tv-ranking-list { padding: 0 12px 10px; gap: 6px; }
  .tv-board.is-native-app .tv-ranking-row { min-height: 62px; max-height: 74px; grid-template-columns: minmax(0, 1fr) 86px 135px; padding: 6px 10px; }
  .tv-board.is-native-app .tv-person strong { font-size: 15px; }
  .tv-board.is-native-app .tv-person small { font-size: 10px; }
  .tv-board.is-native-app .tv-result strong { font-size: 23px; }
  .tv-board.is-native-app .tv-goal strong { font-size: 15px; }
  .tv-board.is-native-app .tv-login-shell { grid-template-columns: 1fr; }
  .tv-board.is-native-app .tv-login-brand { display: none; }
  .tv-board.is-native-app .tv-login-card { width: min(82%, 620px); margin: auto; }
`;
