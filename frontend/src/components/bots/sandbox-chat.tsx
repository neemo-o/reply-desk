import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useTestBot } from "@/hooks/use-bots";
import { cn } from "@/lib/utils";
import type { SandboxEvent, SandboxResult } from "@/types/bots";

const FINAL_STATUS_LABEL: Record<SandboxResult["finalStatus"], string> = {
  finished: "Finalizado",
  routed: "Encaminhado (handoff)",
  waiting: "Aguardando resposta",
  error: "Erro",
  offline: "Fora do horário",
  cooldown: "Em cooldown (12h)",
};

const FINAL_STATUS_BADGE: Record<
  SandboxResult["finalStatus"],
  "success" | "warning" | "secondary" | "destructive" | "outline"
> = {
  finished: "success",
  routed: "warning",
  waiting: "secondary",
  error: "destructive",
  offline: "outline",
  cooldown: "secondary",
};

/**
 * 🧪 SandboxChat — simula uma conversa real com o bot.
 *
 * Mantém o histórico de `userMessages` no estado e, a cada envio, chama o
 * endpoint batch `/bots/:id/test` com o array acumulado. O backend reexecuta
 * o fluxo do zero e devolve todos os eventos, que são renderizados como
 * balões (bot à esquerda, usuário à direita). Estado final exibido em badge.
 *
 * Comportamento pós-finalização: o input NÃO é travado quando a sessão do
 * bot acaba (finished/routed/cooldown). O usuário pode continuar enviando
 * mensagens simuladas para confirmar o silêncio do bot — o backend emite o
 * balão do usuário sem resposta do bot (cooldown de 12h no SIMPLE; sessão
 * encerrada no AGENTS).
 *
 * Observação: por ser batch, os balões do bot são re-renderizados a cada
 * envio (reexecução do fluxo). Não há persistência de sessão no backend.
 */
