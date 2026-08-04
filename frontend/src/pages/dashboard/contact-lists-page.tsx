import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ContactIcon, Plus, Trash2, Users } from "lucide-react";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useContactLists,
  useCreateContactList,
  useDeleteContactList,
} from "@/hooks/use-contact-lists";
import type { ContactList } from "@/types/bots";

export function ContactListsPage() {
  const { data: lists, isLoading } = useContactLists();
  const createList = useCreateContactList();
  const deleteList = useDeleteContactList();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  function handleCreate() {
    if (!name.trim()) return;
    createList.mutate(
      { name: name.trim() },
      {
        onSuccess: (l) => {
          setName("");
          navigate(`/dashboard/contact-lists/${l.id}`);
        },
      },
    );
  }

  return (
    <DashboardLayout>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ContactIcon className="h-6 w-6" />
            Listas de Contatos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie listas para usar em broadcasts e em filtros de sessão.
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-2 p-4">
          <div className="flex-1 space-y-1">
            <Label htmlFor="cl-name" className="text-xs">
              Nova lista
            </Label>
            <Input
              id="cl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Clientes VIP"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <Button onClick={handleCreate} disabled={createList.isPending || !name.trim()}>
            <Plus className="h-4 w-4" /> Criar
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : !lists || lists.length === 0 ? (
        <div className="py-16 text-center">
          <Users className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">Nenhuma lista ainda.</p>
          <p className="text-sm text-muted-foreground">Crie a primeira acima.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((l) => (
            <ListCard
              key={l.id}
              list={l}
              onClick={() => navigate(`/dashboard/contact-lists/${l.id}`)}
              onDelete={() => setDeleteTarget(l.id)}
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover lista?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Os contatos vinculados serão
              desassociados da lista, mas permanecem na base do tenant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteList.mutate(deleteTarget, {
                    onSuccess: () => setDeleteTarget(null),
                  });
                }
              }}
              disabled={deleteList.isPending}
            >
              {deleteList.isPending ? "Removendo…" : "Sim, remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function ListCard({
  list,
  onClick,
  onDelete,
}: {
  list: ContactList;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">{list.name}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(list.createdAt).toLocaleDateString("pt-BR")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {list._count?.items ?? 0} contatos
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Remover lista"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
