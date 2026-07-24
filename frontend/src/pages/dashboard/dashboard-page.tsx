import { Bot, Building2, MessagesSquare } from "lucide-react";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-provider";

const placeholders = [
  { icon: MessagesSquare, title: "Conversas", value: "—", hint: "Em breve" },
  { icon: Bot, title: "Bots ativos", value: "—", hint: "Em breve" },
  { icon: Building2, title: "Empresas", value: "—", hint: "Em breve" },
];

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {user?.name?.split(" ")[0]} 👋</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aqui é onde você vai acompanhar seu atendimento no ReplyDesk.
        </p>
      </div>

      <Card className="mb-6 border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-500/15 to-cyan-accent/15 text-brand-500">
            <Bot className="h-5 w-5" />
          </div>
          <p className="font-display text-lg font-semibold">Dashboard em desenvolvimento</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            As funcionalidades de atendimento, bots e conversas chegam nas próximas versões.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {placeholders.map(({ icon: Icon, title, value, hint }) => (
          <Card key={title}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{value}</div>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
