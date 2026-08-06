import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { useProfile } from "@/hooks/use-profile";
import { usersService } from "@/services/users-service";

const accountSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome completo").max(120),
  avatar: z.string().trim().url("Informe uma URL válida").optional().or(z.literal("")),
});

type AccountFormValues = z.infer<typeof accountSchema>;

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function AccountCard() {
  const { data: profile, isLoading } = useProfile();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    values: profile ? { name: profile.name, avatar: profile.avatar ?? "" } : undefined,
  });

  const avatarPreview = watch("avatar");

  useEffect(() => {
    if (profile) reset({ name: profile.name, avatar: profile.avatar ?? "" });
  }, [profile, reset]);

  async function onSubmit(values: AccountFormValues) {
    try {
      const updated = await usersService.updateMe({
        name: values.name,
        avatar: values.avatar || undefined,
      });
      queryClient.setQueryData(["users", "me"], updated);
      toast.success("Perfil atualizado com sucesso");
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Não foi possível atualizar seu perfil"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCircle className="h-4 w-4" /> Minha conta
        </CardTitle>
        <CardDescription>Dados usados para identificar você no ReplyDesk.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={avatarPreview || undefined} alt={profile?.name} />
                <AvatarFallback className="text-lg">{profile ? initials(profile.name) : ""}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="avatar">URL do avatar</Label>
                <Input id="avatar" placeholder="https://..." aria-invalid={Boolean(errors.avatar)} {...register("avatar")} />
                {errors.avatar && <p className="text-xs text-destructive">{errors.avatar.message}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" aria-invalid={Boolean(errors.name)} {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" value={profile?.email ?? ""} disabled readOnly />
              <p className="text-xs text-muted-foreground">O e-mail não pode ser alterado por aqui.</p>
            </div>

            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              Salvar alterações
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
