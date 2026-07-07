import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useEffect } from "react";
import {
  validarTokenAtivacao,
  enviarBiometria,
  aceitarContrato,
  confirmarPagamento,
  concluirAtivacao,
} from "@/lib/ativacao.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Camera, Check, FileText, CreditCard, Smartphone, Barcode, ShieldCheck, AlertCircle, ChevronRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createLazyFileRoute("/ativar-fianca/$token")({
  component: AtivarFiancaPage,
});

type Step = "cpf" | "biometria" | "contrato" | "pagamento" | "concluido";
type Proposta = {
  consulta_id: string;
  tenant_name?: string;
  tenant_email?: string;
  property_address?: string;
  rent_value?: number;
  valor_premio_mensal?: number;
  insurance_payment_method?: string;
  insurance_payment_method_label?: string;
  biometria_status?: string;
  contract_accepted?: boolean;
  payment_status?: string;
  activation_status?: string;
};

const STEPS: { id: Step; label: string }[] = [
  { id: "cpf", label: "CPF" },
  { id: "biometria", label: "Biometria" },
  { id: "contrato", label: "Contrato" },
  { id: "pagamento", label: "Pagamento" },
  { id: "concluido", label: "Concluído" },
];

function maskCPF(v: string) {
  return v
    .replace(/\D/g, "")
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function fmtBRL(n?: number) {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-1 sm:gap-2">
        {STEPS.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <div key={s.id} className="flex-1 flex flex-col items-center">
              <div
                className={`h-8 w-8 rounded-full grid place-items-center text-xs font-bold transition-all ${
                  done
                    ? "bg-[#FFD400] text-black"
                    : active
                    ? "bg-black text-[#FFD400] ring-2 ring-[#FFD400]"
                    : "bg-neutral-200 text-neutral-500"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={`mt-1 text-[10px] sm:text-xs ${
                  active ? "font-bold text-black" : "text-neutral-500"
                }`}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AtivarFiancaPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("cpf");
  const [cpf, setCpf] = useState("");
  const [cpfError, setCpfError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [proposta, setProposta] = useState<Proposta | null>(null);

  const validar = useServerFn(validarTokenAtivacao);
  const sendBio = useServerFn(enviarBiometria);
  const aceitar = useServerFn(aceitarContrato);
  const confirmar = useServerFn(confirmarPagamento);
  const concluir = useServerFn(concluirAtivacao);

  async function onValidarCpf(e: React.FormEvent) {
    e.preventDefault();
    setCpfError(null);
    setLoading(true);
    try {
      const res = await validar({ data: { token, cpf } });
      setProposta(res as Proposta);
      if ((res as any).already_active) {
        setStep("concluido");
      } else if (!(res as any).biometria_status || (res as any).biometria_status === "pendente") {
        setStep("biometria");
      } else if (!(res as any).contract_accepted) {
        setStep("contrato");
      } else if ((res as any).payment_status !== "aprovado") {
        setStep("pagamento");
      } else {
        setStep("concluido");
      }
    } catch (err: any) {
      setCpfError(err?.message || "Não foi possível validar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-[#FFD400] grid place-items-center font-black text-black">
              N
            </div>
            <span className="font-black tracking-tight">NOX Fiança</span>
          </div>
          <span className="text-xs text-neutral-400 hidden sm:inline">Ativação segura</span>
        </div>
      </header>

      {/* Step bar */}
      {step !== "cpf" && (
        <div className="max-w-2xl mx-auto px-4 pt-5">
          <StepBar current={step} />
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {step === "cpf" && (
          <TelaCpf
            cpf={cpf}
            setCpf={setCpf}
            onSubmit={onValidarCpf}
            error={cpfError}
            loading={loading}
          />
        )}

        {step === "biometria" && proposta && (
          <TelaBiometria
            onConcluido={async (img) => {
              setLoading(true);
              try {
                await sendBio({ data: { token, consultaId: proposta.consulta_id, imageBase64: img } });
                toast.success("Biometria enviada");
                setStep("contrato");
              } catch (e: any) {
                toast.error(e?.message || "Falha ao enviar biometria");
              } finally {
                setLoading(false);
              }
            }}
            loading={loading}
          />
        )}

        {step === "contrato" && proposta && (
          <TelaContrato
            proposta={proposta}
            loading={loading}
            onAceitar={async () => {
              setLoading(true);
              try {
                await aceitar({
                  data: {
                    token,
                    consultaId: proposta.consulta_id,
                    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
                  },
                });
                toast.success("Contrato aceito");
                setStep("pagamento");
              } catch (e: any) {
                toast.error(e?.message || "Erro ao aceitar contrato");
              } finally {
                setLoading(false);
              }
            }}
          />
        )}

        {step === "pagamento" && proposta && (
          <TelaPagamento
            proposta={proposta}
            loading={loading}
            onConfirmar={async (method, label) => {
              setLoading(true);
              try {
                await confirmar({
                  data: { token, consultaId: proposta.consulta_id, method, methodLabel: label },
                });
                await concluir({ data: { token, consultaId: proposta.consulta_id } });
                toast.success("Ativação concluída!");
                setStep("concluido");
              } catch (e: any) {
                toast.error(e?.message || "Falha no pagamento");
              } finally {
                setLoading(false);
              }
            }}
          />
        )}

        {step === "concluido" && (
          <TelaConcluido
            proposta={proposta}
            onPainel={() => navigate({ to: "/inquilino" })}
          />
        )}
      </main>

      <footer className="max-w-2xl mx-auto px-4 py-8 text-center text-xs text-neutral-500">
        © NOX Fiança — ativação segura e criptografada
      </footer>
    </div>
  );
}

/* ============== Tela 1: CPF ============== */
function TelaCpf({
  cpf,
  setCpf,
  onSubmit,
  error,
  loading,
}: {
  cpf: string;
  setCpf: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string | null;
  loading: boolean;
}) {
  return (
    <div className="space-y-6">
      <Card className="p-6 border-2 border-black rounded-2xl">
        <h1 className="text-2xl sm:text-3xl font-black leading-tight">
          Vamos ativar sua <span className="text-[#FFB800]">fiança aluguel</span>?
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          A NOX Fiança, em parceria com a imobiliária responsável, vai ajudar você a ativar sua
          garantia locatícia em poucos passos, com segurança e sem burocracia.
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <label className="block text-sm font-semibold">CPF do inquilino</label>
          <Input
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={cpf}
            onChange={(e) => setCpf(maskCPF(e.target.value))}
            className={`h-12 text-base ${error ? "border-red-500 ring-1 ring-red-500" : ""}`}
          />
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <Button
            type="submit"
            disabled={loading || cpf.replace(/\D/g, "").length !== 11}
            className="w-full h-12 bg-black hover:bg-neutral-800 text-[#FFD400] font-bold rounded-xl"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar com CPF"}
          </Button>
        </form>
      </Card>

      <Card className="p-6 rounded-2xl">
        <h2 className="font-black text-lg">Ative sua fiança em poucos passos</h2>
        <ol className="mt-4 space-y-4">
          {[
            { icon: Camera, t: "Biometria facial", d: "Tire uma foto para confirmar sua identidade com segurança." },
            { icon: FileText, t: "Aceite do contrato", d: "Visualize e aceite os termos da sua fiança aluguel." },
            { icon: CreditCard, t: "Pagamento", d: "Escolha ou confirme a forma de pagamento e conclua sua ativação." },
            { icon: ShieldCheck, t: "Ativação concluída", d: "Documentos e faturas ficam disponíveis no painel do inquilino." },
          ].map((s, i) => (
            <li key={i} className="flex gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-[#FFD400] grid place-items-center">
                <s.icon className="h-5 w-5 text-black" />
              </div>
              <div>
                <div className="font-bold text-sm">{s.t}</div>
                <div className="text-xs text-neutral-600">{s.d}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="p-6 rounded-2xl">
        <h2 className="font-black text-lg mb-2">Perguntas frequentes</h2>
        <Accordion type="single" collapsible>
          {[
            ["O que é a Fiança Aluguel NOX?", "É uma garantia locatícia digital que ajuda a substituir fiador ou caução, facilitando a contratação do aluguel com mais segurança."],
            ["Por que preciso confirmar meu CPF?", "Para garantir que somente a pessoa vinculada à proposta consiga acessar e ativar a fiança."],
            ["Por que preciso fazer biometria facial?", "A biometria ajuda a confirmar sua identidade e protege a contratação contra uso indevido dos seus dados."],
            ["Onde vejo meus documentos depois?", "Após a ativação, os documentos ficam disponíveis no painel do inquilino, junto com faturas e informações do contrato."],
            ["E se eu não reconhecer essa proposta?", "Não prossiga com a ativação e entre em contato com a imobiliária ou com a equipe NOX."],
          ].map(([q, a], i) => (
            <AccordionItem key={i} value={`i${i}`}>
              <AccordionTrigger className="text-sm font-semibold text-left">{q}</AccordionTrigger>
              <AccordionContent className="text-sm text-neutral-600">{a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Card>
    </div>
  );
}

/* ============== Tela 2: Biometria ============== */
function TelaBiometria({
  onConcluido,
  loading,
}: {
  onConcluido: (imageBase64: string) => void;
  loading: boolean;
}) {
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function abrirCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch {
      toast.error("Não foi possível acessar a câmera.");
    }
  }

  function capturar() {
    if (!videoRef.current) return;
    const c = document.createElement("canvas");
    c.width = videoRef.current.videoWidth;
    c.height = videoRef.current.videoHeight;
    c.getContext("2d")!.drawImage(videoRef.current, 0, 0);
    setPreview(c.toDataURL("image/jpeg", 0.8));
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setStreaming(false);
  }

  return (
    <Card className="p-6 rounded-2xl space-y-5">
      <div>
        <h2 className="text-xl font-black">Vamos iniciar com a sua biometria facial</h2>
        <p className="text-sm text-neutral-600 mt-1">
          A biometria facial confirma sua identidade por meio das características do seu rosto,
          oferecendo autenticação rápida e segura.
        </p>
      </div>

      <ul className="space-y-2 text-sm">
        {[
          "Certifique-se de que a biometria será feita pela pessoa do CPF informado",
          "Encontre um local bem iluminado",
          "Mantenha uma expressão neutra",
          "Evite usar óculos escuros, boné ou acessórios que cubram o rosto",
        ].map((t) => (
          <li key={t} className="flex gap-2">
            <Check className="h-4 w-4 mt-0.5 text-[#FFB800] shrink-0" />
            <span>{t}</span>
          </li>
        ))}
      </ul>

      <div className="aspect-square w-full max-w-sm mx-auto bg-black rounded-2xl relative overflow-hidden grid place-items-center">
        {preview ? (
          <img src={preview} alt="preview" className="absolute inset-0 w-full h-full object-cover" />
        ) : streaming ? (
          <video ref={videoRef} playsInline className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <Camera className="h-16 w-16 text-neutral-700" />
        )}
        <div className="absolute inset-6 border-4 border-[#FFD400] rounded-full pointer-events-none opacity-80" />
        {streaming && (
          <div className="absolute bottom-3 text-white text-xs bg-black/60 px-3 py-1 rounded-full">
            Posicione seu rosto no centro
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        {!streaming && !preview && (
          <Button onClick={abrirCamera} className="flex-1 h-12 bg-black text-[#FFD400] font-bold rounded-xl">
            <Camera className="h-4 w-4 mr-2" /> Realizar biometria facial
          </Button>
        )}
        {streaming && (
          <Button onClick={capturar} className="flex-1 h-12 bg-[#FFD400] text-black font-bold rounded-xl">
            Capturar
          </Button>
        )}
        {preview && (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null);
                abrirCamera();
              }}
              className="flex-1 h-12 rounded-xl"
            >
              Tentar novamente
            </Button>
            <Button
              disabled={loading}
              onClick={() => onConcluido(preview)}
              className="flex-1 h-12 bg-black text-[#FFD400] font-bold rounded-xl"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar biometria"}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

/* ============== Tela 3: Contrato ============== */
function TelaContrato({
  proposta,
  loading,
  onAceitar,
}: {
  proposta: Proposta;
  loading: boolean;
  onAceitar: () => void;
}) {
  const [t1, setT1] = useState(false);
  const [t2, setT2] = useState(false);
  return (
    <Card className="p-6 rounded-2xl space-y-5">
      <div>
        <h2 className="text-xl font-black">Revise e aceite os termos da sua fiança</h2>
        <p className="text-sm text-neutral-600 mt-1">
          Leia as informações da proposta antes de continuar com a ativação.
        </p>
      </div>

      <div className="rounded-xl bg-neutral-50 border p-4 grid grid-cols-2 gap-3 text-sm">
        <Info label="Inquilino" value={proposta.tenant_name} />
        <Info label="E-mail" value={proposta.tenant_email} />
        <Info label="Imóvel" value={proposta.property_address} full />
        <Info label="Aluguel" value={fmtBRL(proposta.rent_value)} />
        <Info label="Prêmio mensal" value={fmtBRL(proposta.valor_premio_mensal)} />
        <Info label="Pagamento" value={proposta.insurance_payment_method_label || "A definir"} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="rounded-xl"><FileText className="h-4 w-4 mr-1"/>Visualizar contrato</Button>
        <Button variant="outline" className="rounded-xl"><Download className="h-4 w-4 mr-1"/>Baixar contrato</Button>
        <Button variant="outline" className="rounded-xl"><FileText className="h-4 w-4 mr-1"/>Visualizar termos</Button>
      </div>

      <div className="space-y-3">
        <label className="flex gap-3 items-start cursor-pointer text-sm">
          <Checkbox checked={t1} onCheckedChange={(v) => setT1(!!v)} className="mt-0.5" />
          <span>Li e aceito os termos do contrato da minha fiança aluguel.</span>
        </label>
        <label className="flex gap-3 items-start cursor-pointer text-sm">
          <Checkbox checked={t2} onCheckedChange={(v) => setT2(!!v)} className="mt-0.5" />
          <span>Confirmo que meus dados estão corretos e autorizo o uso das informações para ativação da garantia.</span>
        </label>
      </div>

      <Button
        disabled={!t1 || !t2 || loading}
        onClick={onAceitar}
        className="w-full h-12 bg-black text-[#FFD400] font-bold rounded-xl"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Aceitar e continuar <ChevronRight className="h-4 w-4 ml-1" /></>}
      </Button>
    </Card>
  );
}

function Info({ label, value, full }: { label: string; value?: string | null; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-sm font-semibold">{value || "—"}</div>
    </div>
  );
}

/* ============== Tela 4: Pagamento ============== */
function TelaPagamento({
  proposta,
  loading,
  onConfirmar,
}: {
  proposta: Proposta;
  loading: boolean;
  onConfirmar: (m: "credit_card" | "pix" | "boleto", label: string) => void;
}) {
  const opts = [
    { id: "credit_card" as const, label: "Cartão de crédito", icon: CreditCard, desc: "Pague com cartão de forma rápida e segura." },
    { id: "pix" as const, label: "Pix", icon: Smartphone, desc: "Pague via Pix e tenha confirmação imediata." },
    { id: "boleto" as const, label: "Boleto", icon: Barcode, desc: "Gere o boleto para pagamento até o vencimento." },
  ];
  const [sel, setSel] = useState<"credit_card" | "pix" | "boleto">(
    (proposta.insurance_payment_method as any) || "pix",
  );

  return (
    <Card className="p-6 rounded-2xl space-y-5">
      <div>
        <h2 className="text-xl font-black">
          {proposta.insurance_payment_method ? "Confirme sua forma de pagamento" : "Escolha a forma de pagamento"}
        </h2>
        <p className="text-sm text-neutral-600 mt-1">
          Valor a pagar: <strong>{fmtBRL(proposta.valor_premio_mensal)}</strong> / mês
        </p>
      </div>

      <div className="space-y-3">
        {opts.map((o) => {
          const active = sel === o.id;
          return (
            <button
              key={o.id}
              onClick={() => setSel(o.id)}
              className={`w-full text-left rounded-xl border-2 p-4 transition-all flex gap-3 items-center ${
                active ? "border-black bg-[#FFFBEA]" : "border-neutral-200 hover:border-neutral-400"
              }`}
            >
              <div className={`h-10 w-10 rounded-lg grid place-items-center ${active ? "bg-[#FFD400]" : "bg-neutral-100"}`}>
                <o.icon className="h-5 w-5 text-black" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-sm">{o.label}</div>
                <div className="text-xs text-neutral-600">{o.desc}</div>
              </div>
              {active && <Check className="h-5 w-5 text-black" />}
            </button>
          );
        })}
      </div>

      <Button
        disabled={loading}
        onClick={() => onConfirmar(sel, opts.find((o) => o.id === sel)!.label)}
        className="w-full h-12 bg-black text-[#FFD400] font-bold rounded-xl"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Concluir pagamento"}
      </Button>
    </Card>
  );
}

/* ============== Tela 5: Concluído ============== */
function TelaConcluido({ proposta, onPainel }: { proposta: Proposta | null; onPainel: () => void }) {
  return (
    <Card className="p-6 rounded-2xl text-center space-y-5">
      <div className="mx-auto h-20 w-20 rounded-full bg-[#FFD400] grid place-items-center">
        <Check className="h-10 w-10 text-black" />
      </div>
      <div>
        <h2 className="text-2xl font-black">Ativação concluída!</h2>
        <p className="text-sm text-neutral-600 mt-1">
          Sua fiança aluguel foi ativada com sucesso. Agora você pode acessar seus documentos,
          faturas e informações pelo painel do inquilino.
        </p>
      </div>

      {proposta && (
        <div className="rounded-xl bg-neutral-50 border p-4 grid grid-cols-2 gap-3 text-sm text-left">
          <Info label="Inquilino" value={proposta.tenant_name} />
          <Info label="Status" value="Ativo" />
          <Info label="Imóvel" value={proposta.property_address} full />
          <Info label="Data" value={new Date().toLocaleDateString("pt-BR")} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Button onClick={onPainel} className="h-12 bg-black text-[#FFD400] font-bold rounded-xl">
          Acessar painel do inquilino
        </Button>
        <Button variant="outline" className="h-12 rounded-xl">
          <Download className="h-4 w-4 mr-1" /> Baixar contrato
        </Button>
      </div>
    </Card>
  );
}
