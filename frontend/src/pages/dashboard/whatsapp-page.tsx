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
  Pencil,
  Save,
  X as XIcon,
  Search,
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
  useRenameSession,
  useSessionLogs,
} from "@/hooks/use-whatsapp";
import { useSessionQr } from "@/hooks/use-session-qr";
import { useBots } from "@/hooks/use-bots";
import { useConnectSession } from "@/hooks/use-session-settings";
import { SessionSettingsPanel } from "@/pages/dashboard/session-settings-panel";
import type {
  ContactFilterMode,
  SessionEvent,
  SessionEventType,
  SessionStatus,
  WhatsappSession,
} from "@/types/whatsapp";
import { CONTACT_FILTER_LABELS } from "@/types/whatsapp";
import { useAuth } from "@/contexts/auth-provider";
import { cn } from "@/lib/utils";

// ─── status visual helpers ─────────────────────────────────────────

const STATUS_LABEL: Record<SessionStatus, string> = {
  connected: "Conectado",
  connecting: "Conectando…",
  disconnected: "Desconectado",
  qrcode_pending: "Aguardando QR",
  // 🔒 S25 — Limite de tentativas de QR atingido; precisa reconectar.
  qr_expired: "QR expirado",
};

const STATUS_BADGE: Record<SessionStatus, "success" | "warning" | "secondary" | "outline" | "destructive"> = {
  connected: "success",
  connecting: "warning",
  disconnected: "secondary",
  qrcode_pending: "warning",
  qr_expired: "destructive",
};

function StatusDot({ status }: { status: SessionStatus }) {
  const color =
    status === "connected"
      ? "bg-emerald-500"
      : status === "qrcode_pending" || status === "connecting"
        ? "bg-amber-500 animate-pulse"
        : status === "qr_expired"
          ? "bg-red-500"
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
  updated: "Atualização",
};

const EVENT_ICON: Record<SessionEventType, typeof CircleCheck> = {
  created: Plus,
  qrcode_pending: QrCode,
  connected: CircleCheck,
  disconnected: CircleX,
  error: AlertTriangle,
  logout: LogOut,
  deleted: Trash2,
  updated: Info,
};

