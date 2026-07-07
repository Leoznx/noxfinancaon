import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useState, useEffect } from "react";
import { 
  User, 
  Building2, 
  Wallet, 
  Lock, 
  Bell, 
  Award, 
  Camera, 
  Monitor, 
  Info, 
  Trophy, 
  ChevronRight,
  Loader2,
  CheckCircle2
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { VerificacaoDocumento } from "@/components/configuracoes/VerificacaoDocumento";

export const Route = createLazyFileRoute("/configuracoes")({
  component: () => (
    <ProtectedRoute>
      <ConfiguracoesPage />
    </ProtectedRoute>
  ),
});

function ConfiguracoesPage() {
  const [abaAtiva, setAbaAtiva] = useState('perfil');
  const { user } = useAuth();
  
  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-6xl mx-auto">
        <header>
          <h1 className="text-3xl font-black text-neutral-900 tracking-tight">Configurações</h1>
          <p className="text-sm text-neutral-500 font-medium mt-1">
            Gerencie sua conta, preferências e dados da plataforma.
          </p>
        </header>
        
        <div className="grid grid-cols-12 gap-8">
          {/* SIDEBAR DAS TABS (3 cols) */}
          <aside className="col-span-12 lg:col-span-3">
            <nav className="bg-white border border-neutral-100 rounded-2xl p-2 sticky top-24 shadow-sm">
              <NavItemConfig
                ativo={abaAtiva === 'perfil'}
                onClick={() => setAbaAtiva('perfil')}
                icon={User}
                titulo="Perfil"
                descricao="Foto, nome e dados"
              />
              <NavItemConfig
                ativo={abaAtiva === 'conta'}
                onClick={() => setAbaAtiva('conta')}
                icon={Building2}
                titulo="Conta"
                descricao="Documentos e profissional"
              />
              <NavItemConfig
                ativo={abaAtiva === 'financeiro'}
                onClick={() => setAbaAtiva('financeiro')}
                icon={Wallet}
                titulo="Financeiro"
                descricao="Chave PIX e bancários"
              />
              <NavItemConfig
                ativo={abaAtiva === 'seguranca'}
                onClick={() => setAbaAtiva('seguranca')}
                icon={Lock}
                titulo="Segurança"
                descricao="Senha e sessões"
              />
              <NavItemConfig
                ativo={abaAtiva === 'notificacoes'}
                onClick={() => setAbaAtiva('notificacoes')}
                icon={Bell}
                titulo="Notificações"
                descricao="Alertas e preferências"
              />
              <NavItemConfig
                ativo={abaAtiva === 'comissoes'}
                onClick={() => setAbaAtiva('comissoes')}
                icon={Award}
                titulo="Plano e Nível"
                descricao="Regras de carreira"
              />
            </nav>
          </aside>
          
          {/* CONTEÚDO DA TAB (9 cols) */}
          <main className="col-span-12 lg:col-span-9 animate-in fade-in slide-in-from-right-4 duration-500">
            {abaAtiva === 'perfil'       && <TabPerfil />}
            {abaAtiva === 'conta'        && <TabConta />}
            {abaAtiva === 'financeiro'   && <TabFinanceiro />}
            {abaAtiva === 'seguranca'    && <TabSeguranca />}
            {abaAtiva === 'notificacoes' && <TabNotificacoes />}
            {abaAtiva === 'comissoes'    && <TabComissoesNivel />}
          </main>
        </div>
      </div>
    </DashboardLayout>
  );
}

function NavItemConfig({ ativo, onClick, icon: Icon, titulo, descricao }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 rounded-xl flex items-center gap-4 transition-all mb-1 ${
        ativo 
          ? 'bg-neutral-900 text-white shadow-lg shadow-neutral-200' 
          : 'hover:bg-neutral-50 text-neutral-600'
      }`}
    >
      <div className={`p-2 rounded-lg ${ativo ? 'bg-yellow-400 text-neutral-900' : 'bg-neutral-100 text-neutral-500'}`}>
        <Icon className="w-4 h-4" strokeWidth={ativo ? 2.5 : 2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold tracking-tight ${ativo ? 'text-white' : 'text-neutral-900'}`}>
          {titulo}
        </p>
        <p className={`text-[10px] uppercase font-bold tracking-widest truncate ${ativo ? 'text-yellow-400/80' : 'text-neutral-400'}`}>
          {descricao}
        </p>
      </div>
    </button>
  );
}

