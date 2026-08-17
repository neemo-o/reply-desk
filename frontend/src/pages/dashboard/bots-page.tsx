import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Bot, Plus, Trash2, Edit, Megaphone, MessageSquare, Hash, Power } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBots, useCreateBot, useDeleteBot, useUpdateBot } from "@/hooks/use-bots";
import { useBotSessionCountRealtime } from "@/hooks/use-bot-session-count-realtime";
import { useSubscription } from "@/hooks/use-subscription";
import { cn } from "@/lib/utils";
import type { BotType, Bot as APIBot } from "@/types/bots";

const TYPE_LABEL: Record<BotType, string> = {
  SIMPLE: "Comum",
  AGENTS: "Agentes",
  AUTO: "Auto-mensagem",
};

const TYPE_DESCRIPTION: Record<BotType, string> = {
  SIMPLE: "Envia uma única mensagem e finaliza.",
  AGENTS: "Fluxo multi-step com gatilhos e handoff.",
  AUTO: "Dispara broadcasts agendados para uma lista de contatos.",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  testing: "Em teste",
  active: "Ativo",
  inactive: "Inativo",
};

const STATUS_DOT: Record<string, string> = {
  draft: "bg-muted-foreground/60",
  testing: "bg-amber-500",
  active: "bg-emerald-500",
  inactive: "bg-muted-foreground/40",
};

const TYPE_ICON: Record<BotType, LucideIcon> = {
  SIMPLE: MessageSquare,
  AGENTS: Bot,
  AUTO: Megaphone,
};

const TYPE_DEFAULTS: BotType = "AGENTS";

const TYPE_ORDER: BotType[] = ["SIMPLE", "AGENTS", "AUTO"];