const EVENT_COLOR: Record<SessionEventType, string> = {
  created: "text-sky-600 dark:text-sky-400",
  qrcode_pending: "text-amber-600 dark:text-amber-400",
  connected: "text-emerald-600 dark:text-emerald-400",
  disconnected: "text-zinc-500",
  error: "text-red-600 dark:text-red-400",
  logout: "text-orange-600 dark:text-orange-400",
  deleted: "text-zinc-500",
  updated: "text-violet-600 dark:text-violet-400",
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
          {(() => {
            const display = formatPhoneWithProfile(session.phone, session.profileName);
            return display ? (
              <span className="font-mono text-xs">{display}</span>
            ) : (
              <span className="text-muted-foreground/60">— sem número</span>
            );
          })()}
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

/**
 * Renderiza o número conectado da sessão, opcionalmente com o nome do
 * perfil entre parênteses quando existir.
 *   - "75 9 1234-5678 (Empresa XY)"   → tem phone + profileName
 *   - "75 9 1234-5678"                  → só phone
 *   - undefined                         → sem phone
 */
function formatPhoneWithProfile(
  phone?: string | null,
  profileName?: string | null,
): string | undefined {
  if (!phone) return undefined;
  const formatted = formatPhone(phone);
  const trimmedName = profileName?.trim();
  return trimmedName && trimmedName.length > 0
    ? `${formatted} (${trimmedName})`
    : formatted;
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
  //  - sessão está aguardando QR
  // 🔒 S25 — Sessão em qr_expired NÃO entra em polling. O backend já
  // não gera QR; o frontend mostra mensagem + botão "Reconectar".
  // 🔒 S25-b — NÃO pollamos em `connecting`. Cada poll chama
  // /instance/connect na Evolution, que incrementa qrAttempts e pode
  // levar direto a qr_expired. Só habilitamos a polling quando o status
  // for exatamente `qrcode_pending` — estados intermediários (connecting,
  // em logout, etc) ficam de fora até o backend confirmar que há QR
  // pronto para ser exibido.
  const needsQr =
    canManage && session.status === "qrcode_pending";
  const qrExpired = session.status === "qr_expired";

  // 🤖 S24 — Verifica o status do bot vinculado à sessão para desabilitar a
  // reconexão (e conectar) quando o bot está inativo ou foi excluído. O
  // backend impede em /reconnect e /connect (ver assertLinkedBotReady), e
  // aqui refletimos no botão para guiar o usuário antes do clique.
  const { data: bots } = useBots();
  const linkedBot = bots?.find((b) => b.id === session.settings?.activeBotId);
  // Sem activeBotId OU bot excluído (onDelete:SetNull faz cair pra null) OU
  // bot exists mas status não é active/testing → bloqueia reconexão.
  const botBlocked =
    canManage &&
    (!linkedBot ||
      (linkedBot.status !== "active" && linkedBot.status !== "testing"));

  // 📱 Hook unificado para o QR Code — substitui o loop manual antigo.
  // Controla: polling, countdown, backoff em erro, parada automática em
  // estados terminais (connected/qrExpired).
  const {
    data: qrState,
    error: qrError,
    qrSecondsLeft,
  } = useSessionQr(session.id, needsQr);

  const reconnect = useReconnectSession();
  const logout = useLogoutSession();
  const del = useDeleteSession();
  const rename = useRenameSession();

  return (
    <>
      <SheetHeader>
        {/* 🔒 S24-b — Nome editável inline (só para owner/admin).
            Mantemos o Badge de status no canto pra UX não mudar. */}
        <SheetTitle className="flex flex-wrap items-center gap-2 pr-8">
          {canManage ? (
            <SessionRenameInline
              sessionId={session.id}
              currentName={session.name}
              onRename={(newName) => rename.mutate({ id: session.id, name: newName })}
              isPending={rename.isPending}
            />
          ) : (
            <span>{session.name}</span>
          )}
          <Badge variant={STATUS_BADGE[session.status]} className="gap-1.5">
            <StatusDot status={session.status} />
            {STATUS_LABEL[session.status]}
          </Badge>
        </SheetTitle>
        <SheetDescription>
          {canManage
            ? "Detalhes e ações da sessão WhatsApp conectada."
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
              value={
                formatPhoneWithProfile(session.phone, session.profileName)
                  ?? "— ainda não conectado"
              }
            />
          )}
          {canManage && (
            <DetailRow
              label="ID da sessão"
              value={session.sessionName}
              mono
              hint="Identificador único desta instância na plataforma"
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
            ) : qrError ? (
              // 🟠 Feedback de erro visível (antes era silencioso)
              <div className="flex flex-col items-center gap-2 text-sm text-destructive">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Erro ao buscar QR. Tentando novamente...
                </div>
                <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-border bg-muted/30">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              </div>
            ) : qrState?.qrcode ? (
              <>
                {/* key={qrcode.slice(-32)} força remontagem do <img> quando o
                    QR muda → libera memória de imagens antigas (BAIXO 14). */}
                <img
                  key={qrState.qrcode.slice(-32)}
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
            ) : session.status === "connecting" ? (
              // 🟠 Estado intermediário: job enfileirado mas instância ainda
              // não foi criada na Evolution. Mostra mensagem explicativa.
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-sky-600" />
                <p className="text-sm font-medium">Criando instância na Evolution...</p>
                <p className="text-xs text-muted-foreground">
                  Isto pode levar alguns segundos na primeira tentativa.
                </p>
              </div>
            ) : (
              <div className="flex h-56 w-56 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              O QR é buscado em tempo real na plataforma e nunca é persistido no banco.
            </p>
          </div>
        )}

        {/* 🤖 S24 — Bot vinculado inativo/excluído. Bloqueia reconexão porque
            o motor não vai responder mensagens. Mostramos um aviso claro e
            o botão "Reconectar" abaixo fica desabilitado. */}
        {botBlocked && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-red-300/50 bg-red-50/40 p-6 text-center dark:border-red-800/50 dark:bg-red-950/30">
            <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4" />
              Bot vinculado inativo
            </div>
            <p className="text-xs text-red-700/90 dark:text-red-300/90">
              {!session.settings?.activeBotId
                ? "Esta sessão não tem um bot vinculado. Selecione um bot publicado nas configurações da sessão antes de reconectar."
                : !linkedBot
                  ? "O bot vinculado a esta sessão foi excluído. Selecione outro bot nas configurações antes de reconectar."
                  : `O bot "${linkedBot.name}" está inativo (status: ${linkedBot.status}). Ative o bot (ou coloque em testing) antes de reconectar a sessão.`}
            </p>
          </div>
        )}

        {/* 🔒 S25 — Limite de tentativas de QR atingido. Mostramos uma
            mensagem clara e habilitamos o botão "Reconectar" (que já existe
            no rodapé — só precisamos deixar habilitado aqui). A UI também
            mostra quantas tentativas foram gastas para o usuário entender
            o que aconteceu. */}
        {qrExpired && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-red-300/50 bg-red-50/40 p-6 text-center dark:border-red-800/50 dark:bg-red-950/30">
            <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4" />
              Limite de tentativas de QR atingido
            </div>
            <p className="text-xs text-red-700/90 dark:text-red-300/90">
              O QR Code foi gerado{" "}
              <strong className="font-mono">
                {session.qrAttempts ?? qrState?.qrAttempts ?? 0}
              </strong>{" "}
              vez(es) sem nenhum escaneamento. Por segurança, paramos de
              gerar QR automaticamente para esta sessão.
            </p>
            <p className="text-[11px] text-red-700/70 dark:text-red-300/70">
              Clique em <strong>Reconectar</strong> abaixo para reiniciar
              e gerar um novo QR Code.
            </p>
          </div>
        )}

        {/* 🪵 S23 — Logs de CONEXÃO (substitui o inbox de mensagens) */}
        {canManage && <ConnectionLogsPanel sessionId={session.id} />}

        {/* 🔒 S24 — Configurações da sessão (bot ativo + filtro + listas) */}
        {canManage && <SessionSettingsPanel sessionId={session.id} canManage={canManage} />}

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
            // 🔒 S25-d — Botão "Reconectar" habilitado quando os QR Codes
            // param de ser gerados automaticamente. Isso só acontece em 2
            // estados:
            //  - qr_expired: atingiu o limite de 5 tentativas sem scan; o
            //    backend não gera mais QR. Reconectar zera qrAttempts e recria
            //    a instância na Evolution, voltando pra qrcode_pending.
            //  - disconnected: sessão desconectada e NENHUM QR está sendo
            //    gerado (porque o deleteInstance no logout removeu a
            //    instância da Evolution). Reconectar recria a instância e
            //    volta pra qrcode_pending/qrcode.
            // Em todos os outros estados (qrcode_pending, connecting,
            // connected) o botão fica desabilitado:
            //  - qrcode_pending/connecting: tem QR sendo gerado, ainda não
            //    faz sentido "reconectar" — espere expirar ou escaneie.
            //  - connected: já está conectado, nada a reconectar.
            disabled={
              reconnect.isPending ||
              botBlocked ||
              (session.status !== "qr_expired" &&
                session.status !== "disconnected")
            }
            title={
              botBlocked
                ? !session.settings?.activeBotId
                  ? "Reconectar bloqueado: nenhum bot vinculado a esta sessão"
                  : !linkedBot
                    ? "Reconectar bloqueado: o bot vinculado foi excluído"
                    : `Reconectar bloqueado: o bot "${linkedBot.name}" está inativo (${linkedBot.status})`
                : session.status === "qr_expired"
                  ? "Reconectar — zera o limite e gera um QR Code novo"
                  : session.status === "disconnected"
                    ? "Reconectar — recria a instância na Evolution e gera um QR Code novo"
                    : "Reconectar disponível apenas em QR expirado ou sessão desconectada"
            }
          >
            <RefreshCw className={cn("h-4 w-4", reconnect.isPending && "animate-spin")} />
            Reconectar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout.mutate(session.id)}
            // 🔒 S25-d — Desconectar só faz sentido quando há uma conexão
            // ativa: status === "connected". Antes o botão aparecia ativo
            // também em qr_expired ("desconectar algo que já está
            // desconectado"), o que confundia o usuário. Em todos os
            // outros estados (qrcode_pending, connecting, disconnected,
            // qr_expired) o botão fica desabilitado.
            disabled={
              logout.isPending ||
              session.status !== "connected"
            }
            title="Desconectar — remove a sessão do WhatsApp na Evolution e mostra QR Code novo (para trocar de número)"
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

