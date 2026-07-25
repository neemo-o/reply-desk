import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserPlus, Loader2, Trash2, Users, MailOpen, X, ShieldAlert } from "lucide-react";
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
import {
  useTenantMembers,
  useTenantInvitations,
  useInviteMember,
  useRemoveMember,
  useCancelInvitation,
  useUpdateMemberRole,
  useTransferOwnership,
  useTenantSummary,
} from "@/hooks/use-tenant";
import { useSubscription } from "@/hooks/use-subscription";
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
  const { data: subscription } = useSubscription();
  const removeMember = useRemoveMember();

  const isOwner = actingRole === "owner";
  const isAdmin = actingRole === "admin";
  const canManage = isOwner || isAdmin;

  // 🔒 Limite de usuários do plano ativo — usado para mostrar a contagem
  // "X de Y membros ativos" e avisar quando atinge o limite (bloqueia convites).
  // O backend já valida em assertCanInviteUser; aqui só refletimos na UI.
  const maxUsers = subscription?.plan?.maxUsers ?? null;
  const activeCount = members?.length ?? 0;
  const atLimit = maxUsers !== null && activeCount >= maxUsers;

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
        {canManage && (
          <InviteMemberDialog
            atLimit={atLimit}
            maxUsers={maxUsers}
            activeCount={activeCount}
          />
        )}
      </div>

      <div className="space-y-6">
        <PendingInvitations />

        {/* 🔒 Aviso de limite atingido — bloqueia novos convites. Oferece
            link para upgrade do plano (só owner/admin vê este card). */}
        {atLimit && canManage && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <div>
              <p className="font-medium text-amber-600 dark:text-amber-400">
                Limite de usuários atingido
              </p>
              <p className="mt-1 text-muted-foreground">
                Seu plano {subscription?.plan?.name} permite {maxUsers}{" "}
                {maxUsers === 1 ? "usuário" : "usuários"}.{" "}
                {isOwner
                  ? "Faça upgrade para adicionar mais membros."
                  : "Peça ao dono para fazer upgrade do plano."}
              </p>
            </div>
            {isOwner && (
              <a href="/choose-plan">
                <Button variant="outline" size="sm" className="border-amber-400 text-amber-600 hover:bg-amber-50">
                  Fazer upgrade
                </Button>
              </a>
            )}
          </div>
        )}

        <Card>
        <CardHeader>
          <CardTitle>Pessoas na organização</CardTitle>
          <CardDescription>
            <span className="flex flex-wrap items-center gap-2">
              <span>
                {activeCount} {activeCount === 1 ? "membro ativo" : "membros ativos"}
              </span>
              {maxUsers !== null && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span
                    className={
                      atLimit
                        ? "font-medium text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                    }
                  >
                    de {maxUsers} {maxUsers === 1 ? "usuário" : "usuários"} no plano {subscription?.plan?.name}
                  </span>
                  <Badge
                    variant={atLimit ? "warning" : "secondary"}
                    className="ml-1"
                  >
                    {atLimit ? "Limite atingido" : `${activeCount}/${maxUsers}`}
                  </Badge>
                </>
              )}
            </span>
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

        {/* 🔒 M17 — Transferência de ownership — só o dono vê. */}
        {isOwner && <TransferOwnershipCard />}
      </div>
    </DashboardLayout>
  );
}

