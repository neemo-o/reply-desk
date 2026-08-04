import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Megaphone, Pause, Play, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageContentForm } from "@/components/bots/message-content-form";
import { useBot, useUpdateBot } from "@/hooks/use-bots";
import {
  useBroadcasts,
  useCreateBroadcast,
  usePauseBroadcast,
  useResumeBroadcast,
} from "@/hooks/use-broadcasts";
import { useContactLists } from "@/hooks/use-contact-lists";
import type { BroadcastRecurrence, BroadcastSchedule } from "@/types/bots";

const RECURRENCE_LABEL: Record<BroadcastRecurrence, string> = {
  ONCE: "Única vez",
  DAILY: "Diária",
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
};

const RECURRENCE_ORDER: BroadcastRecurrence[] = ["ONCE", "DAILY", "WEEKLY", "MONTHLY"];

const STATUS_LABEL: Record<BroadcastSchedule["status"], string> = {
  scheduled: "Agendado",
  running: "Em execução",
  completed: "Concluído",
  paused: "Pausado",
};

const STATUS_BADGE: Record<
  BroadcastSchedule["status"],
  "secondary" | "warning" | "success" | "outline"
> = {
  scheduled: "outline",
  running: "warning",
  completed: "success",
  paused: "secondary",
};

function defaultStartAt(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  // Formato aceito por <input type="datetime-local">
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function BroadcastEditorPage() {
  const { id } = useParams() as { id: string };
  const { data: bot, isLoading } = useBot(id);
  const navigate = useNavigate();

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
  if (bot.type !== "AUTO") {
    void navigate(`/dashboard/bots/${bot.id}`, { replace: true });
    return null;
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
        <Badge variant="outline" className="gap-1.5">
          <Megaphone className="h-3 w-3" /> Auto-mensagem
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="space-y-6">
          <BroadcastForm botId={bot.id} />
          <BroadcastList botId={bot.id} />
        </div>
        <ConfigSide botId={bot.id} botName={bot.name} />
      </div>
    </DashboardLayout>
  );
}

// ─── Form de disparo ─────────────────────────────────────────────────

function BroadcastForm({ botId }: { botId: string }) {
  const createBroadcast = useCreateBroadcast();
  const { data: contactLists, isLoading: listsLoading } = useContactLists();

  const [messageType, setMessageType] = useState<
    "text" | "list" | "buttons" | "media"
  >("text");
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [contactListId, setContactListId] = useState("");
  const [startAt, setStartAt] = useState(defaultStartAt());
  const [recurrence, setRecurrence] = useState<BroadcastRecurrence>("ONCE");

  const noLists = !listsLoading && (!contactLists || contactLists.length === 0);

  function submit() {
    if (!contactListId) {
      toast.error("Selecione uma lista de contatos.");
      return;
    }
    if (!startAt) {
      toast.error("Defina a data de início.");
      return;
    }
    if (Object.keys(content).length === 0) {
      toast.error("Preencha a mensagem antes de agendar.");
      return;
    }
    const iso = new Date(startAt).toISOString();
    createBroadcast.mutate(
      {
        botId,
        contactListId,
        mensagem: content,
        messageType,
        startAt: iso,
        recurrence,
      },
      {
        onSuccess: () => {
          setContent({});
          setContactListId("");
          setRecurrence("ONCE");
          setStartAt(defaultStartAt());
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h3 className="text-sm font-semibold">Novo agendamento</h3>

        <MessageContentForm
          type={messageType}
          onTypeChange={(t) => {
            // AUTO não suporta handoff
            if (t === "text" || t === "list" || t === "buttons" || t === "media") {
              setMessageType(t);
            }
          }}
          value={content}
          onChange={setContent}
          allowHandoff={false}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bc-list" className="text-xs">
              Lista de contatos
            </Label>
            <select
              id="bc-list"
              value={contactListId}
              onChange={(e) => setContactListId(e.target.value)}
              disabled={noLists}
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                {listsLoading
                  ? "Carregando…"
                  : noLists
                    ? "Nenhuma lista — crie uma em Contatos"
                    : "Selecione uma lista"}
              </option>
              {contactLists?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l._count?.items ?? 0} contatos)
                </option>
              ))}
            </select>
            {noLists && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Crie uma lista na página Contatos antes de agendar um broadcast.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bc-start" className="text-xs">
              Início
            </Label>
            <Input
              id="bc-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bc-rec" className="text-xs">
              Recorrência
            </Label>
            <select
              id="bc-rec"
              value={recurrence}
              onChange={(e) =>
                setRecurrence(e.target.value as BroadcastRecurrence)
              }
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {RECURRENCE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={createBroadcast.isPending}>
            <Send className="h-4 w-4" /> Agendar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Lista de agendamentos ───────────────────────────────────────────

function BroadcastList({ botId }: { botId: string }) {
  const { data: broadcasts, isLoading } = useBroadcasts();
  const pauseMut = usePauseBroadcast();
  const resumeMut = useResumeBroadcast();

  const items = useMemo(
    () => (broadcasts ?? []).filter((b) => b.botId === botId),
    [broadcasts, botId],
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-5">
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            Nenhum agendamento ainda. Crie o primeiro acima.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-2 p-5">
        <h3 className="mb-2 text-sm font-semibold">Agendamentos</h3>
        <ul className="space-y-2">
          {items.map((b) => (
            <li
              key={b.id}
              className="rounded-md border bg-secondary/30 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_BADGE[b.status]}>
                  {STATUS_LABEL[b.status]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(b.startAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {RECURRENCE_LABEL[b.recurrence]}
                </Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {b.sent}/{b.totalContacts}
                </span>
              </div>

              {(b.status === "running" || b.status === "scheduled") && (
                <div className="mt-2 flex justify-end gap-1">
                  {b.status === "running" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => pauseMut.mutate(b.id)}
                      disabled={pauseMut.isPending}
                    >
                      <Pause className="h-3.5 w-3.5" /> Pausar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => resumeMut.mutate(b.id)}
                      disabled={resumeMut.isPending}
                    >
                      <Play className="h-3.5 w-3.5" /> Retomar
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Configurações laterais (nome + testContactPhone + offlineMessage) ─

function ConfigSide({
  botId,
  botName,
}: {
  botId: string;
  botName: string;
}) {
  const [name, setName] = useState(botName);
  const updateBot = useUpdateBot();

  function saveName() {
    if (!name.trim() || name === botName) return;
    updateBot.mutate(
      { id: botId, name: name.trim() },
      { onSuccess: () => toast.success("Nome atualizado.") },
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="text-sm font-semibold">Detalhes</h3>
        <div className="space-y-1.5">
          <Label htmlFor="bc-name" className="text-xs">
            Nome do bot
          </Label>
          <Input
            id="bc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={saveName}
            disabled={updateBot.isPending || !name.trim() || name === botName}
          >
            <Save className="h-3.5 w-3.5" /> Salvar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Auto-mensagens respondem a <strong>todas as listas de contatos</strong>{" "}
          aos horários agendados. Não há steps nem gatilhos nesta página.
        </p>
      </CardContent>
    </Card>
  );
}
