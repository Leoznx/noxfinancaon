import { addMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Gift,
  ImageIcon,
  Pencil,
  Plus,
  Power,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  SELLER_REWARD_METRICS,
  sellerRewardCriterion,
  type SellerRewardMetric,
} from "@/lib/seller-goals-dashboard";
import {
  createSellerReward,
  deleteSellerReward,
  fetchSellerRewards,
  updateSellerReward,
  type SellerReward,
} from "@/lib/seller-rewards";

type RewardForm = {
  title: string;
  description: string;
  imageUrl: string;
  metric: SellerRewardMetric;
  target: string;
};

const EMPTY_FORM: RewardForm = {
  title: "",
  description: "",
  imageUrl: "",
  metric: "contracts",
  target: "",
};

export function SellerRewardsTab() {
  const { user } = useAuth();
  const now = new Date();
  const [period, setPeriod] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [rewards, setRewards] = useState<SellerReward[]>([]);
  const [form, setForm] = useState<RewardForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const month = period.getMonth() + 1;
  const year = period.getFullYear();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRewards(await fetchSellerRewards(month, year, true));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível carregar as recompensas.",
      );
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => void load();
    const channel = supabase
      .channel("admin-seller-rewards-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_rewards" }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function validateForm() {
    if (!form.title.trim()) return "Informe o nome da recompensa.";
    if (!form.imageUrl.trim()) return "Informe o link da foto da recompensa.";
    try {
      const url = new URL(form.imageUrl.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      return "Use um link de imagem válido começando com http:// ou https://.";
    }
    const target = Number(form.target);
    if (!Number.isInteger(target) || target <= 0) {
      return "A quantidade necessária deve ser um número inteiro maior que zero.";
    }
    return null;
  }

  async function save() {
    const validationError = validateForm();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        month,
        year,
        title: form.title.trim(),
        description: form.description.trim() || null,
        image_url: form.imageUrl.trim(),
        metric: form.metric,
        target: Number(form.target),
      };
      if (editingId) {
        const before = rewards.find((reward) => reward.id === editingId);
        await updateSellerReward(editingId, payload);
        registrarAuditoria({
          actorUserId: user?.id,
          actorRole: user?.internalRole || user?.role,
          action: "editar_recompensa_vendedor",
          tableName: "seller_rewards",
          recordId: editingId,
          before,
          after: payload,
        });
        toast.success("Recompensa atualizada.");
      } else {
        const created = await createSellerReward({
          ...payload,
          display_order: rewards.length,
          created_by: user?.id ?? null,
        });
        registrarAuditoria({
          actorUserId: user?.id,
          actorRole: user?.internalRole || user?.role,
          action: "criar_recompensa_vendedor",
          tableName: "seller_rewards",
          recordId: created.id,
          after: created,
        });
        toast.success("Recompensa adicionada.");
      }
      resetForm();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a recompensa.");
    } finally {
      setSaving(false);
    }
  }

  function edit(reward: SellerReward) {
    setEditingId(reward.id);
    setForm({
      title: reward.title,
      description: reward.description ?? "",
      imageUrl: reward.image_url,
      metric: reward.metric,
      target: String(reward.target),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleActive(reward: SellerReward) {
    try {
      await updateSellerReward(reward.id, { active: !reward.active });
      toast.success(reward.active ? "Recompensa pausada." : "Recompensa ativada.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar o status.");
    }
  }

  async function remove(reward: SellerReward) {
    if (!window.confirm(`Excluir a recompensa “${reward.title}”?`)) return;
    try {
      await deleteSellerReward(reward.id);
      registrarAuditoria({
        actorUserId: user?.id,
        actorRole: user?.internalRole || user?.role,
        action: "excluir_recompensa_vendedor",
        tableName: "seller_rewards",
        recordId: reward.id,
        before: reward,
      });
      if (editingId === reward.id) resetForm();
      toast.success("Recompensa excluída.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir.");
    }
  }

  function shiftMonth(amount: number) {
    setPeriod((current) => addMonths(current, amount));
    resetForm();
  }

  const periodLabel = format(period, "MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-yellow-200">
        <CardHeader className="border-b border-yellow-100 bg-gradient-to-r from-yellow-50 via-white to-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Gift className="h-5 w-5 text-yellow-600" /> Recompensas mensais
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Defina a premiação, a foto por link e o resultado necessário para desbloqueá-la.
              </p>
            </div>
            <div className="flex items-center gap-1 self-start rounded-xl border border-neutral-200 bg-white p-1 shadow-sm lg:self-auto">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => shiftMonth(-1)}
                aria-label="Mês anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="w-40 text-center text-sm font-black capitalize">{periodLabel}</span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => shiftMonth(1)}
                aria-label="Próximo mês"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          <div className="rounded-2xl border border-yellow-200 bg-yellow-50/40 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-black text-neutral-950">
                  {editingId ? "Editar recompensa" : "Nova recompensa"}
                </p>
                <p className="text-xs text-neutral-500">
                  Ela aparecerá automaticamente em Minhas Metas.
                </p>
              </div>
              {editingId && (
                <Button variant="ghost" size="sm" className="gap-1" onClick={resetForm}>
                  <X className="h-4 w-4" /> Cancelar
                </Button>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="reward-title">Nome da recompensa</Label>
                <Input
                  id="reward-title"
                  value={form.title}
                  maxLength={120}
                  placeholder="Ex.: Fone de ouvido premium"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reward-image">Link da foto</Label>
                <Input
                  id="reward-image"
                  type="url"
                  value={form.imageUrl}
                  placeholder="https://.../recompensa.jpg"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, imageUrl: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Resultado necessário</Label>
                <Select
                  value={form.metric}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, metric: value as SellerRewardMetric }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SELLER_REWARD_METRICS).map(([value, copy]) => (
                      <SelectItem key={value} value={value}>
                        {copy.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reward-target">Quantidade para desbloquear</Label>
                <Input
                  id="reward-target"
                  type="number"
                  min={1}
                  step={1}
                  value={form.target}
                  placeholder="Ex.: 10"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, target: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="reward-description">Descrição (opcional)</Label>
                <Textarea
                  id="reward-description"
                  value={form.description}
                  maxLength={500}
                  placeholder="Explique os detalhes da premiação."
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                className="gap-2 bg-neutral-950 text-yellow-300 hover:bg-neutral-800"
                onClick={save}
                disabled={saving}
              >
                {editingId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {saving ? "Salvando…" : editingId ? "Salvar alterações" : "Adicionar recompensa"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 text-base">
            <span>Recompensas configuradas</span>
            <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-800">
              {rewards.length} {rewards.length === 1 ? "recompensa" : "recompensas"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-neutral-500">Carregando recompensas…</p>
          ) : rewards.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-5 py-10 text-center">
              <Gift className="mx-auto h-7 w-7 text-yellow-500" />
              <p className="mt-3 font-bold text-neutral-900">Nenhuma recompensa neste mês</p>
              <p className="mt-1 text-sm text-neutral-500">
                Cadastre a primeira premiação no formulário acima.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {rewards.map((reward) => (
                <article
                  key={reward.id}
                  className={`grid gap-4 rounded-2xl border p-4 sm:grid-cols-[116px_minmax(0,1fr)] lg:grid-cols-[116px_minmax(0,1fr)_auto] ${
                    reward.active
                      ? "border-yellow-200 bg-white"
                      : "border-neutral-200 bg-neutral-50 opacity-70"
                  }`}
                >
                  <RewardImage src={reward.image_url} alt={reward.title} />
                  <div className="min-w-0 self-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black text-neutral-950">{reward.title}</h3>
                      <Badge
                        className={
                          reward.active
                            ? "bg-yellow-400 text-black"
                            : "bg-neutral-200 text-neutral-700"
                        }
                      >
                        {reward.active ? "Ativa" : "Pausada"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm font-bold text-yellow-700">
                      Meta: {sellerRewardCriterion(reward.metric, reward.target)}
                    </p>
                    {reward.description && (
                      <p className="mt-2 text-sm text-neutral-500">{reward.description}</p>
                    )}
                    <p className="mt-2 truncate text-[11px] text-neutral-400">
                      Foto: {reward.image_url}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1 lg:flex-col lg:justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1 lg:w-28"
                      onClick={() => edit(reward)}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1 lg:w-28"
                      onClick={() => toggleActive(reward)}
                    >
                      <Power className="h-3.5 w-3.5" /> {reward.active ? "Pausar" : "Ativar"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 gap-1 text-red-600 hover:bg-red-50 hover:text-red-700 lg:w-28"
                      onClick={() => remove(reward)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Excluir
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RewardImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-24 w-full items-center justify-center rounded-xl border border-dashed border-yellow-300 bg-yellow-50 text-yellow-700 sm:h-24 sm:w-[116px]">
        <ImageIcon className="h-6 w-6" aria-label={`Foto indisponível: ${alt}`} />
      </div>
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt={alt}
      className="h-24 w-full rounded-xl border border-neutral-200 bg-neutral-100 object-cover sm:w-[116px]"
      onError={() => setFailed(true)}
    />
  );
}
