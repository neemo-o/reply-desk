import { useEffect, useMemo, useRef, useState } from "react";
import {
  Smartphone,
  Plus,
  Loader2,
  QrCode,
  RefreshCw,
  LogOut,
  Trash2,
  Activity,
  ChevronRight,
  AlertTriangle,
  Hash,
  ShieldCheck,
  ShieldAlert,
  CircleCheck,
  CircleX,
  Clock,
  Info,
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
  useSessionLogs,
} from "@/hooks/use-whatsapp";
import { whatsappService } from "@/services/whatsapp-service";
import type {
  SessionEvent,
  SessionEventType,
  SessionStatus,
  WhatsappSession,
} from "@/types/whatsapp";
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

/** Conta sessões totais do tenant — 🔒 S23: limite agora conta TODAS, não
 *  apenas conectadas. */
function countTotalSessions(sessions: WhatsappSession[] | undefined): number {
  return sessions?.length ?? 0;
}

// Tradução legível dos tipos de evento de log de conexão.
const EVENT_LABEL: Record<SessionEventType, string> = {
  created: "Sessão criada",
  qrcode_pending: "QR Code gerado",
  connected: "Conectado",
  disconnected: "Desconectado",
  error: "Erro",
  logout: "Desconectado (manual)",
  deleted: "Sessão excluída",
};

const EVENT_ICON: Record<SessionEventType, typeof CircleCheck> = {
  created: Plus,
  qrcode_pending: QrCode,
  connected: CircleCheck,
  disconnected: CircleX,
  error: AlertTriangle,
  logout: LogOut,
  deleted: Trash2,
};

const EVENT_COLOR: Record<SessionEventType, string> = {
  created: "text-sky-600 dark:text-sky-400",
  qrcode_pending: "text-amber-600 dark:text-amber-400",
  connected: "text-emerald-600 dark:text-emerald-400",
  disconnected: "text-zinc-500",
  error: "text-red-600 dark:text-red-400",
  logout: "text-orange-600 dark:text-orange-400",
  deleted: "text-zinc-500",
};

// ─── página principal ───────────────────────────────────────────────

