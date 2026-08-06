import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useBots } from "@/hooks/use-bots";
import { SandboxChat } from "@/components/bots/sandbox-chat";
import type { Bot } from "@/types/bots";

/**
 * 🧪 SandboxPage — aba isolada na sidebar para testar um bot conversacional
 * (SIMPLE/AGENTS). AUTO não tem sandbox (dispara pelo scheduler, não via chat).
 */
export function SandboxPage() {
  const { data: bots, isLoading } = useBots();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Apenas bots conversacionais têm sandbox.
  const conversationalBots = useMemo(
    () => (bots ?? []).filter((b) => b.type === "SIMPLE" || b.type === "AGENTS"),
    [bots],
  );

  const selected: Bot | undefined = conversationalBots.find((b) => b.id === selectedId);

  return (
    <DashboardLayout>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FlaskConical className="h-6 w-6" />
            Sandbox
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Teste o fluxo de um bot simulando uma conversa real, mensagem por mensagem.
          </p>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : conversationalBots.length === 0 ? (
        <div className="py-20 text-center">
          <FlaskConical className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">
            Nenhum bot conversacional disponível para teste.
          </p>
          <p className="text-sm text-muted-foreground">
            Crie um bot do tipo Comum ou Agentes para usar o sandbox.
          </p>
        </div>
      ) : (
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="sandbox-bot-select"
              className="text-xs font-medium text-muted-foreground"
            >
              Bot
            </label>
            <select
              id="sandbox-bot-select"
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value || null)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="" disabled>
                Selecione um bot…
              </option>
              {conversationalBots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.type === "SIMPLE" ? "Comum" : "Agentes"}
                </option>
              ))}
            </select>
          </div>

          {selected ? (
            <SandboxChat botId={selected.id} botName={selected.name} />
          ) : (
            <div className="flex h-96 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              Escolha um bot acima para iniciar a simulação.
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
