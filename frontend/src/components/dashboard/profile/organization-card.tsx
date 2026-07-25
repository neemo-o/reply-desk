import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTenantSummary, useUpdateTenant } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/auth-provider";
import type { TenantSummary } from "@/services/tenants-service";

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

  return (
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
          <select
            id="org-timezone"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...register("timezone")}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="org-language">Idioma</Label>
          <select
            id="org-language"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...register("language")}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Button type="submit" disabled={updateTenant.isPending || !isDirty}>
        {updateTenant.isPending && <Loader2 className="animate-spin" />}
        Salvar alterações
      </Button>
    </form>
  );
}
