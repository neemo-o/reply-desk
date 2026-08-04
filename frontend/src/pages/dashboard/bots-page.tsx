import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Bot, Plus, Trash2, Edit, Megaphone, MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBots, useCreateBot, useDeleteBot } from "@/hooks/use-bots";
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
  const createBot = useCreateBot();
  const deleteBot = useDeleteBot();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<BotType>(TYPE_DEFAULTS);
  const [description, setDescription] = useState("");
  const [testContactPhone, setTestContactPhone] = useState("");
  const [offlineMessage, setOfflineMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map: Record<BotType, APIBot[]> = { SIMPLE: [], AGENTS: [], AUTO: [] };
    for (const b of bots ?? []) map[b.type]?.push(b);
    return map;
  }, [bots]);

  function handleCreate() {
    if (!name.trim()) return;
    const digitsOnly = testContactPhone.trim() ? testContactPhone.replace(/\D/g, "") : undefined;
    createBot.mutate(
      {
        name: name.trim(),
        type,
        description: description.trim() || undefined,
        testContactPhone: digitsOnly || undefined,
        offlineMessage: offlineMessage.trim() || undefined,
      },
      {
        onSuccess: (bot) => {
          setName("");
          setDescription("");
          setTestContactPhone("");
          setOfflineMessage("");
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
                <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground/70">
                  {TYPE_LABEL[t]}
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
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Novo Bot</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="bname">Nome</Label>
              <Input
                id="bname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Atendimento automático"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as BotType)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{TYPE_DESCRIPTION[type]}</p>
            </div>
            <div>
              <Label htmlFor="bdesc">Descrição (opcional)</Label>
              <Input
                id="bdesc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Para que serve este bot"
              />
            </div>
            <div>
              <Label htmlFor="bphone">Telefone para testes (opcional, E.164)</Label>
              <Input
                id="bphone"
                value={testContactPhone}
                onChange={(e) => setTestContactPhone(e.target.value)}
                placeholder="5511999999999"
                className="font-mono text-sm"
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                Só dígitos (DDI + DDD + número, sem "+"). Quando o status
                for "testing", o bot só responde a este número.
              </p>
            </div>
            <div>
              <Label htmlFor="boffline">Mensagem fora do horário (opcional)</Label>
              <textarea
                id="boffline"
                value={offlineMessage}
                onChange={(e) => setOfflineMessage(e.target.value)}
                rows={2}
                placeholder="Responderemos no próximo horário de atendimento"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button onClick={() => setCreateOpen(false)} variant="outline">
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || createBot.isPending}>
              {createBot.isPending ? "Criando…" : "Criar"}
            </Button>
          </div>
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