function PendingInvitations() {
  const { data: invitations, isLoading } = useTenantInvitations();
  const cancelInvitation = useCancelInvitation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MailOpen className="h-5 w-5" />
          Convites pendentes
        </CardTitle>
        <CardDescription>
          {!isLoading && invitations && ` ${invitations.length} convite(s) aguardando o usuário se cadastrar e verificar o e-mail.`}
          {isLoading && " Carregando convites..."}
          {!isLoading && (!invitations || invitations.length === 0) && " No momento não há convites aguardando aceitação."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !invitations || invitations.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum convite pendente. Use o botão "Convidar membro" para adicionar pessoas à organização.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{invitation.email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Convidado como {ROLE_LABELS[invitation.roleName] ?? invitation.roleName}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="warning">Pendente</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Cancelar convite de ${invitation.email}`}
                    disabled={cancelInvitation.isPending}
                    onClick={() => cancelInvitation.mutate(invitation.id)}
                  >
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InviteMemberDialog({
  atLimit = false,
  maxUsers = null,
  activeCount = 0,
}: {
  atLimit?: boolean;
  maxUsers?: number | null;
  activeCount?: number;
}) {
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
      // onError do hook já exibe toast — mantém o dialog aberto para correção
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          disabled={atLimit}
          title={
            atLimit && maxUsers !== null
              ? `Limite do plano atingido (${activeCount}/${maxUsers}). Faça upgrade para convidar mais membros.`
              : undefined
          }
        >
          <UserPlus className="h-4 w-4" />
          Convidar membro
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Convidar membro</AlertDialogTitle>
          <AlertDialogDescription>
            O convidado vai receber um link de cadastro por e-mail. Ao se cadastrar
            e confirmar o e-mail com este endereço, ele entra direto na organização
            com o papel escolhido — sem precisar criar workspace próprio.
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
              O convidado receberá um e-mail com o link de cadastro.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {/* Button normal com type="submit" em vez de AlertDialogAction:
                AlertDialogAction fecha o dialog automaticamente (Radix),
                o que desmonta o form antes do submit assíncrono completar
                e causa o warning "Form submission canceled because the form
                is not connected". Com Button, o form controla o submit e
                nós fechamos o dialog manualmente em onSubmit após o mutate. */}
            <Button type="submit" disabled={inviteMember.isPending}>
              {inviteMember.isPending && <Loader2 className="animate-spin" />}
              Convidar
            </Button>
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

  // 🔒 M17 — Só pode existir 1 owner. Owner nunca oferece "owner" no select
  // de outro membro — a troca de dono passa pela transferência de ownership.
  // O próprio dono não vê select para si (canChangeRole exclui isSelf no pai).
  const options: TenantRole[] = isOwner
    ? ["admin", "agent"]
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

/**
 * 🔒 M17 — Card de transferência de ownership.
 * Só é renderizado para o dono atual (guard no pai). Mostra um card âmbar
 * com botão que abre o dialog de confirmação forte.
 */
function TransferOwnershipCard() {
  const { data: members, isLoading } = useTenantMembers();

  // Só mostra o card se houver outros membros para receber o ownership.
  const eligibleMembers = members?.filter((m) => m.role.name !== "owner") ?? [];
  if (!isLoading && eligibleMembers.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          Transferir propriedade da organização
        </CardTitle>
        <CardDescription>
          Transfira a propriedade (ownership) para outro membro. Você passará a
          ser administrador e o membro escolhido se tornará o novo dono. Esta
          operação não pode ser desfeita sem o concordância do novo dono.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <TransferOwnershipDialog members={eligibleMembers} />
        )}
      </CardContent>
    </Card>
  );
}

function TransferOwnershipDialog({
  members,
}: {
  members: { id: string; user: { id: string; name: string; email: string }; role: { name: TenantRole } }[];
}) {
  const { data: summary } = useTenantSummary();
  const transferOwnership = useTransferOwnership();
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const orgName = summary?.name ?? "";
  const canConfirm =
    selectedMemberId !== null && confirmText.trim() === orgName.trim() && !transferOwnership.isPending;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="border-amber-400 text-amber-600 hover:bg-amber-50">
          Transferir ownership
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Transferir propriedade da organização</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Você está prestes a transferir a propriedade da organização{" "}
                <strong>{orgName || "(nome não carregado)"}</strong> para outro
                membro. Você passará a ser <strong>administrador</strong> e
                perderá acesso exclusivo ao faturamento e à edição da organização.
              </p>
              <p>Selecione o novo dono:</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={selectedMemberId ?? ""}
            onChange={(e) => setSelectedMemberId(e.target.value || null)}
            disabled={transferOwnership.isPending}
          >
            <option value="">Escolha um membro…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.name} ({m.user.email}) — {ROLE_LABELS[m.role.name] ?? m.role.name}
              </option>
            ))}
          </select>

          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Para confirmar, digite o nome da organização exatamente como está escrito:{" "}
              <strong className="font-mono">{orgName}</strong>
            </p>
            <Input
              placeholder={orgName}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={transferOwnership.isPending}
              aria-label="Confirme o nome da organização"
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              setSelectedMemberId(null);
              setConfirmText("");
            }}
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            onClick={(e) => {
              e.preventDefault();
              if (selectedMemberId) {
                transferOwnership.mutate(selectedMemberId);
                setSelectedMemberId(null);
                setConfirmText("");
              }
            }}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {transferOwnership.isPending && <Loader2 className="animate-spin" />}
            Transferir ownership
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

