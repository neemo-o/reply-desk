import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ChevronDown, Clock, MessageSquareWarning } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  useTenantSummary,
  useUpdateTenant,
  useTenantSettings,
  useUpdateTenantSettings,
} from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/auth-provider";
import { TransferOwnershipCard } from "@/components/dashboard/profile/transfer-ownership-card";
import type { TenantSummary } from "@/services/tenants-service";
import type { BusinessHours, BusinessHoursDay } from "@/types/bots";

type TenantLikeSettings = {
  businessHours?: BusinessHours | null;
  offlineMessage?: string | null;
  welcomeMessage?: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Dono",
  admin: "Administrador",
  agent: "Atendente",
};

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "UTC",
];

const LANGUAGES = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en-US", label: "English (US)" },
  { value: "es-ES", label: "Español (España)" },
];

const orgSchema = z.object({
  name: z.string().trim().min(2, "Nome deve ter ao menos 2 caracteres").max(120),
  slug: z
    .string()
    .trim()
    .min(2, "Slug deve ter ao menos 2 caracteres")
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Apenas letras minúsculas, números e hífens"),
  logo: z.string().trim().url("Informe uma URL válida").optional().or(z.literal("")),
  timezone: z.string().min(1),
  language: z.string().min(1),
});

type OrgFormValues = z.infer<typeof orgSchema>;

export function OrganizationCard() {
  const { tenant, role } = useAuth();
  const { data: summary, isLoading: isLoadingSummary } = useTenantSummary();
  const isOwner = role === "owner";
  const canManage = role === "owner" || role === "admin";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organização</CardTitle>
          <CardDescription>
            {isOwner
              ? "Edite os dados do seu workspace. Apenas o dono pode alterar."
              : "Dados do workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoadingSummary ? (
            <Skeleton className="h-16 w-full" />
          ) : isOwner ? (
            <OrganizationForm summary={summary} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-4">
              <div>
                <p className="font-medium">{summary?.name}</p>
                <p className="text-sm text-muted-foreground">/{summary?.slug}</p>
              </div>
              <Badge variant={tenant?.role === "owner" ? "success" : "secondary"}>
                {tenant ? ROLE_LABELS[tenant.role] ?? tenant.role : "—"}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && <BusinessHoursSettingsCard summary={summary} />}

      {canManage && <AutomaticMessagesCard summary={summary} />}

      {/* 🔒 M17 — Transferência de ownership — só o dono vê.
          Movido de members-page para a aba de configurações da organização,
          onde o dono gerencia aspectos sensíveis do workspace. */}
      {isOwner && <TransferOwnershipCard />}
    </div>
  );
}

