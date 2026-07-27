import { useEffect, useRef, useState } from "react";
import {
  Smartphone,
  Plus,
  Loader2,
  QrCode,
  RefreshCw,
  LogOut,
  Trash2,
  MessageSquare,
  Inbox,
  ArrowDownLeft,
  ArrowUpRight,
  CircleDot,
} from "lucide-react";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useWhatsappSessions,
  useCreateWhatsappSession,
  useReconnectSession,
  useLogoutSession,
  useDeleteSession,
  useWhatsappInbox,
} from "@/hooks/use-whatsapp";
import { whatsappService } from "@/services/whatsapp-service";
import type { InboxMessage, SessionStatus, WhatsappSession } from "@/types/whatsapp";
import { cn } from "@/lib/utils";

// ─── status visual helpers ─────────────────────────────────────────

const STATUS_LABEL: Record<SessionStatus, string> = {
  connected: "Conectado",
  connecting: "Conectando…",
  disconnected: "Desconectado",
  qrcode_pending: "Aguardando QR",
};

const STATUS_BADGE: Record<SessionStatus, "success" | "warning" | "secondary" | "outline"> = {
  connected: "success",
  connecting: "warning",
  disconnected: "secondary",
  qrcode_pending: "warning",
};

function StatusDot({ status }: { status: SessionStatus }) {
  const color =
    status === "connected"
      ? "bg-emerald-500"
      : status === "qrcode_pending" || status === "connecting"
        ? "bg-amber-500 animate-pulse"
        : "bg-muted-foreground/60";
  return <span className={cn("inline-block h-2 w-2 rounded-full", color)} aria-hidden />;
}

// ─── página principal ───────────────────────────────────────────────