export function BotsPage() {
  const { data: bots, isLoading } = useBots();
  const { data: subscription } = useSubscription();
  const createBot = useCreateBot();
  const deleteBot = useDeleteBot();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<BotType>(TYPE_DEFAULTS);
  const [description, setDescription] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // 🔒 Bug 5 — Atualiza em tempo real o número de sessões ativas por bot
  // quando o backend emite `bot.sessionCount` (conexão/desconexão WA).
  useBotSessionCountRealtime();

  const grouped = useMemo(() => {
    const map: Record<BotType, APIBot[]> = { SIMPLE: [], AGENTS: [], AUTO: [] };
    for (const b of bots ?? []) map[b.type]?.push(b);
    return map;
  }, [bots]);

  const activeCount = useMemo(
    () => (bots ?? []).filter((b) => b.status === "active" || b.status === "testing").length,
    [bots],
  );

  const plan = subscription?.plan;
  const maxActiveBots = plan?.maxActiveBots ?? 0;

  function handleCreate() {
    if (!name.trim()) return;
    createBot.mutate(
      {
        name: name.trim(),
        type,
        description: description.trim() || undefined,
      },
      {
        onSuccess: (bot) => {
          setName("");
          setDescription("");
          setCreateOpen(false);
          if (bot.type === "AUTO") navigate(`/dashboard/broadcasts/${bot.id}`);
          else navigate(`/dashboard/bots/${bot.id}`);
        },
      },
    );
  }

  return (
    <DashboardLayout>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Bot className="h-6 w-6" />
            Bots
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie bots conversacionais e campanhas de auto-mensagem.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ActiveBotsBadge
            total={activeCount}
            max={maxActiveBots}
            isLoading={isLoading}
          />
          <Button
            onClick={() => {
              setType(TYPE_DEFAULTS);
              setCreateOpen(true);
            }}
            disabled={createBot.isPending}
          >
            <Plus className="h-4 w-4" />
            Novo Bot
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : bots && bots.length === 0 ? (
        <div className="py-20 text-center">
          <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">Nenhum bot criado ainda.</p>
          <p className="text-sm text-muted-foreground">Crie o seu primeiro bot acima.</p>
        </div>
      ) : (
        <>
          {TYPE_ORDER.map((t) =>
            grouped[t].length > 0 ? (
              <section key={t} className="mb-8">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground/70">
                  {TYPE_LABEL[t]}
                  <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium normal-case text-muted-foreground tabular-nums">
                    {grouped[t].length}
                    {plan?.maxBotsPerType
                      ? ` / ${plan.maxBotsPerType}`
                      : ""}
                  </span>
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {grouped[t].map((bot) => (
                    <BotCard
                      key={bot.id}
                      bot={bot}
                      onClick={() =>
                        t === "AUTO"
                          ? navigate(`/dashboard/broadcasts/${bot.id}`)
                          : navigate(`/dashboard/bots/${bot.id}`)
                      }
                      onDelete={() => setDeleteTarget(bot.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </>
      )}

      {/* Criar bot — Sheet */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="flex flex-col gap-0 p-0">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Novo Bot
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="bname" className="text-xs">Nome</Label>
              <Input
                id="bname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Atendimento automático"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="btype" className="text-xs">Tipo</Label>
              <select
                id="btype"
                value={type}
                onChange={(e) => setType(e.target.value as BotType)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {TYPE_DESCRIPTION[type]}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bdesc" className="text-xs">Descrição (opcional)</Label>
              <Input
                id="bdesc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Para que serve este bot"
              />
            </div>
          </div>

          <SheetFooter className="flex-row justify-end gap-2">
            <Button onClick={() => setCreateOpen(false)} variant="outline">
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || createBot.isPending}>
              {createBot.isPending ? "Criando…" : "Criar"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* AlertDialog — Confirmar deletar */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover bot?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Gatilhos e steps vinculados serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteBot.mutate(deleteTarget, {
                    onSuccess: () => setDeleteTarget(null),
                  });
                }
              }}
              disabled={deleteBot.isPending}
            >
              {deleteBot.isPending ? "Removendo…" : "Sim, remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function BotCard({
  bot,
  onClick,
  onDelete,
}: {
  bot: APIBot;
  onClick: () => void;
  onDelete: () => void;
}) {
  const status = bot.status;
  const Icon = TYPE_ICON[bot.type];
  const updateBot = useUpdateBot();

  // 🤖 S24 — Inativar/Ativar bot direto do card. Para bots AUTO, inativar
  // também desconecta as sessões WhatsApp vinculadas (cascade no backend);
  // por isso pedimos confirmação quando o bot está ativo e tem sessões.
  const isActive = status === "active";
  const canToggle = status === "active" || status === "inactive" || status === "draft";

  function toggleStatus() {
    updateBot.mutate(
      { id: bot.id, status: isActive ? "inactive" : "active" },
      {
        onSuccess: () =>
          toast.success(isActive ? "Bot inativado." : "Bot ativado."),
      },
    );
  }

  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                STATUS_DOT[status],
              )}
            />
            <div>
              <div className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-semibold">{bot.name}</p>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {TYPE_LABEL[bot.type]}
                </Badge>
                <span>{STATUS_LABEL[status] ?? status}</span>
              </div>
              {bot._count && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {bot.type === "AUTO"
                    ? `${bot._count.broadcasts} campanhas`
                    : `${bot._count.sessions} sessões ativas`}
                </p>
              )}
              {bot.description && (
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/80">
                  {bot.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-1">
            {canToggle && (
              <Button
                variant="ghost"
                size="icon"
                className="-mr-1.5 h-7 w-7"
                title={
                  isActive
                    ? "Inativar bot"
                    : status === "draft"
                      ? "Publicar (ativar) bot"
                      : "Ativar bot"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  toggleStatus();
                }}
                disabled={updateBot.isPending}
              >
                <Power
                  className={cn(
                    "h-3.5 w-3.5",
                    isActive && "text-destructive",
                  )}
                />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="-mr-1.5 h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-1.5 h-7 w-7 text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── badge de bots ativos (ativos / limiar do plano) ────────────────

function ActiveBotsBadge({
  total,
  max,
  isLoading,
}: {
  total: number;
  max: number;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-9 w-32 rounded-full" />;
  }
  if (max <= 0) {
    // Sem plano/limite conhecido — não exibe nada.
    return null;
  }
  const atLimit = total >= max;
  return (
    <Badge
      variant={atLimit ? "warning" : "outline"}
      className="h-9 gap-1.5 px-3 text-xs font-medium"
      title={
        atLimit
          ? "Limite de bots ativos do plano atingido — desative um bot ou faça upgrade para ativar mais"
          : `${total} de ${max} bots ativos no plano`
      }
    >
      <Hash className="h-3.5 w-3.5" />
      <span className="tabular-nums">
        {total}/{max}
      </span>{" "}
      ativos
    </Badge>
  );
}