function OrganizationForm({
  summary,
}: {
  summary: TenantSummary | null | undefined;
}) {
  const updateTenant = useUpdateTenant();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<OrgFormValues>({
    resolver: zodResolver(orgSchema),
    values: summary
      ? {
          name: summary.name,
          slug: summary.slug,
          logo: summary.logo ?? "",
          timezone: summary.timezone ?? "America/Sao_Paulo",
          language: summary.language ?? "pt-BR",
        }
      : undefined,
  });

  useEffect(() => {
    if (summary) {
      reset({
        name: summary.name,
        slug: summary.slug,
        logo: summary.logo ?? "",
        timezone: summary.timezone ?? "America/Sao_Paulo",
        language: summary.language ?? "pt-BR",
      });
    }
  }, [summary, reset]);

  async function onSubmit(values: OrgFormValues) {
    await updateTenant.mutateAsync({
      name: values.name,
      slug: values.slug,
      logo: values.logo || undefined,
      timezone: values.timezone,
      language: values.language,
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="org-name">Nome da organização</Label>
        <Input id="org-name" aria-invalid={Boolean(errors.name)} {...register("name")} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-slug">Slug</Label>
        <Input id="org-slug" aria-invalid={Boolean(errors.slug)} {...register("slug")} />
        {errors.slug && <p className="text-xs text-destructive">{errors.slug.message}</p>}
        <p className="text-xs text-muted-foreground">Usado na URL do workspace. Apenas letras minúsculas, números e hífens.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-logo">URL do logo</Label>
        <Input id="org-logo" placeholder="https://..." aria-invalid={Boolean(errors.logo)} {...register("logo")} />
        {errors.logo && <p className="text-xs text-destructive">{errors.logo.message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="org-timezone">Fuso horário</Label>
          <div className="relative">
            <select
              id="org-timezone"
              className="flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pe-9 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...register("timezone")}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="org-language">Idioma</Label>
          <div className="relative">
            <select
              id="org-language"
              className="flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pe-9 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...register("language")}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>

      <Button type="submit" disabled={updateTenant.isPending || !isDirty}>
        {updateTenant.isPending && <Loader2 className="animate-spin" />}
        Salvar alterações
      </Button>
    </form>
  );
}

// ─── Horário de atendimento ───────────────────────────────────────────

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

const hourMinuteRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

function emptyDays(): BusinessHoursDay[] {
  return ALL_DAYS.map((dayOfWeek) => ({ dayOfWeek, open: "09:00", close: "18:00" }));
}

function daysFromSummary(
  summary: { businessHours?: BusinessHours | null } | null | undefined,
): BusinessHoursDay[] {
  const days = summary?.businessHours?.days;
  if (!days || days.length === 0) return emptyDays();
  return ALL_DAYS.map((dayOfWeek) => {
    const found = days.find((d) => d.dayOfWeek === dayOfWeek);
    return found ?? { dayOfWeek, open: "09:00", close: "18:00" };
  });
}

function BusinessHoursSettingsCard({
  summary,
}: {
  summary: TenantLikeSettings | null | undefined;
}) {
  const { data: settings, isLoading } = useTenantSettings();
  const updateSettings = useUpdateTenantSettings();
  const [enabled, setEnabled] = useState<boolean>(
    Boolean(summary?.businessHours?.days?.length),
  );
  const [days, setDays] = useState<BusinessHoursDay[]>(daysFromSummary(summary));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDays(daysFromSummary(summary));
    setEnabled(Boolean(summary?.businessHours?.days?.length));
  }, [summary]);

  useEffect(() => {
    if (settings) {
      setDays(daysFromSummary(settings));
      setEnabled(Boolean(settings.businessHours?.days?.length));
    }
  }, [settings]);

  function updateDay(idx: number, patch: Partial<BusinessHoursDay>) {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function applyToAll(idx: number) {
    const ref = days[idx];
    setDays((prev) => prev.map((d) => ({ ...d, open: ref.open, close: ref.close })));
  }

  async function save() {
    setError(null);

    if (!enabled) {
      await updateSettings.mutateAsync({ businessHours: null });
      return;
    }

    const active = days.filter((d) => d.open && d.close);
    if (active.length === 0) {
      setError("Defina ao menos um dia com horário de funcionamento.");
      return;
    }
    for (const d of active) {
      if (!hourMinuteRegex.test(d.open)) {
        setError(`Horário de abertura inválido em ${DAY_LABELS[d.dayOfWeek]}: "${d.open}"`);
        return;
      }
      if (!hourMinuteRegex.test(d.close)) {
        setError(`Horário de fechamento inválido em ${DAY_LABELS[d.dayOfWeek]}: "${d.close}"`);
        return;
      }
    }

    await updateSettings.mutateAsync({
      businessHours: { days: active },
    });
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Horário de atendimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4" /> Horário de atendimento
        </CardTitle>
        <CardDescription>
          Horários em que a organização está disponível. Fora desses horários,
          os bots podem enviar a "mensagem fora do horário".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-input accent-foreground"
          />
          <span>Ativar horário de atendimento</span>
          {!enabled && (
            <span className="text-xs text-muted-foreground">
              (desativado = atendimento 24/7)
            </span>
          )}
        </label>

        {!enabled && (
          <p className="rounded-md border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
            Sem horário definido, todos os bots funcionam em regime 24/7 e a
            mensagem fora do horário <strong>não será verificada nem enviada</strong>.
          </p>
        )}

        {enabled && (
          <div className="space-y-2">
            <div className="grid grid-cols-[28px_1fr_1fr_64px] gap-2 text-xs font-medium text-muted-foreground">
              <span />
              <span>Abertura</span>
              <span>Fechamento</span>
              <span className="sr-only sm:not-sr-only">Copiar p/ todos</span>
            </div>
            {days.map((d, idx) => (
              <div
                key={d.dayOfWeek}
                className="grid grid-cols-[28px_1fr_1fr_64px] items-center gap-2"
              >
                <span className="text-sm font-medium">{DAY_LABELS[d.dayOfWeek]}</span>
                <Input
                  type="time"
                  value={d.open}
                  onChange={(e) => updateDay(idx, { open: e.target.value })}
                  className="h-9"
                />
                <Input
                  type="time"
                  value={d.close}
                  onChange={(e) => updateDay(idx, { close: e.target.value })}
                  className="h-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => applyToAll(idx)}
                  className="h-9 px-2 text-xs"
                  title="Aplicar este horário a todos os dias"
                >
                  Todos
                </Button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button onClick={save} disabled={updateSettings.isPending} size="sm">
          {updateSettings.isPending && <Loader2 className="animate-spin" />}
          Salvar horário
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Mensagens automáticas (fora do horário) ────────────────────────

const messageSchema = z.object({
  offlineMessage: z.string().trim().max(2000).optional().or(z.literal("")),
});

type MessageFormValues = z.infer<typeof messageSchema>;

function AutomaticMessagesCard({
  summary,
}: {
  summary: TenantLikeSettings | null | undefined;
}) {
  const updateSettings = useUpdateTenantSettings();
  const hasBusinessHours = Boolean(
    summary?.businessHours?.days && summary.businessHours.days.length > 0,
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<MessageFormValues>({
    resolver: zodResolver(messageSchema),
    values: {
      offlineMessage: summary?.offlineMessage ?? "",
    },
  });

  useEffect(() => {
    reset({
      offlineMessage: summary?.offlineMessage ?? "",
    });
  }, [summary, reset]);

  async function onSubmit(values: MessageFormValues) {
    await updateSettings.mutateAsync({
      offlineMessage: values.offlineMessage || null,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareWarning className="h-4 w-4" /> Mensagem fora do horário
        </CardTitle>
        <CardDescription>
          Resposta automática enviada quando o contato escreve fora do
          horário de atendimento da organização. Aplica-se apenas a bots do
          tipo Agentes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasBusinessHours && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
            Defina um horário de atendimento acima para que esta mensagem seja
            verificada e enviada.
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-offline">Mensagem fora do horário (opcional)</Label>
            <textarea
              id="org-offline"
              rows={3}
              placeholder="Responderemos no próximo horário de atendimento"
              {...register("offlineMessage")}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Bot comum (SIMPLE) não usa horário de atendimento, então esta
              mensagem nunca é enviada para ele. Vazia = não enviar nada.
            </p>
          </div>

          <Button type="submit" disabled={updateSettings.isPending || !isDirty} size="sm">
            {updateSettings.isPending && <Loader2 className="animate-spin" />}
            Salvar mensagem
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
