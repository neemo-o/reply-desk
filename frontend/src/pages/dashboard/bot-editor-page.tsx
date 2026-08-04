import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Play } from "lucide-react";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  useBot,
  useCreateStep,
  useDeleteStep,
  useTestBot,
  useCreateTrigger,
} from "@/hooks/use-bots";
import { cn } from "@/lib/utils";

export function BotEditorPage() {
  const { id } = useParams() as { id: string };
  const { data: bot, isLoading } = useBot(id);
  const navigate = useNavigate();
  const createStep = useCreateStep();
  const deleteStep = useDeleteStep();
  const createTrigger = useCreateTrigger();
  const testBot = useTestBot();

  const [stepText, setStepText] = useState("");
  const [stepOrder, setStepOrder] = useState(1);
  const [triggerVal, setTriggerVal] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isLoading) {
    return <DashboardLayout><Skeleton className="h-96 rounded-xl" /></DashboardLayout>;
  }
  if (!bot) {
    return <DashboardLayout><p>Bot não encontrado.</p></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard/bots")}
          aria-label="Voltar">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{bot.name}</h1>
        <Badge variant={bot.type === "AUTO" ? "outline" : "secondary"}>
          {bot.type === "SIMPLE" ? "Comum" : bot.type === "AGENTS" ? "Agentes" : "Auto-mensagem"}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Editor */}
        <Card className="min-h-[48rem]">
          <CardContent className="p-6 space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold">Gatilhos</h3>
              <div className="flex gap-2">
                <span className="text-sm font-medium">Palavra-chave:</span>
                <Input placeholder="palavra-chave" value={triggerVal} onChange={(e) => setTriggerVal(e.target.value)} className="flex-1" />
                <Button size="sm" onClick={() => createTrigger.mutate({ botId: bot.id, payload: { tipo: "keyword", valor: triggerVal.trim() } }, { onSuccess: () => setTriggerVal("") })} disabled={!triggerVal.trim() || createTrigger.isPending}>
                  Adicionar
                </Button>
              </div>
            </section>

            <section className="border-t pt-4">
              <h3 className="mb-2 text-sm font-semibold">Steps</h3>
              {bot.steps && bot.steps.map((step) => (
                <div key={step.id} className="mb-2 flex items-center justify-between rounded-md border bg-secondary/30 px-3 py-2">
                  <div>
                    <span className="tabular-nums text-xs text-muted-foreground">#{step.ordem}</span>{" "}
                    <span className="text-sm font-medium">{step.tipoMensagem}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                    onClick={() => deleteStep.mutate({ botId: bot.id, stepId: step.id })}
                    aria-label="Remover step">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </section>

            <section className="border-t pt-4">
              <h3 className="mb-3 text-sm font-semibold">Novo Step</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input placeholder="Texto / conteúdo" value={stepText} onChange={(e) => setStepText(e.target.value)} />
                <Input type="number" placeholder="Ordem" value={stepOrder} onChange={(e) => setStepOrder(parseInt(e.target.value, 10) || 1)} />
                <Button onClick={() => createStep.mutate({ botId: bot.id, payload: { ordem: stepOrder, tipoMensagem: "text" as const, conteudo: { text: stepText.trim() } } }, { onSuccess: () => { setStepText(""); setStepOrder(stepOrder + 1); } })} disabled={!stepText.trim() || createStep.isPending}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar
                </Button>
              </div>
            </section>
          </CardContent>
        </Card>

        {/* Preview / Sandbox */}
        <Card className="min-h-[48rem] flex flex-col">
          <CardContent className="p-6 space-y-4 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Prévia / Sandbox</h3>
              <Button size="sm" variant="outline" onClick={() => { testBot.mutate({ id: bot.id, payload: { startMessage: "teste" } }, { onSuccess: () => setSheetOpen(true) }); }} disabled={testBot.isPending}>
                <Play className="h-4 w-4 mr-1" />{testBot.isPending ? "Executando..." : "Testar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Simule uma interação para ver como o bot funciona.</p>

            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetContent side="bottom" className="h-1/2">
                <SheetHeader>
                  <SheetTitle>Resultado do Sandbox</SheetTitle>
                </SheetHeader>
                <div className="space-y-2 overflow-y-auto h-[calc(100%-4rem)] p-1">
                  {testBot.data ? (
                    testBot.data.events.map((ev, i) => (
                      <div key={i} className={cn("mb-1 max-w-[85%] rounded-xl px-3 py-2 text-sm", ev.direction === "user" ? "ml-auto bg-primary text-primary-foreground rounded-br-sm" : "mr-auto bg-white text-foreground rounded-bl-sm")}>
                        <p className="text-xs font-medium opacity-80">{ev.direction === "bot" ? "Bot" : "Você"}</p>
                        <p>{ev.text ?? ev.type}</p>
                        <span className="text-[10px] opacity-50">{ev.type}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum resultado ainda. Execute o teste para ver o fluxo.</p>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}