function CardSecao({ titulo, descricao, children }: any) {
  return (
    <Card className="border-neutral-100 shadow-sm rounded-2xl overflow-hidden bg-white">
      <div className="px-8 py-6 border-b border-neutral-50">
        <h3 className="text-lg font-black text-neutral-900 tracking-tight">{titulo}</h3>
        <p className="text-sm text-neutral-500 font-medium">{descricao}</p>
      </div>
      <div className="p-8">
        {children}
      </div>
    </Card>
  );
}

type UsuarioConfiguracoes = {
  email: string;
  role: string;
  authId: string | null;
  profileId: string | null;
  profile: any | null;
  origem: "supabase" | "painel";
};

function useUsuarioConfiguracoes() {
  const { user: usuarioPainel, isLoading: authLoading } = useAuth();
  const [usuario, setUsuario] = useState<UsuarioConfiguracoes | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    let ativo = true;
    setLoading(true);
    setErro(null);

    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const authUser = sessionData.session?.user ?? null;
        const email = authUser?.email ?? usuarioPainel?.email ?? null;

        if (!email) {
          if (ativo) setUsuario(null);
          return;
        }

        let profile: any = null;
        let profileError: any = null;

        if (authUser?.id) {
          const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", authUser.id)
            .maybeSingle();
          profile = data;
          profileError = error;
        }

        if (!profile && email && !profileError) {
          const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("email", email)
            .maybeSingle();
          profile = data;
          profileError = error;
        }

        if (profileError) throw profileError;
        if (!ativo) return;

        setUsuario({
          email,
          role: profile?.role ?? usuarioPainel?.role ?? "corretor",
          authId: authUser?.id ?? null,
          profileId: profile?.id ?? authUser?.id ?? null,
          profile,
          origem: authUser ? "supabase" : "painel",
        });
      } catch (e: any) {
        if (ativo) {
          setUsuario(usuarioPainel?.email ? {
            email: usuarioPainel.email,
            role: usuarioPainel.role,
            authId: null,
            profileId: null,
            profile: null,
            origem: "painel",
          } : null);
          setErro("Não foi possível carregar os dados. Tente novamente.");
        }
      } finally {
        if (ativo) setLoading(false);
      }
    })();

    return () => { ativo = false; };
  }, [authLoading, usuarioPainel?.email, usuarioPainel?.role, tentativa]);

  return { usuario, loading: authLoading || loading, erro, recarregar: () => setTentativa((t) => t + 1) };
}

