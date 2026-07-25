import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserPlus, Loader2, Trash2, Users } from "lucide-react";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/contexts/auth-provider";
import { useTenantMembers, useInviteMember, useRemoveMember, useUpdateMemberRole } from "@/hooks/use-tenant";
import type { TenantRole } from "@/types/auth";

const ROLE_LABELS: Record<string, string> = {
  owner: "Dono",
  admin: "Administrador",
  agent: "Atendente",
};

const ROLE_BADGE_VARIANT: Record<string, "success" | "secondary" | "outline"> = {
  owner: "success",
  admin: "secondary",
  agent: "outline",
};

const inviteSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  roleName: z.enum(["admin", "agent"]),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

export function MembersPage() {
  const { role: actingRole, user } = useAuth();
  const { data: members, isLoading } = useTenantMembers();
  const removeMember = useRemoveMember();

  const isOwner = actingRole === "owner";
  const isAdmin = actingRole === "admin";
  const canManage = isOwner || isAdmin;

  // Agent não tem acesso à gestão de membros.
  if (!canManage) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
          <Users className="h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Acesso restrito</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Apenas owners e administradores podem gerenciar membros da organização.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Users className="h-6 w-6" />
            Membros
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gerencie quem tem acesso à sua organização e qual o papel de cada um.
          </p>
        </div>
        {canManage && <InviteMemberDialog />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pessoas na organização</CardTitle>
          <CardDescription>
            {members?.length ?? 0} membro(s) ativo(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {members?.map((member) => {
                const isSelf = member.user.id === user?.id;
                const memberRole = member.role.name as TenantRole;
                const canRemove =
                  canManage &&
                  !isSelf &&
                  // Admin não remove owner/admin
                  !(isAdmin && (memberRole === "owner" || memberRole === "admin"));
                const canChangeRole =
                  canManage &&
                  !isSelf &&
                  // Admin não altera role de owner/admin
                  !(isAdmin && (memberRole === "owner" || memberRole === "admin"));

                return (
                  <div
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {member.user.name}
                        {isSelf && (
                          <span className="ml-2 text-xs text-muted-foreground">(você)</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Role selector — só aparece para quem pode mudar */}
                      {canChangeRole ? (
                        <RoleSelect
                          memberId={member.id}
                          currentRole={memberRole}
                          isOwner={isOwner}
                        />
                      ) : (
                        <Badge variant={ROLE_BADGE_VARIANT[memberRole] ?? "outline"}>
                          {ROLE_LABELS[memberRole] ?? memberRole}
                        </Badge>
                      )}
                      {canRemove && (
                        <RemoveMemberDialog
                          memberName={member.user.name}
                          onConfirm={() => removeMember.mutate(member.id)}
                          isRemoving={removeMember.isPending}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              {members?.length === 0 && (
                <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum membro encontrado.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}

function InviteMemberDialog() {
  const inviteMember = useInviteMember();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", roleName: "agent" },
  });

  async function onSubmit(values: InviteFormValues) {
    try {
      await inviteMember.mutateAsync(values);
      reset();
      setOpen(false);
    } catch {
      // onError do hook já exibe toast
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4" />
          Convidar membro
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Convidar membro</AlertDialogTitle>
          <AlertDialogDescription>
            O usuário precisa já ter uma conta no ReplyDesk com este e-mail.
            Se ainda não tem, peça para ele se cadastrar primeiro.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">E-mail</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="nome@empresa.com"
              autoComplete="off"
              aria-invalid={Boolean(errors.email)}
              {...register("email")}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Papel</Label>
            <select
              id="invite-role"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...register("roleName")}
            >
              <option value="agent">Atendente</option>
              <option value="admin">Administrador</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Owners só podem ser adicionados pela tela de gestão de roles.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={inviteMember.isPending}>
              {inviteMember.isPending && <Loader2 className="animate-spin" />}
              Convidar
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RoleSelect({
  memberId,
  currentRole,
  isOwner,
}: {
  memberId: string;
  currentRole: TenantRole;
  isOwner: boolean;
}) {
  const updateMemberRole = useUpdateMemberRole();

  // Owner pode promover a qualquer role; admin só entre admin/agent (já filtrado no pai)
  const options: TenantRole[] = isOwner
    ? ["owner", "admin", "agent"]
    : ["admin", "agent"];

  return (
    <select
      className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={currentRole}
      disabled={updateMemberRole.isPending}
      onChange={(e) => {
        const newName = e.target.value as TenantRole;
        if (newName !== currentRole) {
          updateMemberRole.mutate({ memberId, roleName: newName });
        }
      }}
    >
      {options.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

function RemoveMemberDialog({
  memberName,
  onConfirm,
  isRemoving,
}: {
  memberName: string;
  onConfirm: () => void;
  isRemoving: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Remover ${memberName}`}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover {memberName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação remove o membro da organização. Ele perde acesso imediatamente,
            mas pode ser convidado novamente no futuro.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isRemoving}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isRemoving && <Loader2 className="animate-spin" />}
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
