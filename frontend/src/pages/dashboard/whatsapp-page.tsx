import { useEffect, useMemo, useRef, useState } from "react";
import {
  Smartphone,
  Plus,
  Loader2,
  QrCode,
  RefreshCw,
  LogOut,
  Trash2,
  Inbox,
  ArrowDownLeft,
  ArrowUpRight,
  CircleDot,
  ChevronRight,
  AlertTriangle,
  Hash,
} from "lucide-react";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
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
import { useAuth } from "@/contexts/auth-provider";
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

/** Conta sessões "ativas" — tudo exceto desconectadas (mesmo critério do backend). */
function countActiveSessions(sessions: WhatsappSession[] | undefined): number {
  if (!sessions) return 0;
  return sessions.filter((s) => s.status !== "disconnected").length;
}

// ─── página principal ───────────────────────────────────────────────

export function WhatsappPage() {
  const { data: sessions, isLoading } = useWhatsappSessions();
  const { tenant } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const maxSessions = tenant?.subscription?.maxSessions ?? 0;
  const activeCount = countActiveSessions(sessions);
  const atLimit = maxSessions > 0 && activeCount >= maxSessions;

  // Quando a lista recarrega, se a sessão selecionada sumiu (foi deletada),
  // fechamos o sheet. Não auto-selecionamos nenhuma — a tabela é clicável.
  useEffect(() => {
    if (selectedId && sessions && !sessions.some((s) => s.id === selectedId)) {
      setSelectedId(null);
      setSheetOpen(false);
    }
  }, [sessions, selectedId]);

  const selected = useMemo(
    () => (sessions ? sessions.find((s) => s.id === selectedId) ?? null : null),
    [sessions, selectedId],
  );

  function openRow(id: string) {
    setSelectedId(id);
    setSheetOpen(true);
  }

  return (
    <DashboardLayout>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Smartphone className="h-6 w-6" />
            Sessões
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecte e monitore suas sessões do Whatsapp em tempo real
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SessionLimitBadge
            active={activeCount}
            max={maxSessions}
            isLoading={isLoading}
          />
          <CreateSessionDialog
            disabled={atLimit}
            disabledReason={
              atLimit && maxSessions > 0
                ? `Limite do plano atingido (${activeCount}/${maxSessions}). Faça upgrade para criar mais sessões.`
                : undefined
            }
          />
        </div>
      </div>

      {/* Tabela de sessões */}
      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !sessions || sessions.length === 0 ? (
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Smartphone className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">Nenhuma sessão ainda</p>
            <p className="max-w-[20rem] text-xs text-muted-foreground">
              Crie uma sessão para conectar um número do WhatsApp e começar a receber mensagens.
            </p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome da sessão</TableHead>
                <TableHead>Número / Contato</TableHead>
                <TableHead>ID da sessão</TableHead>
                <TableHead className="w-[160px]">Status</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <SessionTableRow
                  key={s.id}
                  session={s}
                  active={s.id === selectedId && sheetOpen}
                  onClick={() => openRow(s.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Drawer lateral direito: detalhes da sessão */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(o) => {
          setSheetOpen(o);
          if (!o) setSelectedId(null);
        }}
      >
        <SheetContent side="right" className="flex flex-col gap-0 p-0">
          {selected ? (
            <SessionDetail session={selected} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              Nenhuma sessão selecionada.
            </div>
          )}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}

// ─── badge de limite (x / max) ──────────────────────────────────────

function SessionLimitBadge({
  active,
  max,
  isLoading,
}: {
  active: number;
  max: number;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-8 w-24 rounded-full" />;
  }
  if (max <= 0) {
    // Sem plano/limite conhecido — não exibe nada para não confundir.
    return null;
  }
  const atLimit = active >= max;
  return (
    <Badge
      variant={atLimit ? "warning" : "outline"}
      className="h-8 gap-1.5 px-3 text-xs font-medium"
      title={
        atLimit
          ? "Limite do plano atingido — faça upgrade para criar mais sessões"
          : `${active} de ${max} sessões ativas no plano`
      }
    >
      <Hash className="h-3.5 w-3.5" />
      <span className="tabular-nums">
        {active}/{max}
      </span>{" "}
      sessões
    </Badge>
  );
}

// ─── linha da tabela de sessões ──────────────────────────────────────

function SessionTableRow({
  session,
  active,
  onClick,
}: {
  session: WhatsappSession;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <TableRow
      onClick={onClick}
      data-state={active ? "selected" : undefined}
      className={cn(
        "cursor-pointer",
        active && "bg-secondary/60",
      )}
    >
      <TableCell className="font-medium">{session.name}</TableCell>
      <TableCell className="text-muted-foreground">
        {session.phone ? (
          <span className="font-mono text-xs">{formatPhone(session.phone)}</span>
        ) : (
          <span className="text-muted-foreground/60">— sem número</span>
        )}
      </TableCell>
      <TableCell>
        <span className="font-mono text-[11px] text-muted-foreground">{session.sessionName}</span>
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE[session.status]} className="gap-1.5">
          <StatusDot status={session.status} />
          {STATUS_LABEL[session.status]}
        </Badge>
      </TableCell>
      <TableCell className="pr-3">
        <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
      </TableCell>
    </TableRow>
  );
}

/** Formata número E.164 para exibição amigável: 5511999999999 → +55 11 99999-9999 */
function formatPhone(phone: string): string {
  // E.164 sem "+": tenta liberar DDI+DDD+numero. Mantém simples.
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 12) {
    const ddi = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const partA = digits.slice(4, digits.length - 4);
    const partB = digits.slice(-4);
    return `+${ddi} ${ddd} ${partA}-${partB}`;
  }
  if (digits.length >= 10) {
    const partA = digits.slice(0, digits.length - 4);
    const partB = digits.slice(-4);
    return `${partA}-${partB}`;
  }
  return phone;
}

// ─── detalhe da sessão (QR + ações + inbox) dentro do Sheet ─────────

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
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 pr-8">
          {session.name}
          <Badge variant={STATUS_BADGE[session.status]} className="gap-1.5">
            <StatusDot status={session.status} />
            {STATUS_LABEL[session.status]}
          </Badge>
        </SheetTitle>
        <SheetDescription>
          Detalhes e ações da sessão conectada via Evolution API.
        </SheetDescription>
      </SheetHeader>

      {/* Corpo scrollável */}
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
        {/* Bloco de informações detalhadas */}
        <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-4">
          <DetailRow label="Nome de exibição" value={session.name} />
          <DetailRow
            label="Número conectado"
            value={session.phone ? formatPhone(session.phone) : "— sem número"}
          />
          <DetailRow
            label="ID da sessão"
            value={session.sessionName}
            mono
            hint="Identificador único da instância na Evolution API"
          />
          <DetailRow
            label="Última atividade"
            value={
              session.lastSeen
                ? new Date(session.lastSeen).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"
            }
          />
          <DetailRow
            label="Criada em"
            value={new Date(session.createdAt).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          />
        </div>

        {/* QR Code — só quando precisa */}
        {needsQr && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-6">
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
                src={qr.qrcode.startsWith("data:") ? qr.qrcode : `data:image/png;base64,${qr.qrcode}`}
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
        )}

        {/* Inbox temporário (log de mensagens) */}
        <InboxPanel sessionId={session.id} />
      </div>

      {/* Rodapé: ações */}
      <SheetFooter className="flex-row flex-wrap gap-2">
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
        <ConnectButton sessionId={session.id} sessionName={session.name} status={session.status} />
        <DeleteSessionDialog
          sessionName={session.name}
          onConfirm={() => del.mutate(session.id)}
          isRemoving={del.isPending}
        />
      </SheetFooter>
    </>
  );
}