/**
 * 🔒 S24-b — Nome de exibição da sessão editável inline. Aparece como
 * texto com botão "lápis" no estado padrão; clicar revela um Input + Save/Cancel.
 *
 * Re-sincroniza o estado local quando o `currentName` muda por outro
 * motivo (ex.: polling que puxou valor atualizado do backend).
 */
function SessionRenameInline({
  sessionId,
  currentName,
  onRename,
  isPending,
}: {
  sessionId: string;
  currentName: string;
  onRename: (newName: string) => void;
  isPending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentName);

  useEffect(() => {
    if (!editing) setDraft(currentName);
  }, [currentName, editing]);

  function startEdit() {
    setDraft(currentName);
    setEditing(true);
  }

  function cancel() {
    setDraft(currentName);
    setEditing(false);
  }

  function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === currentName) {
      cancel();
      return;
    }
    onRename(trimmed);
    setEditing(false);
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span>{currentName}</span>
        <button
          type="button"
          onClick={startEdit}
          aria-label={`Renomear sessão ${currentName}`}
          title="Renomear sessão"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        maxLength={80}
        disabled={isPending}
        // chave com sessionId força remontagem ao trocar de sessão,
        // evitando lixo do draft anterior.
        key={sessionId}
        className="h-7 max-w-[18rem] rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      />
      <button
        type="button"
        onClick={save}
        disabled={isPending || !draft.trim() || draft.trim() === currentName}
        aria-label="Salvar novo nome"
        title="Salvar (Enter)"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={isPending}
        aria-label="Cancelar"
        title="Cancelar (Esc)"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

