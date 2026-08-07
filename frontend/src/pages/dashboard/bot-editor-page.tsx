import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Edit2,
  X,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageContentForm } from "@/components/bots/message-content-form";
import {
  useBot,
  useCreateStep,
  useUpdateStep,
  useDeleteStep,
  useCreateTrigger,
  useUpdateTrigger,
  useDeleteTrigger,
  useUpdateBot,
} from "@/hooks/use-bots";
import { useTenantSummary } from "@/hooks/use-tenant";
import type {
  BotStatus,
  BotStep,
  BotStepCondition,
  StepMessageType,
} from "@/types/bots";

const STATUS_LABEL: Record<BotStatus, string> = {
  draft: "Rascunho",
  testing: "Em teste",
  active: "Ativo",
  inactive: "Inativo",
};

const STATUS_BADGE: Record<
  BotStatus,
  "secondary" | "warning" | "success" | "outline"
> = {
  draft: "secondary",
  testing: "warning",
  active: "success",
  inactive: "outline",
};

const STATUS_NEXT: BotStatus[] = ["draft", "testing", "active", "inactive"];

export function BotEditorPage() {
  const { id } = useParams() as { id: string };
  const { data: bot, isLoading } = useBot(id);
  const navigate = useNavigate();
  const updateBot = useUpdateBot();

  if (isLoading) {
    return (
      <DashboardLayout>
        <Skeleton className="h-96 rounded-xl" />
      </DashboardLayout>
    );
  }
  if (!bot) {
    return (
      <DashboardLayout>
        <p>Bot não encontrado.</p>
      </DashboardLayout>
    );
  }

  // Bot AUTO não usa esta página.
  if (bot.type === "AUTO") {
    void navigate(`/dashboard/broadcasts/${bot.id}`, { replace: true });
    return null;
  }

  const isAgents = bot.type === "AGENTS";

  function changeStatus(next: BotStatus) {
    updateBot.mutate({ id, status: next });
  }

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/dashboard/bots")}
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{bot.name}</h1>
        <Badge variant={bot.type === "SIMPLE" ? "outline" : "secondary"}>
          {bot.type === "SIMPLE" ? "Comum" : "Agentes"}
        </Badge>
        <Badge variant={STATUS_BADGE[bot.status]}>
          {STATUS_LABEL[bot.status]}
        </Badge>

        {/* Switch de status */}
        <div className="ml-auto flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Status:</Label>
          <select
            value={bot.status}
            onChange={(e) => changeStatus(e.target.value as BotStatus)}
            disabled={updateBot.isPending}
            className="h-8 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {STATUS_NEXT.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-6">
        <ConfigPanel botId={bot.id} bot={bot} />
        {isAgents && (
          <TriggersPanel botId={bot.id} triggers={bot.triggers ?? []} />
        )}
        <StepsPanel
          botId={bot.id}
          steps={bot.steps ?? []}
          isAgents={isAgents}
        />
      </div>
    </DashboardLayout>
  );
}

// ─── Painel de configurações ─────────────────────────────────────────

type BotLike = {
  id: string;
  name: string;
  type: "SIMPLE" | "AGENTS" | "AUTO";
  description?: string | null;
  testContactPhone?: string | null;
};

