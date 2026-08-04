import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useContactList,
  useAddContactsToList,
  useRemoveContactFromList,
} from "@/hooks/use-contact-lists";
import { useUpsertContact } from "@/hooks/use-session-settings";

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 12) {
    const ddi = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const partA = digits.slice(4, digits.length - 4);
    const partB = digits.slice(-4);
    return `+${ddi} ${ddd} ${partA}-${partB}`;
  }
  return phone;
}

export function ContactListDetailPage() {
  const { id } = useParams() as { id: string };
  const { data: list, isLoading } = useContactList(id);
  const navigate = useNavigate();
  const addContacts = useAddContactsToList();
  const removeContact = useRemoveContactFromList();
  const upsertContact = useUpsertContact();

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");

  const items = useMemo(() => list?.items ?? [], [list]);

  useEffect(() => {
    document.title = list ? `${list.name} · Listas` : "Lista";
  }, [list]);

  async function addByPhone(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    try {
      const created = await upsertContact.mutateAsync({
        phone: phone.replace(/\D/g, ""),
        name: name.trim() || undefined,
      });
      await addContacts.mutateAsync({
        listId: id,
        payload: { contactIds: [created.id] },
      });
      setPhone("");
      setName("");
    } catch {
      /* noop */
    }
  }

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/dashboard/contact-lists")}
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {list?.name ?? "Lista"}
        </h1>
        <Badge variant="outline">
          <Users className="h-3 w-3" /> {items.length} contatos
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Adicionar por número */}
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Adicionar contato</h3>
            </div>
            <form onSubmit={addByPhone} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-phone" className="text-xs">
                  Número (com DDI)
                </Label>
                <Input
                  id="c-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="5511999999999"
                  className="font-mono text-sm"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-name" className="text-xs">
                  Nome (opcional)
                </Label>
                <Input
                  id="c-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: João Silva"
                />
              </div>
              <Button
                type="submit"
                disabled={
                  addContacts.isPending ||
                  upsertContact.isPending ||
                  !phone.trim()
                }
                className="w-full"
              >
                <Plus className="h-4 w-4" /> Adicionar à lista
              </Button>
              <p className="text-xs text-muted-foreground">
                O contato é criado/atualizado no tenant e vinculado a esta lista.
              </p>
            </form>
          </CardContent>
        </Card>

        {/* Lista de contatos */}
        <Card className="overflow-hidden">
          {isLoading ? (
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          ) : items.length === 0 ? (
            <CardContent className="py-16 text-center">
              <Users className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">Lista vazia</p>
              <p className="text-xs text-muted-foreground">
                Adicione contatos pelo formulário à esquerda.
              </p>
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">
                      {it.contact?.name || "Sem nome"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {formatPhone(it.contact?.phone ?? "")}
                    </TableCell>
                    <TableCell className="pr-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() =>
                          removeContact.mutate({
                            listId: id,
                            contactId: it.contactId,
                          })
                        }
                        disabled={removeContact.isPending}
                        aria-label="Remover da lista"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}