// ─── 🪵 S23 — Painel de logs de CONEXÃO (substitui o InboxPanel) ────

function ConnectionLogsPanel({ sessionId }: { sessionId: string }) {
  const { data: events, isLoading } = useSessionLogs(sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SessionEventType | "all">("all");

  // Auto-scroll para o topo quando novos eventos chegam (estão em ordem desc).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    const q = query.trim().toLowerCase();
    return events.filter((ev) => {
      if (typeFilter !== "all" && ev.type !== typeFilter) return false;
      if (!q) return true;
      // Pesquisa case-insensitive em message, phone e statusCode.
      return (
        (ev.message?.toLowerCase().includes(q) ?? false) ||
        (ev.phone?.toLowerCase().includes(q) ?? false) ||
        (ev.statusCode != null && String(ev.statusCode).includes(q))
      );
    });
  }, [events, query, typeFilter]);

  const hasFilter = query.trim().length > 0 || typeFilter !== "all";

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Logs de conexão</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        histórico de status e eventos de conexão da sessão · atualiza a cada 3s
      </p>

      {/* 🔒 S24-b — Barra de filtro + pesquisa */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar por mensagem, número ou código…"
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as SessionEventType | "all")}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="all">Todos os tipos</option>
          {Object.entries(EVENT_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {hasFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setTypeFilter("all");
            }}
            className="h-8 gap-1 px-2 text-xs"
            title="Limpar filtros"
          >
            <XIcon className="h-3.5 w-3.5" />
            Limpar
          </Button>
        )}
      </div>

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
        ) : filteredEvents.length === 0 ? (
          <div className="space-y-1 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum evento corresponde aos filtros.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Total carregado: {events.length}
            </p>
          </div>
        ) : (
          filteredEvents.map((ev) => <ConnectionLogRow key={ev.id} event={ev} />)
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
  const connect = useConnectSession();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [activeBotId, setActiveBotId] = useState<string>("");
  const [contactFilterMode, setContactFilterMode] =
    useState<ContactFilterMode>("none");

  const { data: bots, isLoading: botsLoading } = useBots();

  // Reseta o formulário quando o dialog fecha
  useEffect(() => {
    if (open) return;
    setName("");
    setActiveBotId("");
    setContactFilterMode("none");
  }, [open]);

  const noActiveBots = !botsLoading && (!bots || bots.filter((b) => b.status === "active" || b.status === "testing").length === 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBotId) return;
    try {
      // 🔒 S24 — cria sessão sem enfileirar connect-session; o owner chama
      // POST /:id/connect (botão "Conectar") quando quiser o QR.
      const created = await create.mutateAsync({
        name,
        activeBotId,
        contactFilterMode,
      });
      // Já dispara o connect para já mostrar QR (UX similar ao fluxo antigo)
      try {
        await connect.mutateAsync(created.id);
      } catch {
        /* toast já tratado no hook; a sessão foi criada, o owner pode
           conectar pela tela de detalhes depois. */
      }
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
            Crie uma nova sessão WhatsApp. Após criar, escaneie o QR Code para
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
          {/* 🔒 S24 — Bot ativo obrigatório. Só lista bots ativos
              (status='active' | 'testing'). Se não houver nenhum, orientamos o owner. */}
          <div className="space-y-1.5">
            <Label htmlFor="session-bot">Bot ativo</Label>
            <select
              id="session-bot"
              value={activeBotId}
              onChange={(e) => setActiveBotId(e.target.value)}
              required
              disabled={!!noActiveBots}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                {botsLoading
                  ? "Carregando bots…"
                  : noActiveBots
                    ? "Nenhum bot ativo"
                    : "Selecione um bot ativo"}
              </option>
              {bots?.filter((b) => b.status === "active" || b.status === "testing").map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.status === "testing" ? " (teste)" : ""}
                </option>
              ))}
            </select>
            {noActiveBots && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Ative um bot antes de criar a sessão. Acesse a página de Bots,
                crie/edite e altere o status para "ativo" (ou "testing").
              </p>
            )}
          </div>
          {/* 🔒 S24 — Modo de filtro de contatos */}
          <div className="space-y-1.5">
            <Label htmlFor="session-filter">Filtro de contatos</Label>
            <select
              id="session-filter"
              value={contactFilterMode}
              onChange={(e) => setContactFilterMode(e.target.value as ContactFilterMode)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {Object.entries(CONTACT_FILTER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Pode ser ajustado depois nas configurações da sessão.
            </p>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-sky-300/40 bg-sky-50/50 p-3 text-xs text-sky-900 dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-200">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              O número do WhatsApp conectado será capturado automaticamente
              quando o celular escanear o QR Code — não é preciso informá-lo aqui.
            </span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              type="submit"
              disabled={create.isPending || connect.isPending || !name.trim() || !activeBotId}
            >
              {(create.isPending || connect.isPending) && <Loader2 className="animate-spin" />}
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
            A instância será removida permanentemente da plataforma. As credenciais
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