export function WhatsappPage() {
  const { data: sessions, isLoading } = useWhatsappSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-seleciona a primeira sessão quando a lista carrega.
  useEffect(() => {
    if (!selectedId && sessions && sessions.length > 0) {
      setSelectedId(sessions[0].id);
    }
    // Se a sessão selecionada sumiu da lista (foi deletada), limpa.
    if (selectedId && sessions && !sessions.some((s) => s.id === selectedId)) {
      setSelectedId(sessions[0]?.id ?? null);
    }
  }, [sessions, selectedId]);

  const selected = sessions?.find((s) => s.id === selectedId) ?? null;

  return (
    <DashboardLayout>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Smartphone className="h-6 w-6" />
            WhatsApp
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecte sessões do WhatsApp via Evolution API e acompanhe as mensagens recebidas em tempo real.
          </p>
        </div>
        <CreateSessionDialog />
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        {/* Coluna esquerda: lista de sessões */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80">
            Sessões
          </h2>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : !sessions || sessions.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <Smartphone className="h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">Nenhuma sessão ainda</p>
                <p className="max-w-[16rem] text-xs text-muted-foreground">
                  Crie uma sessão para conectar um número do WhatsApp e começar a receber mensagens.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <SessionListItem
                  key={s.id}
                  session={s}
                  active={s.id === selectedId}
                  onSelect={() => setSelectedId(s.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Coluna direita: detalhe da sessão selecionada */}
        <div>
          {selected ? (
            <SessionDetail session={selected} />
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">
                  Selecione uma sessão à esquerda para ver detalhes e mensagens.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

// ─── item da lista de sessões ──────────────────────────────────────

function SessionListItem({
  session,
  active,
  onSelect,
}: {
  session: WhatsappSession;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-primary/50 bg-secondary/60"
          : "border-border hover:bg-secondary/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{session.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {session.phone ?? "—"}
          </p>
        </div>
        <Badge variant={STATUS_BADGE[session.status]} className="shrink-0">
          <StatusDot status={session.status} />
          {STATUS_LABEL[session.status]}
        </Badge>
      </div>
    </button>
  );
}

// ─── detalhe da sessão (QR + ações + inbox) ─────────────────────────

function SessionDetail({ session }: { session: WhatsappSession }) {
  // Polling do QR só quando a sessão está aguardando QR ou conectando.
  const needsQr =
    session.status === "qrcode_pending" || session.status === "connecting";
  const [qr, setQr] = useState<{ connected: boolean; qrcode?: string; code?: string } | null>(null);

  useEffect(() => {
    setQr(null);
    if (!needsQr) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled && needsQr) {
        try {
          const data = await whatsappService.getQr(session.id);
          if (!cancelled) setQr(data);
          if (data.connected) break;
        } catch {
          /* silent — retry no próximo tick */
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [session.id, needsQr]);

  const reconnect = useReconnectSession();
  const logout = useLogoutSession();
  const del = useDeleteSession();

  return (
    <div className="space-y-6">
      {/* Cabeçalho + ações */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                {session.name}
                <Badge variant={STATUS_BADGE[session.status]}>
                  <StatusDot status={session.status} />
                  {STATUS_LABEL[session.status]}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                {session.phone ? `Número: ${session.phone}` : "Sem número conectado"}
                {" · "}
                <span className="font-mono text-[11px]">{session.sessionName}</span>
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => reconnect.mutate(session.id)}
                disabled={reconnect.isPending}
              >
                <RefreshCw className={cn("h-4 w-4", reconnect.isPending && "animate-spin")} />
                Reconectar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => logout.mutate(session.id)}
                disabled={logout.isPending || session.status === "disconnected"}
              >
                <LogOut className="h-4 w-4" />
                Desconectar
              </Button>
              <DeleteSessionDialog
                sessionName={session.name}
                onConfirm={() => del.mutate(session.id)}
                isRemoving={del.isPending}
              />
            </div>
          </div>
        </CardHeader>

        {/* QR Code — só quando precisa */}
        {needsQr && (
          <CardContent>
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <QrCode className="h-4 w-4" />
                Escaneie o QR Code com o WhatsApp para conectar
              </div>
              {qr?.connected ? (
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <CircleDot className="h-4 w-4" /> Sessão conectada!
                </div>
              ) : qr?.qrcode ? (
                <img
                  src={qr.qrcode.startsWith("data:")
                    ? qr.qrcode
                    : `data:image/png;base64,${qr.qrcode}`}
                  alt="QR Code do WhatsApp"
                  className="h-56 w-56 rounded-lg border border-border bg-white p-2"
                />
              ) : qr?.code ? (
                <div className="rounded-lg border border-border bg-background p-4 text-center">
                  <p className="text-xs text-muted-foreground">Código de pareamento</p>
                  <p className="font-mono text-lg font-semibold">{qr.code}</p>
                </div>
              ) : (
                <div className="flex h-56 w-56 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                O QR é atualizado automaticamente a cada poucos segundos.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Inbox temporário (log de mensagens) */}
      <InboxPanel sessionId={session.id} />
    </div>
  );
}

// ─── inbox temporário ───────────────────────────────────────────────

function InboxPanel({ sessionId }: { sessionId: string }) {
  const { data: messages, isLoading } = useWhatsappInbox(sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para o topo quando novas mensagens chegam (estão em ordem desc).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [messages]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Inbox className="h-5 w-5" />
          Caixa de entrada (log temporário)
        </CardTitle>
        <CardDescription>
          últimas {(messages ?? []).length} mensagens recebidas/enviadas · atualiza a cada 3s
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div ref={scrollRef} className="max-h-[420px] space-y-2 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !messages || messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma mensagem recebida ainda. Conecte a sessão e envie uma mensagem de teste.
            </p>
          ) : (
            messages.map((m) => <InboxRow key={m.id} message={m} />)
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InboxRow({ message }: { message: InboxMessage }) {
  const isOutbound = message.direction === "outbound";
  const Icon = isOutbound ? ArrowUpRight : ArrowDownLeft;
  const time = new Date(message.timestamp).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const contactName = message.conversation.contact.name ?? message.conversation.contact.phone;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3",
        isOutbound ? "border-primary/20 bg-primary/5" : "border-border bg-card",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isOutbound
            ? "bg-primary/15 text-primary"
            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{contactName}</p>
          <time className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{time}</time>
        </div>
        <p className="mt-1 break-words text-sm text-foreground/90">
          {message.content ?? `[${message.type}]`}
        </p>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {isOutbound ? "enviada" : "recebida"}
          </Badge>
          {message.status !== "delivered" && message.status !== "sent" && (
            <span className="text-amber-600 dark:text-amber-400">
              {message.status}
            </span>
          )}
          <span className="font-mono text-[10px]">
            {message.conversation.contact.phone}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── dialog: criar sessão ───────────────────────────────────────────

function CreateSessionDialog() {
  const create = useCreateWhatsappSession();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await create.mutateAsync({ name, phone: phone || undefined });
      setName("");
      setPhone("");
      setOpen(false);
    } catch {
      /* toast já tratado no hook */
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Nova sessão
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Nova sessão WhatsApp</AlertDialogTitle>
          <AlertDialogDescription>
            Crie a sessão na Evolution API. Após criar, escaneie o QR Code para conectar o número.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="session-name">Nome de exibição</Label>
            <Input
              id="session-name"
              placeholder="ex.: Atendimento comercial"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="session-phone">
              Número (opcional){" "}
              <span className="text-xs font-normal text-muted-foreground">
                — E.164, ex.: 5511999999999
              </span>
            </Label>
            <Input
              id="session-phone"
              placeholder="5511999999999"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              inputMode="tel"
            />
            <p className="text-xs text-muted-foreground">
              Pré-configurado na Evolution para pareamento por código. Você ainda pode escanear o QR.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending && <Loader2 className="animate-spin" />}
              Criar sessão
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── dialog: excluir sessão ─────────────────────────────────────────

function DeleteSessionDialog({
  sessionName,
  onConfirm,
  isRemoving,
}: {
  sessionName: string;
  onConfirm: () => void;
  isRemoving: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Excluir ${sessionName}`}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir sessão {sessionName}?</AlertDialogTitle>
          <AlertDialogDescription>
            A instância será removida da Evolution API permanentemente. As credenciais
            armazenadas serão destruídas. Esta ação é irreversível.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isRemoving}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isRemoving && <Loader2 className="animate-spin" />}
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
