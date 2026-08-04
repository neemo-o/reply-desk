import { useMemo, useState } from "react";
import { Bot, Plus, Trash2, Edit } from "lucide-react";
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

export function BotsPage() {
  const { data: bots, isLoading } = useBots();
  const createBot = useCreateBot();
  const deleteBot = useDeleteBot();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<BotType>("AGENTS");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const conversational = useMemo(
    () => bots?.filter((b) => b.type === "SIMPLE" || b.type === "AGENTS") ?? [],
    [bots],
  );
  const broadcast = useMemo(() => bots?.filter((b) => b.type === "AUTO") ?? [], [bots]);

  function handleCreate() {
    if (!name.trim()) return;
    createBot.mutate({ name: name.trim(), type }, {
      onSuccess: (bot) => {
        setName("");
        setCreateOpen(false);
        if (bot.type === "AUTO") navigate(`/dashboard/broadcasts/${bot.id}`);
        else navigate(`/dashboard/bots/${bot.id}`);
      },
    });
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
        <Button onClick={() => setCreateOpen(true)} disabled={createBot.isPending}>
          <Plus className="h-4 w-4" />
          Novo Bot
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : bots && bots.length === 0 ? (
        <div className="py-20 text-center">
          <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">Nenhum bot criado ainda.</p>
          <p className="text-sm text-muted-foreground">Crie o seu primeiro bot acima.</p>
        </div>
      ) : (
        <>
          {conversational.length > 0 && (
            <>
              <h2 className="mb-3 mt-6 text-sm font-semibold uppercase text-muted-foreground/70">
                Conversacionais
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {conversational.map((bot) => (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    onClick={() => navigate(`/dashboard/bots/${bot.id}`)}
                    onDelete={() => setDeleteTarget(bot.id)}
                  />
                ))}
              </div>
            </>
          )}
          {broadcast.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {broadcast.map((bot) => (
                <BotCard
                  key={bot.id}
                  bot={bot}
                  onClick={() => navigate(`/dashboard/broadcasts/${bot.id}`)}
                  onDelete={() => setDeleteTarget(bot.id)}
                />
              ))}
            </div>
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
              <Input id="bname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Atendimento automático" />
            </div>
            <div>
              <Label>Tipo</Label>
              <select value={type} onChange={(e) => setType(e.target.value as BotType)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="AGENTS">Convencional (chatbot)</option>
                <option value="BROADCAST">Auto-mensagem (broadcast)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setCreateOpen(false)} variant="outline">Cancelar</Button>
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
                if (deleteTarget) deleteBot.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
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
  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className={cn("inline-block h-2.5 w-2.5 rounded-full shrink-0", STATUS_DOT[status])} />
            <div>
              <p className="font-semibold text-sm">{bot.name}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{TYPE_LABEL[bot.type as BotType]}</Badge>
                <span>{STATUS_LABEL[status] ?? status}</span>
              </div>
              {bot._count && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {bot.type === "AGENTS" ? `${bot._count.sessions} sessões ativas` : `${bot._count.broadcasts} campanhas`}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="-mr-1.5 h-7 w-7" onClick={(e) => { e.stopPropagation(); onClick(); }}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="-mr-1.5 h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}