export function WhatsappPage() {
  const { data: sessions, isLoading } = useWhatsappSessions();
  const { role, tenant } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // 🔒 S23 — owner/admin vê tudo. agent só vê lista safe (status running/not running).
  const isManager = role === "owner" || role === "admin";

  const maxSessions = tenant?.subscription?.maxSessions ?? 0;
  const totalCount = countTotalSessions(sessions);
  const atLimit = maxSessions > 0 && totalCount >= maxSessions;

  // Quando a lista recarrega, se a sessão selecionada sumiu (foi deletada),
  // fechamos o sheet. Não auto-selecionamos nenhuma — a tabela é clicável.
  useEffect(() => {
    if (selectedId && sessions && !sessions.some((s) => s.id === selectedId)) {
      setSelectedId(null);
      setSheetOpen(false);
    }
  }, [sessions, selectedId]);

  const selected = useMemo(
    () => (sessions ? (sessions as WhatsappSession[]).find((s) => s.id === selectedId) ?? null : null) as WhatsappSession | null,
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
            {isManager
              ? "Conecte, monitore e gerencie suas sessões do WhatsApp em tempo real."
              : "Acompanhe o status das sessões de WhatsApp em uso pela sua equipe."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SessionLimitBadge
            total={totalCount}
            max={maxSessions}
            isLoading={isLoading}
          />
          {isManager && (
            <CreateSessionDialog
              disabled={atLimit}
              disabledReason={
                atLimit && maxSessions > 0
                  ? `Limite do plano atingido (${totalCount}/${maxSessions}). Exclua uma sessão ou faça upgrade para criar mais.`
                  : undefined
              }
            />
          )}
        </div>
      </div>

      {/* 🪧 Aviso para agentes: somente leitura */}
      {!isManager && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-300/50 bg-sky-50/50 p-3 text-sm text-sky-900 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Você é <strong>atendente</strong>. Apenas visualize o status das sessões — criar,
            reconectar ou excluir é restrito a <strong>donos e administradores</strong>.
          </span>
        </div>
      )}

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
              {isManager
                ? "Crie uma sessão para conectar um número do WhatsApp e começar a receber mensagens."
                : "Nenhuma sessão de WhatsApp configurada para este tenant."}
            </p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome da sessão</TableHead>
                {/* 🔒 S23 — phone só é relevante para owner/admin (agentes não vêem) */}
                {isManager && <TableHead>Número conectado</TableHead>}
                <TableHead className="w-[160px]">Status</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(sessions as WhatsappSession[]).map((s) => (
                <SessionTableRow
                  key={s.id}
                  session={s}
                  active={s.id === selectedId && sheetOpen}
                  onClick={() => openRow(s.id)}
                  showSensitive={isManager}
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
            <SessionDetail session={selected} canManage={isManager} />
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
  total,
  max,
  isLoading,
}: {
  total: number;
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
  const atLimit = total >= max;
  return (
    <Badge
      variant={atLimit ? "warning" : "outline"}
      className="h-8 gap-1.5 px-3 text-xs font-medium"
      title={
        atLimit
          ? "Limite do plano atingido — exclua uma sessão ou faça upgrade para criar mais"
          : `${total} de ${max} sessões criadas no plano`
      }
    >
      <Hash className="h-3.5 w-3.5" />
      <span className="tabular-nums">
        {total}/{max}
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
  showSensitive,
}: {
  session: WhatsappSession;
  active: boolean;
  onClick: () => void;
  showSensitive: boolean;
}) {
  return (
    <TableRow
      onClick={onClick}
      data-state={active ? "selected" : undefined}
      className={cn("cursor-pointer", active && "bg-secondary/60")}
    >
      <TableCell className="font-medium">{session.name}</TableCell>
      {showSensitive && (
        <TableCell className="text-muted-foreground">
          {session.phone ? (
            <span className="font-mono text-xs">{formatPhone(session.phone)}</span>
          ) : (
            <span className="text-muted-foreground/60">— sem número</span>
          )}
        </TableCell>
      )}
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

// ─── detalhe da sessão (QR + ações + logs de conexão) dentro do Sheet ─

function SessionDetail({
  session,
  canManage,
}: {
  session: WhatsappSession;
  canManage: boolean;
}) {
  // 🔒 S23 — Polling do QR só quando:
  //  - usuário é owner/admin (agentes não precisam de QR)
  //  - sessão está aguardando QR ou conectando
  const needsQr = canManage && (session.status === "qrcode_pending" || session.status === "connecting");
  const [qrState, setQrState] = useState<{
    connected: boolean;
    qrcode?: string;
    code?: string;
    pairingCode?: string;
  } | null>(null);
  // 🔒 S23 — Countdown de regeneração do QR Code. A Evolution regenera
  // o QR aproximadamente a cada 60s. Mostramos um contador regressivo
  // para o usuário saber quando o QR atual vai expirar.
  const [qrSecondsLeft, setQrSecondsLeft] = useState(60);

  useEffect(() => {
    setQrState(null);
    setQrSecondsLeft(60);
    if (!needsQr) return;
    let cancelled = false;
    let lastQrBase: string | undefined;
    const poll = async () => {
      while (!cancelled && needsQr) {
        try {
          const data = await whatsappService.getQr(session.id);
          if (cancelled) break;
          setQrState(data);
          // Reset countdown ao detectar QR novo
          if (data.qrcode && data.qrcode !== lastQrBase) {
            lastQrBase = data.qrcode;
            setQrSecondsLeft(60);
          }
          if (data.connected) break;
        } catch {
          // silent — retry no próximo tick
        }
        // Aguarda 2s entre polls. Cada poll decrementa o countdown.
        await new Promise((r) => setTimeout(r, 2000));
        setQrSecondsLeft((s) => Math.max(0, s - 2));
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
          {canManage
            ? "Detalhes e ações da sessão conectada via Evolution API."
            : "Status e última atividade da sessão."}
        </SheetDescription>
      </SheetHeader>

      {/* Corpo scrollável */}
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
        {/* Bloco de informações detalhadas */}
        <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-4">
          <DetailRow label="Nome de exibição" value={session.name} />
          {/* 🔒 S23 — phone visível só para owner/admin */}
          {canManage && (
            <DetailRow
              label="Número conectado"
              value={session.phone ? formatPhone(session.phone) : "— ainda não conectado"}
            />
          )}
          {canManage && (
            <DetailRow
              label="ID da sessão"
              value={session.sessionName}
              mono
              hint="Identificador único da instância na Evolution API"
            />
          )}
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

        {/* QR Code — só quando owner/admin E precisa */}
        {needsQr && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <QrCode className="h-4 w-4" />
              Escaneie o QR Code com o WhatsApp para conectar
            </div>

            {qrState?.connected ? (
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <CircleCheck className="h-4 w-4" /> Sessão conectada!
              </div>
            ) : qrState?.qrcode ? (
              <>
                <img
                  src={
                    qrState.qrcode.startsWith("data:")
                      ? qrState.qrcode
                      : `data:image/png;base64,${qrState.qrcode}`
                  }
                  alt="QR Code do WhatsApp"
                  className="h-56 w-56 rounded-lg border border-border bg-white p-2"
                />
                {/* 🔒 S23 — Countdown de regeneração do QR */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span className={cn("tabular-nums", qrSecondsLeft <= 10 && "text-amber-600 dark:text-amber-400")}>
                    QR renova em {qrSecondsLeft}s
                  </span>
                </div>
                {qrState.pairingCode && (
                  <p className="text-[11px] text-muted-foreground">
                    Ou use o código de pareamento:{" "}
                    <span className="font-mono font-semibold">{qrState.pairingCode}</span>
                  </p>
                )}
              </>
            ) : qrState?.code ? (
              <div className="rounded-lg border border-border bg-background p-4 text-center">
                <p className="text-xs text-muted-foreground">Código de pareamento</p>
                <p className="font-mono text-lg font-semibold">{qrState.code}</p>
              </div>
            ) : (
              <div className="flex h-56 w-56 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              O QR é buscado em tempo real na Evolution API e nunca é persistido no banco.
            </p>
          </div>
        )}

        {/* 🪵 S23 — Logs de CONEXÃO (substitui o inbox de mensagens) */}
        {canManage && <ConnectionLogsPanel sessionId={session.id} />}

        {/* 📋 Aviso para agente: sem permissão de ação */}
        {!canManage && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Você é atendente — apenas visualize o status. Para gerenciar
              (conectar, reconectar, excluir), peça ao dono ou admin.
            </span>
          </div>
        )}
      </div>

      {/* Rodapé: ações (🔒 S23 — só owner/admin) */}
      {canManage && (
        <SheetFooter className="flex-row flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reconnect.mutate(session.id)}
            disabled={reconnect.isPending || session.status === "connected"}
            title="Reconectar — gera um QR Code novo"
          >
            <RefreshCw className={cn("h-4 w-4", reconnect.isPending && "animate-spin")} />
            Reconectar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout.mutate(session.id)}
            disabled={logout.isPending || session.status === "qrcode_pending" || session.status === "connecting"}
            title="Desconectar — reseta a sessão e mostra QR Code novo (para trocar de número)"
          >
            <LogOut className="h-4 w-4" />
            Desconectar
          </Button>
          <DeleteSessionDialog
            sessionName={session.name}
            onConfirm={() => del.mutate(session.id)}
            isRemoving={del.isPending}
          />
        </SheetFooter>
      )}
    </>
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

// ─── 🪵 S23 — Painel de logs de CONEXÃO (substitui o InboxPanel) ────

function ConnectionLogsPanel({ sessionId }: { sessionId: string }) {
  const { data: events, isLoading } = useSessionLogs(sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para o topo quando novos eventos chegam (estão em ordem desc).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [events]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Logs de conexão</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        histórico de status e eventos de conexão da sessão · atualiza a cada 3s
      </p>
      <div ref={scrollRef} className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !events || events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum evento de conexão registrado ainda.
          </p>
        ) : (
          events.map((ev) => <ConnectionLogRow key={ev.id} event={ev} />)
        )}
      </div>
    </div>
  );
}

function ConnectionLogRow({ event }: { event: SessionEvent }) {
  const Icon = EVENT_ICON[event.type] ?? Info;
  const time = new Date(event.createdAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary", EVENT_COLOR[event.type])}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{EVENT_LABEL[event.type] ?? event.type}</p>
          <time className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{time}</time>
        </div>
        {event.message && (
          <p className="mt-1 break-words text-sm text-foreground/90">{event.message}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {event.statusCode != null && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              code {event.statusCode}
            </Badge>
          )}
          {event.phone && (
            <span className="font-mono text-[10px]">número {formatPhone(event.phone)}</span>
          )}
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      // 🔒 S23 — só enviamos `name`; o phone vem automaticamente do webhook
      await create.mutateAsync({ name });
      setName("");
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
            Crie a sessão na Evolution API. Após criar, escaneie o QR Code para
            conectar o número — o telefone é detectado automaticamente do celular
            que escanear.
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
            <p className="text-xs text-muted-foreground">
              Dica: dê um nome que identifique o uso desta sessão (ex.: “Suporte”, “Vendas”).
            </p>
          </div>
          {/* 🔒 S23 — Campo de telefone removido. O número é detectado
              automaticamente do celular que escanear o QR Code. */}
          <div className="flex items-start gap-2 rounded-md border border-sky-300/40 bg-sky-50/50 p-3 text-xs text-sky-900 dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-200">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              O número do WhatsApp conectado será capturado automaticamente
              quando o celular escanear o QR Code — não é preciso informá-lo aqui.
            </span>
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
            dados relevantes antes de prosseguir. Lembre-se: o limite de sessões do plano
            conta o TOTAL criado — excluir libera espaço para criar uma nova.
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