/** Botão "Conectar" — só relevante quando desconectada; força novo poll de QR. */
function ConnectButton({
  sessionId,
  sessionName,
  status,
}: {
  sessionId: string;
  sessionName: string;
  status: SessionStatus;
}) {
  // Conectar == reconectar no endpoint atual. Mantemos rótulo distinto por clareza.
  const reconnect = useReconnectSession();
  const isConnecting = status === "connecting" || status === "qrcode_pending";
  return (
    <Button
      variant="default"
      size="sm"
      onClick={() => reconnect.mutate(sessionId)}
      disabled={reconnect.isPending || status === "connected" || isConnecting}
      title={status === "connected" ? "Já conectada" : `Iniciar conexão de ${sessionName}`}
    >
      <Plus className="h-4 w-4" />
      Conectar
    </Button>
  );
}

function DetailRow({
  label,
  value,
  mono,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
        {label}
      </dt>
      <dd className={cn("text-sm text-foreground/90 sm:text-right", mono && "font-mono text-xs")}>
        {value}
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground/70">{hint}</p>}
      </dd>
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
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Inbox className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Caixa de entrada (log temporário)</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        últimas {(messages ?? []).length} mensagens recebidas/enviadas · atualiza a cada 3s
      </p>
      <div ref={scrollRef} className="max-h-[320px] space-y-2 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !messages || messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma mensagem recebida ainda. Conecte a sessão e envie uma mensagem de teste.
          </p>
        ) : (
          messages.map((m) => <InboxRow key={m.id} message={m} />)
        )}
      </div>
    </div>
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
            <span className="text-amber-600 dark:text-amber-400">{message.status}</span>
          )}
          <span className="font-mono text-[10px]">{message.conversation.contact.phone}</span>
        </div>
      </div>
    </div>
  );
}

// ─── dialog: criar sessão ───────────────────────────────────────────

function CreateSessionDialog({
  disabled,
  disabledReason,
}: {
  disabled?: boolean;
  disabledReason?: string;
}) {
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
        <Button disabled={disabled} title={disabledReason}>
          <Plus className="h-4 w-4" />
          Nova sessão
        </Button>
      </AlertDialogTrigger>

      {disabled && disabledReason && !open && (
        <p className="sr-only">{disabledReason}</p>
      )}

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
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Excluir ${sessionName}`}
          className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          Excluir
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
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            As conversas e mensagens associadas também serão removidas (cascade). Exporte
            dados relevantes antes de prosseguir.
          </span>
        </div>
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