export function SandboxChat({
  botId,
  botName,
}: {
  botId: string;
  botName: string;
}) {
  const testBot = useTestBot();
  const [input, setInput] = useState("");
  const [userMessages, setUserMessages] = useState<string[]>([]);
  const [result, setResult] = useState<SandboxResult | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset ao trocar de bot.
  useEffect(() => {
    setUserMessages([]);
    setResult(null);
    setInput("");
  }, [botId]);

  // Auto-scroll para o fim ao chegar novos eventos.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [result?.events.length, testBot.isPending]);

  const events = result?.events ?? [];
  // O input nunca fica travado pelo status final — o usuário pode continuar
  // enviando mensagens para confirmar se o bot responde ou entra em cooldown.
  const disabled = testBot.isPending;

  function reset() {
    setUserMessages([]);
    setResult(null);
    setInput("");
  }

  function sendNext() {
    const text = input.trim();
    if (!text || disabled) return;
    const next = [...userMessages, text];
    setUserMessages(next);
    setInput("");
    testBot.mutate(
      { id: botId, payload: { userMessages: next } },
      { onSuccess: (r) => setResult(r) },
    );
  }

  function renderSandboxPayload(ev: SandboxEvent) {
    if (!ev.payload) return null;

    if (ev.type === "list" && ev.payload.listMessage) {
      const listMessage = ev.payload.listMessage as {
        title: string;
        footerText?: string;
        buttonText: string;
        sections: Array<{
          title: string;
          rows: Array<{ rowId: string; title: string; description?: string }>;
        }>;
      };
      return (
        <div className="rounded-xl border border-border bg-background/80 p-3 text-xs text-muted-foreground">
          <div className="mb-2 border-b border-border pb-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Lista interativa
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {listMessage.title}
            </p>
            {listMessage.footerText ? (
              <p className="text-[11px] text-muted-foreground">
                {listMessage.footerText}
              </p>
            ) : null}
          </div>
          <div className="space-y-3">
            {listMessage.sections.map((section, si) => (
              <div
                key={si}
                className="rounded-lg border border-border bg-slate-950/5 p-3"
              >
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {section.title}
                </p>
                <div className="space-y-2">
                  {section.rows.map((row) => (
                    <div
                      key={row.rowId}
                      className="rounded-lg bg-background px-3 py-2"
                    >
                      <p className="font-medium text-sm text-foreground">
                        {row.title}
                      </p>
                      {row.description ? (
                        <p className="text-[11px] text-muted-foreground">
                          {row.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        rowId: {row.rowId}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Botão: {listMessage.buttonText}
          </p>
        </div>
      );
    }

    if (ev.type === "buttons" && ev.payload.buttonsMessage) {
      const buttonsMessage = ev.payload.buttonsMessage as {
        title: string;
        footer?: string;
        buttons: Array<{ type: string; id?: string; displayText?: string }>;
      };
      return (
        <div className="rounded-xl border border-border bg-background/80 p-3 text-xs text-muted-foreground">
          <div className="mb-2 border-b border-border pb-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Botões interativos
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {buttonsMessage.title}
            </p>
            {buttonsMessage.footer ? (
              <p className="text-[11px] text-muted-foreground">
                {buttonsMessage.footer}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            {buttonsMessage.buttons.map((button, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-border bg-slate-950/5 px-3 py-2 text-sm"
              >
                <p className="font-medium text-foreground">
                  {button.displayText ?? ""}
                </p>
                {button.id ? (
                  <p className="text-[10px] text-muted-foreground">
                    id: {button.id}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (ev.type === "media") {
      const mediaPayload = ev.payload.mediaMessage ?? ev.payload.audioMessage;
      if (mediaPayload) {
        const media = mediaPayload as {
          mediatype?: string;
          media?: string;
          sticker?: string;
          audio?: string;
          caption?: string;
          fileName?: string;
        };
        return (
          <div className="rounded-xl border border-border bg-background/80 p-3 text-xs text-muted-foreground">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Mídia
            </p>
            <div className="mt-2 space-y-2 text-sm text-foreground">
              <p className="font-medium">
                Tipo: {media.mediatype ?? (media.sticker ? "sticker" : "audio")}
              </p>
              <p>URL: {media.media ?? media.sticker ?? media.audio ?? ""}</p>
              {media.caption ? <p>Caption: {media.caption}</p> : null}
              {media.fileName ? <p>Filename: {media.fileName}</p> : null}
            </div>
          </div>
        );
      }
    }

    return (
      <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950/10 p-2 text-[11px] text-muted-foreground">
        {JSON.stringify(ev.payload, null, 2)}
      </pre>
    );
  }

  return (
    <div className="flex h-full min-h-[28rem] flex-col rounded-xl border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{botName}</p>
          <p className="text-xs text-muted-foreground">
            Sandbox · simulação de conversa
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={reset}
          disabled={testBot.isPending || userMessages.length === 0}
        >
          <Play className="h-4 w-4" />
          {userMessages.length === 0 ? "Iniciar" : "Reiniciar"}
        </Button>
      </div>

      {/* Balões */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto bg-background/40 p-4"
      >
        {events.length === 0 && !testBot.isPending && (
          <p className="p-4 text-center text-sm text-muted-foreground">
            Digite a primeira mensagem para iniciar a simulação.
            <br />O gatilho do bot precisa casar com o texto.
          </p>
        )}

        {events.map((ev, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              ev.direction === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                ev.direction === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-secondary text-secondary-foreground rounded-bl-sm",
              )}
            >
              <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
                {ev.direction === "bot" ? "Bot" : "Você"}
              </p>
              <div className="space-y-2">
                <p className="whitespace-pre-wrap break-words">
                  {ev.text ?? ev.type}
                </p>
                {ev.payload && renderSandboxPayload(ev)}
              </div>
            </div>
          </div>
        ))}

        {/* Indicador "digitando" */}
        {testBot.isPending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-secondary px-3.5 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
            </div>
          </div>
        )}
        {/* Nota de silêncio: usuário enviou mas o bot não respondeu (cooldown / fim de sessão). */}
        {result &&
          !testBot.isPending &&
          events.length > 0 &&
          events[events.length - 1].direction === "user" &&
          (result.finalStatus === "cooldown" ||
            result.finalStatus === "finished" ||
            result.finalStatus === "routed") && (
            <p className="px-1 text-center text-xs text-muted-foreground/80">
              {result.finalStatus === "cooldown"
                ? "Bot em cooldown de 12h — não responderá até o prazo esgotar."
                : "Sessão do bot encerrada — ele não responderá a novas mensagens."}
            </p>
          )}
      </div>

      {/* Status final */}
      {result && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2">
          <Badge variant={FINAL_STATUS_BADGE[result.finalStatus]}>
            {FINAL_STATUS_LABEL[result.finalStatus]}
          </Badge>
          <span className="text-xs text-muted-foreground">
            steps visitados: {result.visitedSteps.join(", ") || "—"}
          </span>
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 border-t border-border p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              sendNext();
            }
          }}
          placeholder={
            result && result.finalStatus !== "waiting"
              ? "Continuar enviando (bot em silêncio)…"
              : "Digite a próxima mensagem…"
          }
          disabled={disabled}
          autoFocus
        />
        <Button
          size="icon"
          onClick={sendNext}
          disabled={disabled || !input.trim()}
          aria-label="Enviar"
        >
          {testBot.isPending ? (
            <RotateCcw className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
