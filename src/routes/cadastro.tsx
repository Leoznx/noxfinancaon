import { createFileRoute, useNavigate, Link, useSearch } from "@tanstack/react-router";
import { LogoNox } from "@/components/LogoNox";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, UserRound, ArrowLeft, ArrowRight, CheckCircle2, Search, Home, Info, FileText, Mail } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { validateCPF, validateCNPJ, maskCPF, maskCNPJ, maskPhone } from "@/utils/validators";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { checkInquilinoExists, linkTenantByCpf } from "@/lib/inquilino-signup.functions";

const cadastroSearchSchema = z.z.object({
  returnTo: z.z.string().optional(),
  perfil: z.z.enum(['imobiliaria', 'corretor', 'proprietario', 'inquilino']).optional(),
  ref: z.z.string().optional(),
});


export const Route = createFileRoute("/cadastro")({
  component: CadastroComponent,
  validateSearch: (search) => cadastroSearchSchema.parse(search),
});

const accountTypeSchema = z.object({
  type: z.enum(["imobiliaria", "corretor", "proprietario", "inquilino"], {
    required_error: "Selecione o tipo de conta",
  }),
});

const inquilinoSchema = z.object({
  nome: z.string().min(3, "Nome completo é obrigatório"),
  cpf: z.string().refine((val) => validateCPF(val), "CPF inválido"),
  email: z.string().email("E-mail inválido"),
  telefone: z.string().min(14, "Telefone inválido"),
  senha: z.string().min(8, "Mínimo 8 caracteres").regex(/[a-zA-Z]/, "Deve conter ao menos uma letra").regex(/[0-9]/, "Deve conter ao menos um número"),
  confirmarSenha: z.string(),
  termos: z.boolean().refine((val) => val === true, "Você deve aceitar os termos"),
}).refine((data) => data.senha === data.confirmarSenha, {
  message: "As senhas não conferem",
  path: ["confirmarSenha"],
});

const imobiliariaSchema = z.object({
  razaoSocial: z.string().min(3, "Razão social é obrigatória"),
  nomeFantasia: z.string().optional(),
  cnpj: z.string().refine((val) => validateCNPJ(val), "CNPJ inválido"),
  creci: z.string().min(4, "CRECI Jurídico inválido"),
  responsavelNome: z.string().min(3, "Nome do responsável é obrigatório"),
  cargo: z.string().optional(),
  email: z.string().email("E-mail inválido"),
  telefone: z.string().min(14, "Telefone inválido"),
  cidade: z.string().min(2, "Cidade é obrigatória"),
  estado: z.string().length(2, "Selecione o estado"),
  senha: z.string().min(8, "Mínimo 8 caracteres").regex(/[a-zA-Z]/, "Deve conter ao menos uma letra").regex(/[0-9]/, "Deve conter ao menos um número"),
  confirmarSenha: z.string(),
  termos: z.boolean().refine((val) => val === true, "Você deve aceitar os termos"),
}).refine((data) => data.senha === data.confirmarSenha, {
  message: "As senhas não conferem",
  path: ["confirmarSenha"],
});

const corretorSchema = z.object({
  nome: z.string().min(3, "Nome completo é obrigatório"),
  cpf: z.string().refine((val) => validateCPF(val), "CPF inválido"),
  creci: z.string().min(4, "CRECI inválido"),
  email: z.string().email("E-mail inválido"),
  telefone: z.string().min(14, "Telefone inválido"),
  cidade: z.string().min(2, "Cidade é obrigatória"),
  estado: z.string().length(2, "Selecione o estado"),
  vinculadoImobiliaria: z.enum(["sim", "nao"]),
  imobiliariaId: z.string().optional(),
  pix: z.string().optional(),
  senha: z.string().min(8, "Mínimo 8 caracteres").regex(/[a-zA-Z]/, "Deve conter ao menos uma letra").regex(/[0-9]/, "Deve conter ao menos um número"),
  confirmarSenha: z.string(),
  termos: z.boolean().refine((val) => val === true, "Você deve aceitar os termos"),
}).refine((data) => data.senha === data.confirmarSenha, {
  message: "As senhas não conferem",
  path: ["confirmarSenha"],
});