function ConfigPanel({ botId, bot }: { botId: string; bot: BotLike }) {
  const updateBot = useUpdateBot();
  const { data: tenantSummary } = useTenantSummary();
  const navigate = useNavigate();
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description ?? "");
  const [testPhone, setTestPhone] = useState(
    (bot.testContactPhone ?? "").replace(/\D/g, ""),
  );
  const [dirty, setDirty] = useState(false);

  const hasBusinessHours = Boolean(
    tenantSummary?.businessHours &&
    tenantSummary.businessHours.days &&
    tenantSummary.businessHours.days.length > 0,
  );

  const isAgents = bot.type === "AGENTS";

  function mark<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  function save() {
    const digitsOnly = testPhone.trim() ? testPhone.replace(/\D/g, "") : null;
    updateBot.mutate(
      {
        id: botId,
        name: name.trim() || bot.name,
        description: description.trim() || null,
        testContactPhone:
          digitsOnly && digitsOnly.length > 0 ? digitsOnly : null,
      },
      {
        onSuccess: () => {
          setDirty(false);
          toast.success("Configurações salvas.");
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h3 className="text-sm font-semibold">Configurações</h3>

        {!hasBusinessHours && isAgents && (
          <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-0.5">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                Sem horário de atendimento configurado
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
                A mensagem fora do horário não será verificada nem enviada
                enquanto a organização não tiver um horário definido.
              </p>
              <button
                type="button"
                onClick={() => navigate("/dashboard/profile")}
                className="text-xs font-medium text-amber-800 underline-offset-2 hover:underline dark:text-amber-200"
              >
                Configurar horário nas configurações da organização →
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cfg-name" className="text-xs">
              Nome
            </Label>
            <Input
              id="cfg-name"
              value={name}
              onChange={(e) => mark(setName)(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfg-desc" className="text-xs">
              Descrição
            </Label>
            <Input
              id="cfg-desc"
              value={description}
              onChange={(e) => mark(setDescription)(e.target.value)}
              placeholder="(opcional)"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cfg-phone" className="text-xs">
              Telefone para testes (E.164, só dígitos)
            </Label>
            <Input
              id="cfg-phone"
              value={testPhone}
              onChange={(e) => mark(setTestPhone)(e.target.value)}
              placeholder="5511999999999"
              className="font-mono text-sm"
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground">
              DDI + DDD + número, sem "+". Ex: 5511999999999. Bot em "testing"
              só responde a este número.
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={save}
            disabled={!dirty || updateBot.isPending}
            size="sm"
          >
            <Save className="h-4 w-4" /> Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Painel de gatilhos (somente AGENTS) ──────────────────────────────

type TriggerLike = {
  id: string;
  tipo: "keyword" | "first_message";
  valor: string | null;
};

function TriggersPanel({
  botId,
  triggers,
}: {
  botId: string;
  triggers: TriggerLike[];
}) {
  const createTrigger = useCreateTrigger();
  const updateTrigger = useUpdateTrigger();
  const deleteTrigger = useDeleteTrigger();
  const [newKind, setNewKind] = useState<"keyword" | "first_message">(
    "keyword",
  );
  const [newVal, setNewVal] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});

  function add() {
    if (newKind === "keyword" && !newVal.trim()) return;
    createTrigger.mutate(
      { botId, payload: { tipo: newKind, valor: newVal.trim() || undefined } },
      { onSuccess: () => setNewVal("") },
    );
  }

  function commitEdit(t: TriggerLike) {
    const v = editing[t.id];
    if (v === undefined) return;
    updateTrigger.mutate(
      { botId, triggerId: t.id, payload: { valor: v.trim() || null } },
      {
        onSuccess: () =>
          setEditing((s) => {
            const c = { ...s };
            delete c[t.id];
            return c;
          }),
      },
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Gatilhos</h3>
          <span className="text-xs text-muted-foreground">
            Disparam o fluxo do bot
          </span>
        </div>

        {triggers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum gatilho. Por padrão o bot responde à primeira mensagem
            (first_message implícito).
          </p>
        ) : (
          <ul className="space-y-2">
            {triggers.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-md border bg-secondary/30 px-3 py-2"
              >
                <Badge variant="outline" className="text-[10px]">
                  {t.tipo}
                </Badge>
                {editing[t.id] !== undefined ? (
                  <>
                    <Input
                      value={editing[t.id]}
                      onChange={(e) =>
                        setEditing((s) => ({ ...s, [t.id]: e.target.value }))
                      }
                      placeholder="palavra-chave"
                      className="h-7 flex-1"
                      autoFocus
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => commitEdit(t)}
                      aria-label="Salvar"
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() =>
                        setEditing((s) => {
                          const c = { ...s };
                          delete c[t.id];
                          return c;
                        })
                      }
                      aria-label="Cancelar"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-mono">
                      {t.valor ?? "—"}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() =>
                        setEditing((s) => ({ ...s, [t.id]: t.valor ?? "" }))
                      }
                      aria-label="Editar gatilho"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() =>
                        deleteTrigger.mutate({ botId, triggerId: t.id })
                      }
                      aria-label="Remover gatilho"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <select
              value={newKind}
              onChange={(e) =>
                setNewKind(e.target.value as "keyword" | "first_message")
              }
              className="h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="keyword"> palavra-chave</option>
              <option value="first_message">primeira mensagem</option>
            </select>
          </div>
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Valor (somente keyword)</Label>
            <Input
              value={newVal}
              onChange={(e) => setNewVal(e.target.value)}
              placeholder="ex: iniciar"
              disabled={newKind === "first_message"}
            />
          </div>
          <Button onClick={add} disabled={createTrigger.isPending} size="sm">
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Painel de steps ─────────────────────────────────────────────────

type StepLike = BotStep;

function StepsPanel({
  botId,
  steps,
  isAgents,
}: {
  botId: string;
  steps: StepLike[];
  isAgents: boolean;
}) {
  const createStep = useCreateStep();
  const deleteStep = useDeleteStep();

  const [editing, setEditing] = useState<Record<string, boolean>>({});

  // State do novo step
  const [newType, setNewType] = useState<StepMessageType>("text");
  const [newContent, setNewContent] = useState<Record<string, unknown>>({});
  const [newOrder, setNewOrder] = useState<number>(
    steps.length > 0 ? Math.max(...steps.map((s) => s.ordem)) + 1 : 1,
  );

  function addStep() {
    if (
      newType !== "text" &&
      newType !== "handoff" &&
      Object.keys(newContent).length === 0
    ) {
      toast.error("Preencha o conteúdo da mensagem antes de adicionar.");
      return;
    }
    createStep.mutate(
      {
        botId,
        payload: {
          ordem: newOrder,
          tipoMensagem: newType,
          conteudo: newContent,
        },
      },
      {
        onSuccess: () => {
          setNewContent({});
          setNewOrder((o) => o + 1);
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Steps</h3>
          <span className="text-xs text-muted-foreground">
            {isAgents ? "Multi-step (condicional)" : "1 mensagem — finaliza"}
          </span>
        </div>

        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isAgents
              ? "Nenhum step. Adicione abaixo."
              : "Nenhum step. Adicione a única mensagem abaixo."}
          </p>
        ) : (
          <ul className="space-y-2">
            {steps.map((s) => (
              <li
                key={s.id}
                className="rounded-md border bg-secondary/30 px-3 py-2"
              >
                <StepRow
                  botId={botId}
                  step={s}
                  isEditing={Boolean(editing[s.id])}
                  onToggleEdit={() =>
                    setEditing((e) => ({ ...e, [s.id]: !e[s.id] }))
                  }
                  onDelete={() => deleteStep.mutate({ botId, stepId: s.id })}
                  allowHandoff={isAgents}
                  isAgents={isAgents}
                  allowedTypes={isAgents ? undefined : ["text", "media"]}
                />
              </li>
            ))}
          </ul>
        )}

        {(isAgents || steps.length === 0) && (
          <div className="border-t pt-4">
            <h4 className="mb-3 text-sm font-semibold">Novo step</h4>
            <div className="grid gap-3 lg:grid-cols-[1fr_140px]">
              <MessageContentForm
                type={newType}
                onTypeChange={setNewType}
                value={newContent}
                onChange={setNewContent}
                allowHandoff={isAgents}
                allowedTypes={isAgents ? undefined : ["text", "media"]}
              />
              <div className="space-y-3">
                {isAgents ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="new-order" className="text-xs">
                      Ordem
                    </Label>
                    <Input
                      id="new-order"
                      type="number"
                      min={1}
                      value={newOrder}
                      onChange={(e) =>
                        setNewOrder(parseInt(e.target.value, 10) || 1)
                      }
                    />
                  </div>
                ) : null}
                <Button
                  onClick={addStep}
                  disabled={createStep.isPending}
                  className="w-full"
                >
                  <Plus className="h-4 w-4" /> Adicionar
                </Button>
              </div>
            </div>
          </div>
        )}

        {!isAgents && steps.length > 0 && (
          <div className="rounded-md border border-dashed bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
            Bot comum envia apenas uma mensagem e finaliza a interação — não é
            possível adicionar mais steps.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type UpdateStepPayloadMinimal = {
  tipoMensagem?: StepMessageType;
  conteudo?: Record<string, unknown>;
  condicoesProximo?: BotStepCondition[];
  fallbackStepOrder?: number | null;
};

function StepRow({
  botId,
  step,
  isEditing,
  onToggleEdit,
  onDelete,
  allowHandoff,
  isAgents,
  allowedTypes,
}: {
  botId: string;
  step: BotStep;
  isEditing: boolean;
  onToggleEdit: () => void;
  onDelete: () => void;
  allowHandoff: boolean;
  isAgents: boolean;
  allowedTypes?: StepMessageType[];
}) {
  const updateStep = useUpdateStep();

  const [draftType, setDraftType] = useState<StepMessageType>(
    step.tipoMensagem,
  );
  const [draftContent, setDraftContent] = useState<Record<string, unknown>>(
    step.conteudo,
  );
  const [draftFallback, setDraftFallback] = useState<number | null>(
    step.fallbackStepOrder,
  );
  const [draftCond, setDraftCond] = useState<BotStepCondition[]>(
    step.condicoesProximo ?? [],
  );

  // Resync local quando o step muda externamente (refetch).
  useEffect(() => {
    setDraftType(step.tipoMensagem);
    setDraftContent(step.conteudo);
    setDraftFallback(step.fallbackStepOrder);
    setDraftCond(step.condicoesProximo ?? []);
  }, [
    step.id,
    step.ordem,
    step.tipoMensagem,
    step.conteudo,
    step.fallbackStepOrder,
    step.condicoesProximo,
  ]);

  function buildPayload(): UpdateStepPayloadMinimal {
    return {
      tipoMensagem: draftType,
      conteudo: draftContent,
      condicoesProximo: draftCond.length > 0 ? draftCond : undefined,
      fallbackStepOrder: draftFallback,
    };
  }

  function save() {
    updateStep.mutate(
      { botId, stepId: step.id, payload: buildPayload() },
      { onSuccess: onToggleEdit },
    );
  }

  function showContent(text: string | undefined): string {
    return text ?? "";
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="tabular-nums text-xs text-muted-foreground">
          #{step.ordem}
        </span>
        <Badge variant="outline" className="text-[10px]">
          {step.tipoMensagem}
        </Badge>
        {step.tipoMensagem === "text" && (
          <span className="line-clamp-1 text-sm text-muted-foreground">
            {showContent(step.conteudo.text as string | undefined)}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onToggleEdit}
            aria-label="Editar step"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive"
            onClick={onDelete}
            aria-label="Remover step"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isEditing && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <MessageContentForm
            type={draftType}
            onTypeChange={setDraftType}
            value={draftContent}
            onChange={setDraftContent}
            allowHandoff={allowHandoff}
            allowedTypes={allowedTypes}
          />

          {/* Condições de próximo e Fallback — apenas bots AGENTS (multi-step). */}
          {isAgents && (
            <>
              {/* Condições de próximo (AGENTS) */}
              <div className="space-y-1.5">
                <Label className="text-xs">Condições de próximo step</Label>
                {draftCond.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Sem condições — o próximo step (por ordem) é executado.
                    Handoff finaliza.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {draftCond.map((c, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <Input
                          value={c.match}
                          onChange={(e) => {
                            const next = [...draftCond];
                            next[i] = { ...next[i], match: e.target.value };
                            setDraftCond(next);
                          }}
                          placeholder="match"
                          className="h-7 flex-1"
                        />
                        <Input
                          type="number"
                          value={c.stepOrder}
                          onChange={(e) => {
                            const next = [...draftCond];
                            next[i] = {
                              ...next[i],
                              stepOrder: parseInt(e.target.value, 10) || 1,
                            };
                            setDraftCond(next);
                          }}
                          placeholder="ordem"
                          className="h-7 w-20"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() =>
                            setDraftCond(draftCond.filter((_, j) => j !== i))
                          }
                          aria-label="Remover condição"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraftCond([...draftCond, { match: "", stepOrder: 1 }])
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar condição
                </Button>
              </div>

              {/* Fallback */}
              <div className="space-y-1.5">
                <Label htmlFor={`fb-${step.id}`} className="text-xs">
                  Fallback (ordem do step, opcional)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`fb-${step.id}`}
                    type="number"
                    value={draftFallback ?? ""}
                    onChange={(e) =>
                      setDraftFallback(
                        e.target.value
                          ? parseInt(e.target.value, 10) || null
                          : null,
                      )
                    }
                    placeholder="ex: 2"
                    className="h-7 w-28"
                  />
                  <span className="text-xs text-muted-foreground">
                    Step executado quando nenhuma condição bater.
                  </span>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onToggleEdit}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={updateStep.isPending}>
              <Save className="h-3.5 w-3.5" /> Salvar step
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
