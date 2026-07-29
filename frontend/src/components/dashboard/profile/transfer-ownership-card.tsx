import { useState } from "react";
import { Loader2, ShieldAlert, ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
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
import { useTenantMembers, useTenantSummary, useTransferOwnership } from "@/hooks/use-tenant";
import type { TenantRole } from "@/types/auth";

const ROLE_LABELS: Record<string, string> = {
  owner: "Dono",
  admin: "Administrador",
  agent: "Atendente",
};

/**
 * 🔒 M17 — Card de transferência de ownership.
 * Só é renderizado para o dono atual (guard no pai). Mostra um card âmbar
 * com botão que abre o dialog de confirmação forte.
 *
 * Movido de members-page.tsx para organization-card.tsx (aba de
 * configurações da organização), onde faz mais sentido para o dono.
 */
export function TransferOwnershipCard() {
  const { data: members, isLoading } = useTenantMembers();

  // Só mostra o card se houver outros membros para receber o ownership.
  const eligibleMembers = members?.filter((m) => m.role.name !== "owner") ?? [];
  if (!isLoading && eligibleMembers.length === 0) return null;

  return (
    <Card className="border-amber-500/30">
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
          <div className="relative">
            <select
              className="flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pe-9 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>

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