function TabPerfil() {
  const { usuario, loading, erro, recarregar } = useUsuarioConfiguracoes();
  const [profile, setProfile] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);

  // form fields
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");

  useEffect(() => {
    if (!usuario) return;
    const p = usuario.profile ?? { email: usuario.email, role: usuario.role, id: usuario.profileId };
    setProfile(p);
    setFoto(p?.avatar_url ?? null);
    setNome(p?.nome ?? "");
    setTelefone(p?.telefone ?? "");
  }, [usuario]);


  async function handleUploadFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setSalvando(true);
    const fileExt = file.name.split('.').pop();
    const fileName = `${profile.id}-${Date.now()}.${fileExt}`;
    // Prefixo com o uid do usuário para casar com as políticas RLS do bucket "anexos"
    const filePath = `${profile.id}/avatares/${fileName}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from('anexos')
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      // Bucket privado — usamos URL assinada de longa duração (1 ano)
      const { data: signed, error: signErr } = await supabase.storage
        .from('anexos')
        .createSignedUrl(filePath, 60 * 60 * 24 * 365);
      if (signErr) throw signErr;
      const publicUrl = signed?.signedUrl ?? '';
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', profile.id);
      if (updateError) throw updateError;
      setFoto(publicUrl);
      toast.success('Foto de perfil atualizada!');
    } catch (error: any) {
      toast.error('Erro ao subir foto: ' + error.message);
    } finally {
      setSalvando(false);
    }
  }

  async function handleSalvar() {
    if (!usuario) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }
    setSalvando(true);
    try {
      const payload = {
        id: usuario.profileId ?? usuario.authId,
        email: usuario.email,
        nome: nome || usuario.email.split("@")[0],
        role: usuario.role,
        telefone,
      } as any;
      if (!payload.id) throw new Error("Perfil ainda não configurado para salvamento automático.");

      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload)
        .select('*')
        .single();
      if (error) throw error;
      setProfile(data);
      toast.success('Perfil atualizado!');
    } catch (e: any) {
      toast.error('Não foi possível salvar seus dados agora. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  }

  if (loading) {
    return <div className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-neutral-300" /></div>;
  }
  if (!usuario) {
    return (
      <CardSecao titulo="Meu Perfil" descricao="Sessão não encontrada.">
        <p className="text-sm text-red-600 font-medium mb-4">Sessão expirada. Faça login novamente.</p>
        <Link to="/login"><Button>Ir para login</Button></Link>
      </CardSecao>
    );
  }
  if (erro) {
    return (
      <CardSecao titulo="Meu Perfil" descricao="Não foi possível carregar seus dados agora.">
        <p className="text-sm text-red-600 font-medium mb-4">{erro}</p>
        <Button onClick={recarregar}>Tentar novamente</Button>
      </CardSecao>
    );
  }


  const inicial = (nome || profile?.email || "?").substring(0, 1).toUpperCase();

  return (
    <CardSecao titulo="Meu Perfil" descricao="Como você aparece para outros usuários da plataforma.">
      <div className="flex flex-col md:flex-row items-center md:items-start gap-8 mb-10 pb-10 border-b border-neutral-50">
        <div className="relative group">
          <div className="w-32 h-32 rounded-3xl overflow-hidden bg-neutral-100 border-4 border-white shadow-xl flex items-center justify-center text-3xl font-black text-neutral-300">
            {foto ? (
              <img src={foto} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              inicial
            )}
          </div>
          <label className="absolute -bottom-2 -right-2 w-10 h-10 bg-yellow-400 rounded-xl flex items-center justify-center shadow-lg cursor-pointer hover:scale-110 transition-all border-4 border-white">
            <Camera className="w-5 h-5 text-neutral-900" strokeWidth={2.5} />
            <input type="file" className="hidden" accept="image/*" onChange={handleUploadFoto} disabled={salvando} />
          </label>
        </div>

        <div className="flex-1 text-center md:text-left">
          <h4 className="text-2xl font-black text-neutral-900 tracking-tight">{nome || "Sem nome"}</h4>
          <p className="text-sm font-bold text-yellow-600 uppercase tracking-widest mt-1">{usuario.role}</p>
          <p className="text-xs text-neutral-400 mt-4 max-w-sm font-medium">Formato recomendado: JPG ou PNG de até 2MB. Dimensões sugeridas: 400x400px.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-1.5">
          <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">Nome Completo</label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} className="h-12 rounded-xl" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">WhatsApp / Telefone</label>
          <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} className="h-12 rounded-xl" />
        </div>
      </div>


      <div className="mt-10 flex justify-end">
        <Button onClick={handleSalvar} disabled={salvando} className="bg-neutral-900 text-white hover:bg-neutral-800 px-8 h-12 rounded-xl font-bold shadow-lg shadow-neutral-100">
          {salvando ? 'Salvando...' : 'Salvar alterações'}
        </Button>
      </div>
    </CardSecao>
  );
}

function TabConta() {
  const { usuario, loading, erro, recarregar } = useUsuarioConfiguracoes();
  const [profissional, setProfissional] = useState<any>(null);
  const [loadingProfissional, setLoadingProfissional] = useState(false);
  const [erroProfissional, setErroProfissional] = useState<string | null>(null);
  const [creci, setCreci] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!usuario) return;
    let ativo = true;
    const localKey = `nox_config_conta_${usuario.email}`;
    const local = JSON.parse(localStorage.getItem(localKey) || "{}");
    setLoadingProfissional(true);
    setErroProfissional(null);

    (async () => {
      try {
        if (usuario.role === "corretor" && usuario.profileId) {
          const { data, error } = await supabase
            .from("corretores")
            .select("*")
            .eq("profile_id", usuario.profileId)
            .maybeSingle();
          if (error) throw error;
          if (!ativo) return;
          setProfissional(data);
          setCreci((data as any)?.creci ?? local.creci ?? "");
        } else {
          setProfissional(null);
          setCreci(local.creci ?? "");
        }
        setCnpj(local.cnpj ?? "");
      } catch (e: any) {
        if (ativo) {
          setErroProfissional("Não foi possível carregar os dados. Tente novamente.");
          setCreci(local.creci ?? "");
          setCnpj(local.cnpj ?? "");
        }
      } finally {
        if (ativo) setLoadingProfissional(false);
      }
    })();
    return () => { ativo = false; };
  }, [usuario]);

  async function handleSalvarConta() {
    if (!usuario) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }
    setSalvando(true);
    setErroProfissional(null);
    const localKey = `nox_config_conta_${usuario.email}`;
    try {
      localStorage.setItem(localKey, JSON.stringify({ creci, cnpj }));

      if (usuario.role === "corretor" && usuario.authId && usuario.profileId) {
        const payload = { profile_id: usuario.profileId, creci: creci.trim() || null } as any;
        const query = profissional?.id
          ? supabase.from("corretores").update(payload).eq("id", profissional.id)
          : supabase.from("corretores").insert(payload);
        const { data, error } = await query.select("*").single();
        if (error) throw error;
        setProfissional(data);
      }

      toast.success("Dados da conta salvos com sucesso.");
    } catch (e: any) {
      setErroProfissional("Não foi possível salvar seus dados agora. Tente novamente.");
      toast.error("Não foi possível salvar seus dados agora. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  if (loading) {
    return <div className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-neutral-300" /></div>;
  }
  if (!usuario) {
    return (
      <CardSecao titulo="Dados da Conta" descricao="Sessão não encontrada.">
        <p className="text-sm text-red-600 font-medium mb-4">Sessão expirada. Faça login novamente.</p>
        <Link to="/login"><Button>Ir para login</Button></Link>
      </CardSecao>
    );
  }
  if (erro) {
    return (
      <CardSecao titulo="Dados da Conta" descricao="Não foi possível carregar seus dados agora.">
        <p className="text-sm text-red-600 font-medium mb-4">{erro}</p>
        <Button onClick={recarregar}>Tentar novamente</Button>
      </CardSecao>
    );
  }


  return (
    <div className="space-y-6">
      <CardSecao titulo="Dados da Conta" descricao="Informações profissionais e de identificação jurídica.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">E-mail de Acesso</label>
            <Input value={usuario.email} disabled className="h-12 rounded-xl bg-neutral-50 text-neutral-500" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">Tipo de conta</label>
            <Input value={usuario.role} disabled className="h-12 rounded-xl bg-neutral-50 text-neutral-500 capitalize" />
          </div>
          {usuario.role === 'corretor' && (
            <div className="space-y-1.5">
              <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">CRECI</label>
              <Input value={creci} onChange={(e) => setCreci(e.target.value)} className="h-12 rounded-xl" placeholder="Informe seu CRECI" />
            </div>
          )}
          {usuario.role === 'imobiliaria' && (
            <div className="space-y-1.5">
              <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">CNPJ</label>
              <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} className="h-12 rounded-xl" placeholder="Informe o CNPJ" />
            </div>
          )}
        </div>

        {!usuario.profile && (
          <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-medium text-yellow-900">
            Perfil ainda não configurado. Complete seus dados abaixo.
          </div>
        )}
        {(erroProfissional || loadingProfissional) && (
          <div className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-medium text-neutral-700">
            {loadingProfissional ? "Carregando dados profissionais..." : erroProfissional}
          </div>
        )}

        <div className="mt-10 flex justify-end">
          <Button onClick={handleSalvarConta} disabled={salvando || loadingProfissional} className="bg-neutral-900 text-white hover:bg-neutral-800 px-8 h-12 rounded-xl font-bold shadow-lg shadow-neutral-100">
            {salvando ? 'Salvando...' : 'Salvar dados da conta'}
          </Button>
        </div>
      </CardSecao>

      <VerificacaoDocumento usuario={{ userId: usuario.authId, profileId: usuario.profileId, email: usuario.email, role: usuario.role, isRealSession: !!usuario.authId }} />
    </div>
  );
}

type PixTipo = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';

function maskPixCpf(v: string) {
  return v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
function maskPixCnpj(v: string) {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}
function maskPixTelefone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
}
function aplicarMascaraPix(tipo: PixTipo, v: string) {
  if (tipo === 'cpf') return maskPixCpf(v);
  if (tipo === 'cnpj') return maskPixCnpj(v);
  if (tipo === 'telefone') return maskPixTelefone(v);
  return v;
}
function normalizarPix(tipo: PixTipo, v: string) {
  if (tipo === 'cpf' || tipo === 'cnpj' || tipo === 'telefone') return v.replace(/\D/g, '');
  return v.trim();
}
function validarPix(tipo: PixTipo, v: string): string | null {
  const limpo = normalizarPix(tipo, v);
  if (!limpo) return 'Informe uma chave Pix válida.';
  if (tipo === 'cpf' && limpo.length !== 11) return 'CPF deve ter 11 dígitos.';
  if (tipo === 'cnpj' && limpo.length !== 14) return 'CNPJ deve ter 14 dígitos.';
  if (tipo === 'telefone' && (limpo.length < 10 || limpo.length > 11)) return 'Telefone deve ter 10 ou 11 dígitos.';
  if (tipo === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return 'Informe um e-mail válido.';
  if (tipo === 'aleatoria' && limpo.length < 8) return 'Informe a chave aleatória completa.';
  return null;
}

const PIX_TIPOS: { value: PixTipo; label: string }[] = [
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'E-mail' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'aleatoria', label: 'Aleatória' },
];

function TabFinanceiro() {
  const { usuario, loading: loadingUser, erro: erroUser, recarregar } = useUsuarioConfiguracoes();
  const [loading, setLoading] = useState(true);
  const [carregaErro, setCarregaErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [registroId, setRegistroId] = useState<string | null>(null);

  const [receiverName, setReceiverName] = useState('');
  const [bankName, setBankName] = useState('');
  const [pixTipo, setPixTipo] = useState<PixTipo>('cpf');
  const [pixKey, setPixKey] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!usuario) return;
    let ativo = true;
    setLoading(true);
    setCarregaErro(null);
    (async () => {
      try {
        if (!usuario.authId) {
          const local = JSON.parse(localStorage.getItem(`nox_financeiro_${usuario.email}`) || 'null');
          if (local && ativo) {
            setReceiverName(local.receiver_full_name || '');
            setBankName(local.bank_name || '');
            setPixTipo(local.pix_key_type || 'cpf');
            setPixKey(local.pix_key || '');
            setRegistroId(local.id || null);
          }
          return;
        }
        const { data, error } = await supabase
          .from('dados_financeiros_recebimento' as any)
          .select('*')
          .eq('user_id', usuario.authId)
          .maybeSingle();
        if (error) throw error;
        if (!ativo) return;
        if (data) {
          const d = data as any;
          setRegistroId(d.id);
          setReceiverName(d.receiver_full_name || '');
          setBankName(d.bank_name || '');
          setPixTipo((d.pix_key_type as PixTipo) || 'cpf');
          setPixKey(d.pix_key || '');
        }
      } catch (e: any) {
        if (ativo) setCarregaErro('Não foi possível carregar seus dados financeiros. Tente novamente.');
      } finally {
        if (ativo) setLoading(false);
      }
    })();
    return () => { ativo = false; };
  }, [usuario]);

  function handleChangePixTipo(novoTipo: PixTipo) {
    setPixTipo(novoTipo);
    setPixKey('');
    setErros((e) => ({ ...e, pixKey: '' }));
  }

  function handleChangePixKey(valor: string) {
    setPixKey(aplicarMascaraPix(pixTipo, valor));
  }

  function validar(): boolean {
    const novos: Record<string, string> = {};
    if (!receiverName.trim() || receiverName.trim().split(/\s+/).length < 2)
      novos.receiverName = 'Informe o nome completo do recebedor.';
    if (!bankName.trim()) novos.bankName = 'Informe o nome do banco.';
    if (!pixTipo) novos.pixTipo = 'Selecione o tipo de chave Pix.';
    const erroPix = validarPix(pixTipo, pixKey);
    if (erroPix) novos.pixKey = erroPix;
    setErros(novos);
    return Object.keys(novos).length === 0;
  }

  async function handleSalvar() {
    if (!usuario) {
      toast.error('Sessão expirada. Faça login novamente.');
      return;
    }
    if (!validar()) return;
    setSalvando(true);
    const payload = {
      receiver_full_name: receiverName.trim(),
      bank_name: bankName.trim(),
      pix_key_type: pixTipo,
      pix_key: pixKey.trim(),
      pix_key_normalized: normalizarPix(pixTipo, pixKey),
      financial_data_status: 'ativo' as const,
    };
    const eraAtualizacao = !!registroId;
    try {
      if (!usuario.authId) {
        const local = { ...payload, id: registroId || crypto.randomUUID() };
        localStorage.setItem(`nox_financeiro_${usuario.email}`, JSON.stringify(local));
        setRegistroId(local.id);
      } else {
        const completo = { ...payload, user_id: usuario.authId };
        const { data, error } = await supabase
          .from('dados_financeiros_recebimento' as any)
          .upsert(completo, { onConflict: 'user_id' })
          .select('*')
          .single();
        if (error) throw error;
        setRegistroId((data as any).id);
      }
      toast.success(eraAtualizacao ? 'Dados financeiros atualizados com sucesso.' : 'Dados financeiros salvos com sucesso.');
    } catch (e: any) {
      toast.error('Não foi possível salvar agora: ' + (e.message || 'erro desconhecido'));
    } finally {
      setSalvando(false);
    }
  }

  if (loadingUser || loading) {
    return <div className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-neutral-300" /></div>;
  }
  if (!usuario) {
    return (
      <CardSecao titulo="Dados para Recebimento" descricao="Sessão não encontrada.">
        <p className="text-sm text-red-600 font-medium mb-4">Sessão expirada. Faça login novamente.</p>
        <Link to="/login"><Button>Ir para login</Button></Link>
      </CardSecao>
    );
  }
  if (erroUser || carregaErro) {
    return (
      <CardSecao titulo="Dados para Recebimento" descricao="Não foi possível carregar seus dados financeiros.">
        <p className="text-sm text-red-600 font-medium mb-4">{carregaErro || erroUser}</p>
        <Button onClick={recarregar}>Tentar novamente</Button>
      </CardSecao>
    );
  }

  const placeholderPix =
    pixTipo === 'cpf' ? '000.000.000-00'
    : pixTipo === 'cnpj' ? '00.000.000/0000-00'
    : pixTipo === 'telefone' ? '(00) 00000-0000'
    : pixTipo === 'email' ? 'seuemail@exemplo.com'
    : 'Cole sua chave aleatória';

  return (
    <CardSecao titulo="Dados para Recebimento" descricao="Configure como você quer receber suas comissões.">
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">Nome completo do recebedor</label>
            <Input
              value={receiverName}
              onChange={(e) => setReceiverName(e.target.value)}
              placeholder="Digite o nome completo do titular da conta"
              className={`h-12 rounded-xl ${erros.receiverName ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
            />
            {erros.receiverName && <p className="text-xs text-red-600 font-medium ml-1">{erros.receiverName}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">Nome do banco</label>
            <Input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Ex: Nubank, Itaú, Bradesco, Banco do Brasil..."
              className={`h-12 rounded-xl ${erros.bankName ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
            />
            {erros.bankName && <p className="text-xs text-red-600 font-medium ml-1">{erros.bankName}</p>}
          </div>
        </div>

        <div>
          <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1 mb-3 block">Tipo de chave Pix</label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {PIX_TIPOS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => handleChangePixTipo(t.value)}
                className={`text-[11px] font-black uppercase tracking-widest py-3 rounded-xl border-2 transition-all ${
                  pixTipo === t.value
                    ? 'bg-neutral-900 text-white border-neutral-900 shadow-lg shadow-neutral-200'
                    : 'border-neutral-100 text-neutral-500 hover:border-neutral-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">Sua chave Pix</label>
          <Input
            value={pixKey}
            onChange={(e) => handleChangePixKey(e.target.value)}
            placeholder={placeholderPix}
            inputMode={pixTipo === 'email' ? 'email' : pixTipo === 'aleatoria' ? 'text' : 'numeric'}
            className={`h-14 rounded-xl text-lg font-bold ${erros.pixKey ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
          />
          {erros.pixKey && <p className="text-xs text-red-600 font-medium ml-1">{erros.pixKey}</p>}
        </div>

        <div className="bg-neutral-50 border-2 border-neutral-100 rounded-2xl p-6 flex items-start gap-4">
          <div className="bg-neutral-900 rounded-xl p-2.5 text-yellow-400 shadow-sm">
            <Info className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-black text-neutral-900 tracking-tight">Importante</p>
            <p className="text-sm text-neutral-600 mt-1 leading-relaxed">
              Os dados bancários devem pertencer ao <strong className="text-neutral-900">titular da conta cadastrada</strong>.
              Isso ajuda a manter os pagamentos seguros e evita divergências no saque.
            </p>
          </div>
        </div>

        <div className="bg-yellow-50 border-2 border-yellow-100 rounded-2xl p-6 flex items-start gap-4">
          <div className="bg-yellow-400 rounded-xl p-2.5 text-neutral-900 shadow-sm">
            <CheckCircle2 className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-black text-neutral-900 tracking-tight">Regras de Saque</p>
            <p className="text-sm text-neutral-600 mt-1 leading-relaxed">
              Taxa por saque: <strong className="text-neutral-900">R$ 3,50</strong>.
              Prazo para depósito: <strong className="text-neutral-900">até 24h úteis</strong> após aprovação.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-10 flex justify-end">
        <Button
          onClick={handleSalvar}
          disabled={salvando}
          className="bg-neutral-900 text-white hover:bg-neutral-800 px-8 h-12 rounded-xl font-bold shadow-lg shadow-neutral-100"
        >
          {salvando
            ? 'Salvando...'
            : registroId
              ? 'Atualizar dados financeiros'
              : 'Salvar dados financeiros'}
        </Button>
      </div>
    </CardSecao>
  );
}

function TabSeguranca() {
  return (
    <div className="space-y-8">
      <CardSecao titulo="Segurança da Conta" descricao="Gerencie sua senha e acessos ativos.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">Senha Atual</label>
            <Input type="password" placeholder="••••••••" className="h-12 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase tracking-widest text-neutral-500 ml-1">Nova Senha</label>
            <Input type="password" placeholder="Mínimo 8 caracteres" className="h-12 rounded-xl" />
          </div>
        </div>
        <div className="mt-8 flex justify-end">
          <Button className="bg-neutral-900 text-white hover:bg-neutral-800 px-8 h-12 rounded-xl font-bold">
            Alterar senha
          </Button>
        </div>
      </CardSecao>

      <CardSecao titulo="Zona de Perigo" descricao="Ações irreversíveis na sua conta.">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 bg-red-50 border-2 border-red-100 rounded-2xl">
          <div>
            <p className="font-black text-red-900 tracking-tight">Excluir minha conta definitivamente</p>
            <p className="text-xs text-red-700 font-medium mt-1">Todos os seus dados, contratos e histórico de comissões serão apagados.</p>
          </div>
          <Button variant="destructive" className="h-12 px-8 rounded-xl font-bold shadow-lg shadow-red-100">
            Encerrar conta
          </Button>
        </div>
      </CardSecao>
    </div>
  );
}

function TabNotificacoes() {
  return (
    <CardSecao titulo="Preferências de Alerta" descricao="Escolha como você quer ser notificado sobre novidades.">
      <div className="space-y-4">
        <SwitchOpcao titulo="Nova comissão registrada" descricao="Aviso instantâneo quando um contrato vincula uma comissão" />
        <SwitchOpcao titulo="Saque aprovado / pago" descricao="Confirmação de transferência para sua chave PIX" />
        <SwitchOpcao titulo="Subiu de nível" descricao="Celebração e novos benefícios desbloqueados" />
        <SwitchOpcao titulo="Consulta pré-aprovada" descricao="Quando um inquilino passa na análise de crédito" />
        
        <div className="pt-8 mt-4 border-t border-neutral-50">
          <h4 className="text-xs font-black uppercase tracking-widest text-neutral-400 mb-6">Canais de Recebimento</h4>
          <SwitchOpcao titulo="Notificação no App (Sino)" padrao={true} />
          <SwitchOpcao titulo="E-mail Institucional" padrao={true} />
          <SwitchOpcao titulo="WhatsApp (Alertas Críticos)" padrao={false} />
        </div>
      </div>
      <div className="mt-10 flex justify-end">
        <Button className="bg-neutral-900 text-white hover:bg-neutral-800 px-8 h-12 rounded-xl font-bold">
          Salvar preferências
        </Button>
      </div>
    </CardSecao>
  );
}

function SwitchOpcao({ titulo, descricao, padrao = true }: any) {
  const [ativo, setAtivo] = useState(padrao);
  return (
    <div className="flex items-center justify-between py-4 border-b border-neutral-50 last:border-b-0">
      <div>
        <p className="text-sm font-bold text-neutral-900 tracking-tight">{titulo}</p>
        {descricao && <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-widest mt-1">{descricao}</p>}
      </div>
      <button 
        onClick={() => setAtivo(!ativo)}
        className={`w-12 h-6 rounded-full relative transition-all duration-300 ${ativo ? 'bg-yellow-400' : 'bg-neutral-200'}`}
      >
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300 ${ativo ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );
}

function TabComissoesNivel() {
  const { user } = useAuth();
  
  return (
    <div className="space-y-6">
      <div className="bg-neutral-900 rounded-3xl p-8 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-400 opacity-[0.03] rounded-full blur-[80px] -mr-32 -mt-32"></div>
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-yellow-400 rounded-2xl flex items-center justify-center text-neutral-900 shadow-xl shadow-yellow-400/10">
              <Trophy size={40} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-[10px] uppercase font-black tracking-[0.3em] text-yellow-400 mb-1">Seu Nível Atual</p>
              <h2 className="text-4xl font-black text-white tracking-tighter uppercase">PRATA</h2>
              <p className="text-sm text-neutral-400 font-bold mt-1">15 contratos ativos vinculados</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase font-black tracking-[0.3em] text-neutral-400 mb-1">Sua Comissão</p>
            <p className="text-5xl font-black text-white tracking-tighter">7%</p>
            <p className="text-xs text-yellow-400/80 font-bold uppercase tracking-widest mt-1">Sobre o aluguel</p>
          </div>
        </div>
        
        <div className="mt-10 pt-8 border-t border-white/10 flex items-center justify-between">
          <Link to="/plano-carreira" className="text-xs font-bold text-neutral-400 hover:text-white flex items-center gap-2 transition-colors uppercase tracking-widest">
            Ver plano de carreira completo
            <ChevronRight size={14} />
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase text-neutral-500">Faltam 6 contratos para</span>
            <span className="text-sm font-black text-yellow-400 uppercase tracking-widest">OURO (9%)</span>
          </div>
        </div>
      </div>

      <CardSecao titulo="Resumo Financeiro" descricao="Sua saúde financeira na plataforma hoje.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="p-6 bg-neutral-50 rounded-2xl border border-neutral-100">
            <p className="text-[10px] uppercase font-black tracking-widest text-neutral-400 mb-2">Disponível</p>
            <p className="text-2xl font-black text-green-700">R$ 1.250,00</p>
          </div>
          <div className="p-6 bg-neutral-50 rounded-2xl border border-neutral-100">
            <p className="text-[10px] uppercase font-black tracking-widest text-neutral-400 mb-2">Pendente</p>
            <p className="text-2xl font-black text-neutral-900">R$ 420,00</p>
          </div>
          <div className="p-6 bg-neutral-50 rounded-2xl border border-neutral-100">
            <p className="text-[10px] uppercase font-black tracking-widest text-neutral-400 mb-2">Total Sacado</p>
            <p className="text-2xl font-black text-neutral-400">R$ 8.450,00</p>
          </div>
        </div>
        
        <Link to="/minhas-comissoes" className="mt-8 inline-flex items-center gap-3 text-sm font-black text-neutral-900 hover:text-yellow-600 transition-colors group">
          Acessar histórico financeiro completo
          <ChevronRight size={16} className="transition-transform group-hover:translate-x-1" />
        </Link>
      </CardSecao>
    </div>
  );
}