const proprietarioSchema = z.object({
  nome: z.string().min(3, "Nome completo é obrigatório"),
  cpfCnpj: z.string().refine((val) => validateCPF(val) || validateCNPJ(val), "Documento inválido"),
  email: z.string().email("E-mail inválido"),
  telefone: z.string().min(14, "Telefone inválido"),
  cidade: z.string().min(2, "Cidade é obrigatória"),
  estado: z.string().length(2, "Selecione o estado"),
  senha: z.string().min(8, "Mínimo 8 caracteres").regex(/[a-zA-Z]/, "Deve conter ao menos uma letra").regex(/[0-9]/, "Deve conter ao menos um número"),
  confirmarSenha: z.string(),
  termos: z.boolean().refine((val) => val === true, "Você deve aceitar os termos"),
}).refine((data) => data.senha === data.confirmarSenha, {
  message: "As senhas não conferem",
  path: ["confirmarSenha"],
});

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

function CadastroComponent() {
  const [step, setStep] = useState(1);
  const [accountType, setAccountType] = useState<"imobiliaria" | "corretor" | "proprietario" | "inquilino" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 'confirmacao': só falta confirmar o e-mail (inquilino, sem aprovação manual).
  // 'aprovacao': e-mail + aprovação da equipe (imobiliária/corretor/proprietário).
  const [successType, setSuccessType] = useState<"confirmacao" | "aprovacao" | null>(null);
  const [successEmail, setSuccessEmail] = useState("");
  const [imobiliarias, setImobiliarias] = useState<any[]>([]);
  const navigate = useNavigate();
  const search = useSearch({ from: '/cadastro' });
  const returnTo = search.returnTo || '/dashboard';
  const checkInquilinoFn = useServerFn(checkInquilinoExists);
  const linkTenantFn = useServerFn(linkTenantByCpf);

  useEffect(() => {
    if (search.perfil) {
      setAccountType(search.perfil);
      setStep(2);
    }
  }, [search.perfil]);

  useEffect(() => {
    const fetchImob = async () => {
      const { data } = await supabase.from('imobiliarias').select('id, razao_social');
      if (data) setImobiliarias(data);
    };
    fetchImob();
  }, []);

  const handleTypeSelect = (type: "imobiliaria" | "corretor" | "proprietario" | "inquilino") => {
    setAccountType(type);
    setStep(2);
  };

  const formImobiliaria = useForm({
    resolver: zodResolver(imobiliariaSchema),
    defaultValues: {
      razaoSocial: "",
      nomeFantasia: "",
      cnpj: "",
      creci: "",
      responsavelNome: "",
      cargo: "",
      email: "",
      telefone: "",
      cidade: "",
      estado: "",
      senha: "",
      confirmarSenha: "",
      termos: false,
    },
  });

  const formCorretor = useForm({
    resolver: zodResolver(corretorSchema),
    defaultValues: {
      nome: "",
      cpf: "",
      creci: "",
      email: "",
      telefone: "",
      cidade: "",
      estado: "",
      vinculadoImobiliaria: "nao" as const,
      imobiliariaId: "",
      pix: "",
      senha: "",
      confirmarSenha: "",
      termos: false,
    },
  });

  const formProprietario = useForm({
    resolver: zodResolver(proprietarioSchema),
    defaultValues: {
      nome: "",
      cpfCnpj: "",
      email: "",
      telefone: "",
      cidade: "",
      estado: "",
      senha: "",
      confirmarSenha: "",
      termos: false,
    },
  });

  const formInquilino = useForm({
    resolver: zodResolver(inquilinoSchema),
    defaultValues: {
      nome: "",
      cpf: "",
      email: "",
      telefone: "",
      senha: "",
      confirmarSenha: "",
      termos: false,
    },
  });

  const onSubmit = async (data: any) => {
    setIsSubmitting(true);
    try {
      // === Fluxo do inquilino (separado, ativa direto + auto-link por CPF) ===
      if (accountType === 'inquilino') {
        const cpfNorm = (data.cpf as string).replace(/\D/g, "");
        const emailLower = (data.email as string).toLowerCase().trim();

        const exists = await checkInquilinoFn({ data: { email: emailLower, cpf: cpfNorm } });
        if (exists.exists) {
          toast.error("Já existe uma conta vinculada a este CPF ou e-mail. Faça login para acessar seus documentos e faturas.");
          setIsSubmitting(false);
          return;
        }

        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: emailLower,
          password: data.senha,
          options: {
            emailRedirectTo: window.location.origin,
            data: { nome: data.nome, role: 'inquilino', cpf: cpfNorm, telefone: data.telefone },
          },
        });
        if (authError) throw authError;
        if (!authData.user) throw new Error("Erro ao criar usuário");

        // O profile já é criado pelo trigger handle_new_user (auth.users -> profiles) —
        // aqui só complementamos com os campos que o trigger não tem (telefone).
        await supabase.from('profiles').update({
          status: 'ativo',
          nome: data.nome,
          telefone: data.telefone,
          role: 'inquilino' as any,
        } as any).eq('id', authData.user.id);

        // Upsert em inquilinos (cpf único)
        await supabase.from('inquilinos').upsert({
          profile_id: authData.user.id,
          nome: data.nome,
          cpf: cpfNorm,
          tipo: 'PF',
        } as any, { onConflict: 'cpf' });

        // Vincular registros existentes pelo CPF
        try {
          const r = await linkTenantFn({ data: { cpf: cpfNorm } });
          if (r.linkedConsultas > 0) {
            toast.success(`Vinculamos ${r.linkedConsultas} contrato(s) ao seu CPF.`);
          }
        } catch {
          // vínculo é um extra — segue o fluxo mesmo se falhar
        }

        // A conta só fica utilizável depois de confirmar o e-mail (mailer_autoconfirm
        // está desligado no projeto) — navegar direto pra /inquilino/documentos aqui
        // só resultaria num redirect silencioso pro /login, já que ainda não há sessão
        // válida. Mostra a tela de "confirme seu e-mail" em vez disso.
        setSuccessEmail(emailLower);
        setSuccessType('confirmacao');
        return;
      }


      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.senha,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            nome: accountType === 'imobiliaria' ? data.razaoSocial : data.nome,
            role: accountType,
          }
        }
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error("Erro ao criar usuário");

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
          status: 'pendente_aprovacao',
          nome: accountType === 'imobiliaria' ? data.razaoSocial : data.nome,
          telefone: data.telefone
        })
        .eq('id', authData.user.id);

      if (accountType === 'imobiliaria') {
        await supabase
          .from('imobiliarias')
          .insert({
            razao_social: data.razaoSocial,
            nome_fantasia: data.nomeFantasia,
            cnpj: data.cnpj,
            creci: data.creci,
            cargo: data.cargo,
            cidade: data.cidade,
            estado: data.estado,
            contato_nome: data.responsavelNome,
            contato_email: data.email,
            contato_telefone: data.telefone
          });
      } else if (accountType === 'corretor') {
        await supabase
          .from('corretores')
          .insert({
            profile_id: authData.user.id,
            cpf: data.cpf,
            creci: data.creci,
            cidade: data.cidade,
            estado: data.estado,
            vinculado_imobiliaria: data.vinculadoImobiliaria === 'sim',
            imobiliaria_id: data.imobiliariaId || null,
            pix: data.pix
          });
      } else if (accountType === 'proprietario') {
        await supabase
          .from('proprietarios')
          .insert({
            profile_id: authData.user.id,
            nome: data.nome,
            cpf_cnpj: data.cpfCnpj,
            email: data.email,
            telefone: data.telefone
          });
      }

      // Vínculo de indicação (?ref=CODIGO)
      const refCode = (search as any)?.ref as string | undefined;
      if (refCode) {
        const { data: indicador } = await supabase
          .from('profiles')
          .select('id, role')
          .eq('referral_code', refCode)
          .maybeSingle();
        if (indicador && indicador.id !== authData.user.id) {
          await supabase.from('profiles').update({
            referred_by_user_id: indicador.id,
            referred_by_code: refCode,
            referred_at: new Date().toISOString(),
          }).eq('id', authData.user.id);

          const referredEmail = data.email;
          const referredDoc = data.cpf ?? data.cnpj ?? data.cpfCnpj ?? null;
          // antifraude básico: mesmo CPF/email
          const sameDocOrEmail = await supabase.from('profiles').select('id').or(
            `email.eq.${referredEmail}`
          ).neq('id', authData.user.id).limit(1);
          const fraudStatus = (sameDocOrEmail.data?.length ?? 0) > 0 ? 'suspeito' : 'aprovado';

          await supabase.from('referrals').insert({
            referrer_user_id: indicador.id,
            referrer_role: indicador.role,
            referred_user_id: authData.user.id,
            referred_role: accountType,
            referral_code: refCode,
            referred_email: referredEmail,
            referred_document: referredDoc,
            referred_phone: data.telefone,
            reward_status: 'aguardando_contrato',
            fraud_status: fraudStatus,
          });
        }
      }

      await supabase.from('notificacoes').insert({
        titulo: "Nova solicitação de cadastro",
        mensagem: `${accountType === 'imobiliaria' ? data.razaoSocial : data.nome} solicitou acesso como ${accountType}.`,
        tipo: 'cadastro_pendente'
      });


      if (returnTo === '/simular/resultado') {
        toast.success('Conta criada. Seu cadastro será analisado em até 24h.');
        navigate({ to: '/simular/resultado' });
      } else {
        setSuccessEmail(data.email);
        setSuccessType('aprovacao');
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao realizar cadastro");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successType === 'confirmacao') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6 text-center">
        <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mb-8 text-yellow-600">
          <Mail size={44} />
        </div>
        <h1 className="text-3xl font-bold text-neutral-900 mb-4">Confirme seu e-mail</h1>
        <div className="max-w-md text-neutral-600 space-y-4 mb-10">
          <p>
            Enviamos um link de confirmação para <strong className="text-neutral-900">{successEmail}</strong>. Clique
            nele para ativar sua conta — você será redirecionado automaticamente para a Home já conectado.
          </p>
          <p className="text-sm italic">Não recebeu? Confira a caixa de spam ou tente novamente em alguns minutos.</p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/" })}>
          Voltar para a Home
        </Button>
      </div>
    );
  }

  if (successType === 'aprovacao') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 p-6 text-center">
        <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mb-8 text-yellow-600">
          <CheckCircle2 size={48} />
        </div>
        <h1 className="text-3xl font-bold text-neutral-900 mb-4">Cadastro recebido!</h1>
        <div className="max-w-md text-neutral-600 space-y-4 mb-10">
          <p>
            Enviamos um link de confirmação para <strong className="text-neutral-900">{successEmail}</strong> — confirme
            seu e-mail primeiro. Depois disso, sua solicitação entra em análise pela nossa equipe, e você recebe um
            aviso em até 24 horas úteis confirmando a liberação do seu acesso.
          </p>
          <p className="text-sm italic">Enquanto isso, fique à vontade para conhecer nossos planos e materiais para imobiliárias.</p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/" })}>
          Voltar para a Home
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between container mx-auto max-w-7xl">
        <Link to="/" className="flex items-center gap-3">
          <LogoNox variant="claro" size="sm" />
        </Link>
        <Link to="/login" className="text-sm font-black text-neutral-900 hover:text-yellow-600 flex items-center gap-1.5 transition-colors">
          <ArrowLeft size={16} strokeWidth={2.5} />
          Já tenho conta
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-5xl">
          {search.perfil && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6 text-sm text-neutral-700 flex items-start gap-2 max-w-xl mx-auto animate-in fade-in zoom-in duration-500">
              <Info className="w-4 h-4 text-yellow-700 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <p className="font-black text-neutral-900 uppercase text-[10px] tracking-widest mb-0.5">Quase lá!</p>
                <p className="text-xs font-medium">Você está criando sua conta de {search.perfil === 'imobiliaria' ? 'Imobiliária' : search.perfil === 'corretor' ? 'Corretor' : 'Proprietário'}.</p>
              </div>
            </div>
          )}
          {returnTo === '/simular/resultado' && !search.perfil && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6 text-sm text-neutral-700 flex items-start gap-2 max-w-xl mx-auto">
              <Info className="w-4 h-4 text-yellow-700 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <p className="font-medium text-neutral-900">Quase lá!</p>
                <p className="text-xs">Crie sua conta para ver os planos disponíveis para o cliente.</p>
              </div>
            </div>
          )}
          {step === 1 ? (
            <div className="text-center">
              <h1 className="text-2xl font-bold text-neutral-900 mb-1">Que tipo de conta você quer criar?</h1>
              <p className="text-sm text-neutral-500 mb-8">Escolha o perfil que melhor descreve sua atuação.</p>
              
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <Card 
                  className="cursor-pointer border hover:border-neutral-900 transition-all group overflow-hidden rounded-xl"
                  onClick={() => handleTypeSelect("imobiliaria")}
                >
                  <CardContent className="p-3 sm:p-6 flex flex-col items-start text-left">
                    <div className="bg-yellow-400 rounded-lg p-2 sm:p-2.5 inline-flex mb-2 sm:mb-3 text-neutral-900 group-hover:scale-110 transition-transform">
                      <Building2 size={18} strokeWidth={2} className="sm:w-5 sm:h-5" />
                    </div>
                    <h3 className="text-sm sm:text-base font-bold mb-1">Imobiliária</h3>
                    <p className="text-[11px] sm:text-xs text-neutral-600 leading-snug sm:leading-relaxed">
                      Quero oferecer seguro fiança aos meus inquilinos e gerenciar contratos.
                    </p>
                  </CardContent>
                </Card>

                <Card 
                  className="cursor-pointer border hover:border-neutral-900 transition-all group overflow-hidden rounded-xl"
                  onClick={() => handleTypeSelect("corretor")}
                >
                  <CardContent className="p-3 sm:p-6 flex flex-col items-start text-left">
                    <div className="bg-yellow-400 rounded-lg p-2 sm:p-2.5 inline-flex mb-2 sm:mb-3 text-neutral-900 group-hover:scale-110 transition-transform">
                      <UserRound size={18} strokeWidth={2} className="sm:w-5 sm:h-5" />
                    </div>
                    <h3 className="text-sm sm:text-base font-bold mb-1">Corretor</h3>
                    <p className="text-[11px] sm:text-xs text-neutral-600 leading-snug sm:leading-relaxed">
                      Quero enviar análises, acompanhar comissões e crescer com a NOX.
                    </p>
                  </CardContent>
                </Card>

                <Card 
                  className="cursor-pointer border hover:border-neutral-900 transition-all group overflow-hidden rounded-xl"
                  onClick={() => handleTypeSelect("proprietario")}
                >
                  <CardContent className="p-3 sm:p-6 flex flex-col items-start text-left">
                    <div className="bg-yellow-400 rounded-lg p-2 sm:p-2.5 inline-flex mb-2 sm:mb-3 text-neutral-900 group-hover:scale-110 transition-transform">
                      <Home size={18} strokeWidth={2} className="sm:w-5 sm:h-5" />
                    </div>
                    <h3 className="text-sm sm:text-base font-bold mb-1">Proprietário</h3>
                    <p className="text-[11px] sm:text-xs text-neutral-600 leading-snug sm:leading-relaxed">
                      Quero acompanhar meus imóveis, contratos e recebimentos com segurança.
                    </p>
                  </CardContent>
                </Card>

                <Card
                  className="cursor-pointer border hover:border-neutral-900 transition-all group overflow-hidden rounded-xl"
                  onClick={() => handleTypeSelect("inquilino")}
                >
                  <CardContent className="p-3 sm:p-6 flex flex-col items-start text-left">
                    <div className="bg-yellow-400 rounded-lg p-2 sm:p-2.5 inline-flex mb-2 sm:mb-3 text-neutral-900 group-hover:scale-110 transition-transform">
                      <FileText size={18} strokeWidth={2} className="sm:w-5 sm:h-5" />
                    </div>
                    <h3 className="text-sm sm:text-base font-bold mb-1">Inquilino</h3>
                    <p className="text-[11px] sm:text-xs text-neutral-600 leading-snug sm:leading-relaxed">
                      Quero acessar meus seguros, documentos, boletos e faturas vinculados ao meu CPF.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-neutral-200 flex items-center gap-3">
                <button 
                  onClick={() => setStep(1)}
                  className="text-neutral-500 hover:text-neutral-900 transition-colors"
                >
                  <ArrowLeft size={20} strokeWidth={1.5} />
                </button>
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-600">
                  Cadastro {accountType === 'imobiliaria' ? 'Imobiliária' : accountType === 'corretor' ? 'Corretor' : accountType === 'proprietario' ? 'Proprietário' : 'Inquilino'}
                </h2>
              </div>

              <div className="p-6">
                {accountType === 'inquilino' ? (
                  <InquilinoForm
                    form={formInquilino}
                    onSubmit={onSubmit}
                    isSubmitting={isSubmitting}
                  />
                ) : (() => {
                  const activeForm = (accountType === 'imobiliaria' ? formImobiliaria : accountType === 'corretor' ? formCorretor : formProprietario) as any;
                  const errors = activeForm.formState.errors;

                  return (
                    <form onSubmit={activeForm.handleSubmit(onSubmit)}>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* COLUNA 1 */}
                        <div className="space-y-4">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 pb-2 border-b border-neutral-100">
                            {accountType === 'imobiliaria' ? 'Dados da Empresa' : 'Dados Pessoais'}
                          </h3>
                          
                          {accountType === 'imobiliaria' ? (
                            <>
                              <Input 
                                label="Razão Social" 
                                {...formImobiliaria.register("razaoSocial")} 
                                placeholder="Ex: Silva Imóveis LTDA" 
                              />
                              {errors.razaoSocial && <p className="text-[10px] text-red-500 -mt-3">{errors.razaoSocial.message}</p>}
                              
                              <Input 
                                label="Nome Fantasia (Opcional)" 
                                {...formImobiliaria.register("nomeFantasia")} 
                                placeholder="Ex: Silva Imóveis" 
                              />
                              
                              <Input 
                                label="CNPJ" 
                                {...formImobiliaria.register("cnpj")} 
                                placeholder="00.000.000/0000-00"
                                onChange={(e) => formImobiliaria.setValue("cnpj", maskCNPJ(e.target.value))}
                              />
                              {errors.cnpj && <p className="text-[10px] text-red-500 -mt-3">{errors.cnpj.message}</p>}
                              
                              <Input 
                                label="CRECI Jurídico" 
                                {...formImobiliaria.register("creci")} 
                                placeholder="Ex: J-1234-RS" 
                              />
                              {errors.creci && <p className="text-[10px] text-red-500 -mt-3">{errors.creci.message}</p>}
                            </>
                          ) : accountType === 'corretor' ? (
                            <>
                              <Input 
                                label="Nome Completo" 
                                {...formCorretor.register("nome")} 
                                placeholder="Nome completo" 
                              />
                              {errors.nome && <p className="text-[10px] text-red-500 -mt-3">{errors.nome.message}</p>}
                              
                              <Input 
                                label="CPF" 
                                {...formCorretor.register("cpf")} 
                                placeholder="000.000.000-00"
                                onChange={(e) => formCorretor.setValue("cpf", maskCPF(e.target.value))}
                              />
                              {errors.cpf && <p className="text-[10px] text-red-500 -mt-3">{errors.cpf.message}</p>}
                              
                              <Input 
                                label="CRECI" 
                                {...formCorretor.register("creci")} 
                                placeholder="Ex: 123.456-F-RS" 
                              />
                              {errors.creci && <p className="text-[10px] text-red-500 -mt-3">{errors.creci.message}</p>}

                              <Input 
                                label="Telefone / WhatsApp" 
                                {...formCorretor.register("telefone")} 
                                placeholder="(00) 00000-0000"
                                onChange={(e) => formCorretor.setValue("telefone", maskPhone(e.target.value))}
                              />
                              {errors.telefone && <p className="text-[10px] text-red-500 -mt-3">{errors.telefone.message}</p>}
                            </>
                          ) : (
                            <>
                              <Input 
                                label="Nome Completo" 
                                {...formProprietario.register("nome")} 
                                placeholder="Nome completo" 
                              />
                              {errors.nome && <p className="text-[10px] text-red-500 -mt-3">{errors.nome.message}</p>}
                              
                              <Input 
                                label="CPF ou CNPJ" 
                                {...formProprietario.register("cpfCnpj")} 
                                placeholder="000.000.000-00"
                                onChange={(e) => {
                                  const val = e.target.value.replace(/\D/g, '');
                                  formProprietario.setValue("cpfCnpj", val.length <= 11 ? maskCPF(e.target.value) : maskCNPJ(e.target.value));
                                }}
                              />
                              {errors.cpfCnpj && <p className="text-[10px] text-red-500 -mt-3">{errors.cpfCnpj.message}</p>}

                              <Input 
                                label="E-mail" 
                                {...formProprietario.register("email")} 
                                placeholder="nome@email.com" 
                              />
                              {errors.email && <p className="text-[10px] text-red-500 -mt-3">{errors.email.message}</p>}

                              <Input 
                                label="Telefone / WhatsApp" 
                                {...formProprietario.register("telefone")} 
                                placeholder="(00) 00000-0000"
                                onChange={(e) => formProprietario.setValue("telefone", maskPhone(e.target.value))}
                              />
                              {errors.telefone && <p className="text-[10px] text-red-500 -mt-3">{errors.telefone.message}</p>}
                            </>
                          )}
                        </div>

                        {/* COLUNA 2 */}
                        <div className="space-y-4">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 pb-2 border-b border-neutral-100">
                            {accountType === 'imobiliaria' ? 'Responsável e Contato' : accountType === 'corretor' ? 'Atuação Profissional' : 'Localização'}
                          </h3>
                          
                          {accountType === 'imobiliaria' ? (
                            <>
                              <Input 
                                label="Nome do Responsável" 
                                {...formImobiliaria.register("responsavelNome")} 
                                placeholder="Nome completo" 
                              />
                              {errors.responsavelNome && <p className="text-[10px] text-red-500 -mt-3">{errors.responsavelNome.message}</p>}
                              
                              <Input 
                                label="Cargo (Opcional)" 
                                {...formImobiliaria.register("cargo")} 
                                placeholder="Ex: Diretor, Gerente" 
                              />
                              
                              <Input 
                                label="E-mail Corporativo" 
                                {...formImobiliaria.register("email")} 
                                placeholder="nome@empresa.com.br" 
                              />
                              {errors.email && <p className="text-[10px] text-red-500 -mt-3">{errors.email.message}</p>}

                              <div className="grid grid-cols-3 gap-2">
                                <div className="col-span-2">
                                  <Input label="Cidade" {...formImobiliaria.register("cidade")} placeholder="Cidade" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs font-medium text-neutral-700">UF</Label>
                                  <Select onValueChange={(val) => formImobiliaria.setValue("estado", val)}>
                                    <SelectTrigger className="h-9">
                                      <SelectValue placeholder="UF" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {UFS.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </>
                          ) : accountType === 'corretor' ? (
                            <>
                              <div className="space-y-1">
                                <Label className="text-xs font-medium text-neutral-700">Vinculado a uma imobiliária?</Label>
                                <Select 
                                  onValueChange={(val: any) => formCorretor.setValue("vinculadoImobiliaria", val)}
                                  defaultValue="nao"
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Selecione" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="sim">Sim, sou vinculado</SelectItem>
                                    <SelectItem value="nao">Não, sou autônomo</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              {formCorretor.watch("vinculadoImobiliaria") === "sim" && (
                                <div className="space-y-1">
                                  <Label className="text-xs font-medium text-neutral-700">Selecione sua Imobiliária</Label>
                                  <Select onValueChange={(val) => formCorretor.setValue("imobiliariaId", val)}>
                                    <SelectTrigger className="h-9">
                                      <SelectValue placeholder="Buscar imobiliária..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {imobiliarias.map((imob) => (
                                        <SelectItem key={imob.id} value={imob.id}>{imob.razao_social}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}

                              <Input 
                                label="E-mail Corporativo" 
                                {...formCorretor.register("email")} 
                                placeholder="nome@empresa.com.br" 
                              />
                              {errors.email && <p className="text-[10px] text-red-500 -mt-3">{errors.email.message}</p>}

                              <Input 
                                label="Chave PIX (Opcional)" 
                                {...formCorretor.register("pix")} 
                                placeholder="Para recebimento de comissões" 
                              />

                              <div className="grid grid-cols-3 gap-2">
                                <div className="col-span-2">
                                  <Input label="Cidade" {...formCorretor.register("cidade")} placeholder="Cidade" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs font-medium text-neutral-700">UF</Label>
                                  <Select onValueChange={(val) => formCorretor.setValue("estado", val)}>
                                    <SelectTrigger className="h-9">
                                      <SelectValue placeholder="UF" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {UFS.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="col-span-2">
                                  <Input label="Cidade" {...formProprietario.register("cidade")} placeholder="Cidade" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs font-medium text-neutral-700">UF</Label>
                                  <Select onValueChange={(val) => formProprietario.setValue("estado", val)}>
                                    <SelectTrigger className="h-9">
                                      <SelectValue placeholder="UF" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {UFS.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              
                              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-neutral-700 mt-2">
                                <p className="font-semibold mb-1">Informação:</p>
                                <p>Dados bancários para repasse de comissões serão solicitados após a aprovação do cadastro.</p>
                              </div>
                            </>
                          )}
                        </div>

                        {/* COLUNA 3 */}
                        <div className="space-y-4">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 pb-2 border-b border-neutral-100">
                            Segurança
                          </h3>
                          
                          <Input 
                            label="Crie uma senha forte" 
                            type="password" 
                            {...activeForm.register("senha")} 
                            placeholder="••••••••" 
                          />
                          {errors.senha && <p className="text-[10px] text-red-500 -mt-3">{errors.senha.message}</p>}

                          <Input 
                            label="Confirme a senha" 
                            type="password" 
                            {...activeForm.register("confirmarSenha")} 
                            placeholder="••••••••" 
                          />
                          {errors.confirmarSenha && <p className="text-[10px] text-red-500 -mt-3">{errors.confirmarSenha.message}</p>}

                          {/* Password strength indicator */}
                          <div className="space-y-1.5 pt-1">
                            <div className="flex gap-1">
                              <div className={cn("h-1 flex-1 rounded-full", activeForm.watch("senha")?.length >= 1 ? "bg-yellow-400" : "bg-neutral-200")}></div>
                              <div className={cn("h-1 flex-1 rounded-full", activeForm.watch("senha")?.length >= 4 ? "bg-yellow-400" : "bg-neutral-200")}></div>
                              <div className={cn("h-1 flex-1 rounded-full", activeForm.watch("senha")?.length >= 6 ? "bg-yellow-400" : "bg-neutral-200")}></div>
                              <div className={cn("h-1 flex-1 rounded-full", activeForm.watch("senha")?.length >= 8 ? "bg-yellow-400" : "bg-neutral-200")}></div>
                            </div>
                            <p className="text-[10px] text-neutral-500">
                              {activeForm.watch("senha")?.length >= 8 ? "Força: Forte" : activeForm.watch("senha")?.length >= 4 ? "Força: Média" : "Força: Fraca"}
                            </p>
                          </div>

                          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-[10px] text-neutral-700">
                            Mínimo 8 caracteres, com pelo menos 1 letra e 1 número.
                          </div>
                        </div>
                      </div>

                      {/* Fixed Footer within card */}
                      <div className="mt-8 pt-6 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-start space-x-2">
                          <Checkbox 
                            id="termos" 
                            onCheckedChange={(val: boolean) => activeForm.setValue("termos", val)}
                            className="mt-0.5"
                          />
                          <div className="grid gap-1">
                            <label htmlFor="termos" className="text-xs font-medium leading-none text-neutral-700">
                              Aceito os <Link to="/termos" className="text-yellow-600 underline">Termos de Uso</Link> e a <Link to="/privacidade" className="text-yellow-600 underline">Política de Privacidade</Link>
                            </label>
                            {errors.termos && <p className="text-[10px] text-red-500">Você deve aceitar para continuar</p>}
                          </div>
                        </div>

                        <Button 
                          type="submit" 
                          disabled={isSubmitting}
                          className="w-full sm:w-auto bg-neutral-900 hover:bg-neutral-800 text-white px-8 py-2.5 rounded-lg font-bold text-sm h-auto flex items-center gap-2"
                        >
                          {isSubmitting ? "Enviando..." : "Criar conta"}
                          <ArrowRight size={16} />
                        </Button>
                      </div>
                    </form>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="p-6 text-center text-xs text-neutral-400">
        © 2025 NOX FIANÇA - Todos os direitos reservados.
      </footer>
    </div>
  );
}

function InquilinoForm({ form, onSubmit, isSubmitting }: { form: any; onSubmit: (d: any) => void; isSubmitting: boolean; }) {
  const errors = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-xl mx-auto space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-neutral-700">
        Vamos vincular automaticamente todos os contratos, faturas e documentos cadastrados com o seu CPF.
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-medium text-neutral-700">Nome completo</Label>
        <Input {...form.register("nome")} placeholder="Anderson Henrique Araujo" />
        {errors.nome && <p className="text-[10px] text-red-500">{errors.nome.message}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-neutral-700">CPF</Label>
          <Input
            {...form.register("cpf")}
            placeholder="000.000.000-00"
            onChange={(e) => form.setValue("cpf", maskCPF(e.target.value))}
          />
          {errors.cpf && <p className="text-[10px] text-red-500">{errors.cpf.message}</p>}
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-neutral-700">Telefone</Label>
          <Input
            {...form.register("telefone")}
            placeholder="(00) 00000-0000"
            onChange={(e) => form.setValue("telefone", maskPhone(e.target.value))}
          />
          {errors.telefone && <p className="text-[10px] text-red-500">{errors.telefone.message}</p>}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-medium text-neutral-700">E-mail</Label>
        <Input type="email" {...form.register("email")} placeholder="seuemail@email.com" />
        {errors.email && <p className="text-[10px] text-red-500">{errors.email.message}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-neutral-700">Senha</Label>
          <Input type="password" {...form.register("senha")} placeholder="••••••••" />
          {errors.senha && <p className="text-[10px] text-red-500">{errors.senha.message}</p>}
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-neutral-700">Confirmar senha</Label>
          <Input type="password" {...form.register("confirmarSenha")} placeholder="••••••••" />
          {errors.confirmarSenha && <p className="text-[10px] text-red-500">{errors.confirmarSenha.message}</p>}
        </div>
      </div>

      <p className="text-[10px] text-neutral-500">Mínimo 8 caracteres, com pelo menos 1 letra e 1 número.</p>

      <div className="flex items-start space-x-2 pt-2">
        <Checkbox
          id="termos-inq"
          onCheckedChange={(val: boolean) => form.setValue("termos", val)}
          className="mt-0.5"
        />
        <label htmlFor="termos-inq" className="text-xs font-medium leading-none text-neutral-700">
          Aceito os <Link to="/termos" className="text-yellow-600 underline">Termos de Uso</Link> e a <Link to="/privacidade" className="text-yellow-600 underline">Política de Privacidade</Link>
        </label>
      </div>
      {errors.termos && <p className="text-[10px] text-red-500">Você deve aceitar para continuar</p>}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-neutral-900 hover:bg-neutral-800 text-white px-8 py-2.5 rounded-lg font-bold text-sm h-auto flex items-center justify-center gap-2"
      >
        {isSubmitting ? "Criando conta..." : "Criar conta"}
        <ArrowRight size={16} />
      </Button>
    </form>
  );
}

