import { useEffect, useState } from "react";
import {
  Settings2,
  Bot,
  Filter,
  Plus,
  X,
  Loader2,
  UserPlus,
  ListFilter,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSessionSettings,
  useUpdateSessionSettings,
  useSessionContacts,
  useAddContactToList,
  useRemoveContactFromList,
  useUpsertContact,
} from "@/hooks/use-session-settings";
import { useBots } from "@/hooks/use-bots";
import {
  CONTACT_FILTER_LABELS,
  type ContactFilterMode,
  type ContactList,
  type SessionContactListItem,
} from "@/types/whatsapp";

/**
 * 🔒 S24 — Painel de configurações da sessão.
 *
 * Exibido dentro do Sheet de detalhes da sessão (aba "Configurações").
 * Permite ao owner/admin:
 *  1. Trocar o bot ativo (ativos) ou desvincular.
 *  2. Ligar/desligar a whitelist (modo "whitelist" ativa o filtro;
 *     "none" deixa só a blacklist valer como banimento).
 *  3. Gerenciar as listas whitelist e blacklist (adicionar por número,
 *     remover item, ver contatos da lista).
 *
 * 🔒 S24-b — A blacklist NÃO é mais um modo; ela sempre bloqueia quando
 * preenchida, independente do modo. Por isso a UI agora trata whitelist
 * e blacklist como listas independentes que convivem na mesma sessão.
 *
 * Salvar as configurações NÃO fecha nem reconecta a sessão — o filtro
 * passa a valer no próximo inbound (confirmação por toast).
 */
export function SessionSettingsPanel({
  sessionId,
  canManage,
}: {
  sessionId: string;
  canManage: boolean;
}) {
  const settings = useSessionSettings(sessionId);

  if (!canManage) {
    return (
      <div className="rounded-lg border border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
        Você é atendente — apenas visualize o status. As configurações ficam
        restritas a <strong>donos e administradores</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Configurações da sessão</h3>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="general">Geral</TabsTrigger>
          <TabsTrigger value="whitelist">Whitelist</TabsTrigger>
          <TabsTrigger value="blacklist">Blacklist</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralSettingsTab sessionId={sessionId} settings={settings} />
        </TabsContent>
        <TabsContent value="whitelist">
          <ContactListTab sessionId={sessionId} list="whitelist" settings={settings} />
        </TabsContent>
        <TabsContent value="blacklist">
          <ContactListTab sessionId={sessionId} list="blacklist" settings={settings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Aba "Geral": bot ativo + modo de filtro ────────────────────────

function GeneralSettingsTab({
  sessionId,
  settings,
}: {
  sessionId: string;
  settings: ReturnType<typeof useSessionSettings>;
}) {
  const update = useUpdateSessionSettings(sessionId);
  const { data: bots, isLoading: botsLoading } = useBots();

  const s = settings.data;
  const [activeBotId, setActiveBotId] = useState<string>("");
  const [filterMode, setFilterMode] = useState<ContactFilterMode>("none");

  // Sincroniza estado local quando settings carrega ou muda.
  // (Mantém os inputs estáveis enquanto o usuário edita — só re-sincroniza
  // quando o servidor retorna um valor diferente.)
  useEffect(() => {
    if (!s) return;
    setActiveBotId((current) =>
      current === (s.activeBotId ?? "") ? current : (s.activeBotId ?? ""),
    );
    setFilterMode((current) =>
      current === s.contactFilterMode ? current : s.contactFilterMode,
    );
  }, [s?.activeBotId, s?.contactFilterMode, s]);

  if (settings.isLoading || !s) {
    return (
      <div className="space-y-3 pt-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-9 w-40" />
      </div>
    );
  }

  const noActiveBots =
    !botsLoading &&
    (!bots ||
      bots.filter((b) => b.status === "active" || b.status === "testing")
        .length === 0);
  const hasChanges =
    activeBotId !== (s.activeBotId ?? "") || filterMode !== s.contactFilterMode;

  function save() {
    update.mutate({
      activeBotId: activeBotId || null,
      contactFilterMode: filterMode,
    });
  }

  return (
    <div className="space-y-5 pt-2">
        {/* Bot ativo */}
        <div className="space-y-1.5">
          <Label htmlFor="settings-bot" className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5" /> Bot ativo
          </Label>
          <select
            id="settings-bot"
            value={activeBotId}
            onChange={(e) => setActiveBotId(e.target.value)}
            disabled={noActiveBots}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">
              {botsLoading
                ? "Carregando bots…"
                : noActiveBots
                  ? "Nenhum bot ativo"
                  : "Sem bot (sessão não responde)"}
            </option>
            {bots
              ?.filter((b) => b.status === "active" || b.status === "testing")
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.status === "testing" ? " (teste)" : ""}
                </option>
              ))}
          </select>
          <p className="text-xs text-muted-foreground">
            A sessão só gera QR e responde mensagens quando há um bot ativo
            vinculado. Desvincule para pausar.
          </p>
        </div>

      {/* Filtro de contatos */}
      <div className="space-y-1.5">
        <Label htmlFor="settings-filter" className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5" /> Filtro de contatos
        </Label>
        <select
          id="settings-filter"
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value as ContactFilterMode)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {Object.entries(CONTACT_FILTER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Whitelist vazia libera o envio para todos (subentende-se que sem
          ninguém na lista, ninguém está sendo restringido). A blacklist é
          independente e sempre bloqueia quando preenchida.
          Mensagens filtradas não entram no banco (privacidade). Alterar não
          reconecta a sessão — vale a partir da próxima mensagem recebida.
        </p>
      </div>

      <Button
        onClick={save}
        disabled={update.isPending || !hasChanges}
        className="w-full sm:w-auto"
      >
        {update.isPending && <Loader2 className="animate-spin" />}
        Salvar configurações
      </Button>
    </div>
  );
}

// ─── Aba de lista de contatos (whitelist | blacklist) ────────────────

function ContactListTab({
  sessionId,
  list,
  settings,
}: {
  sessionId: string;
  list: ContactList;
  settings: ReturnType<typeof useSessionSettings>;
}) {
  const contacts = useSessionContacts(sessionId, list);
  const addContact = useAddContactToList(sessionId);
  const removeContact = useRemoveContactFromList(sessionId);
  const upsertContact = useUpsertContact();

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  const filterMode = settings.data?.contactFilterMode ?? "none";
  const isWhitelistActive = filterMode === "whitelist";
  const isBlacklistActive = true; // 🔒 S24-b — blacklist SEMPRE é banimento.
  const listIsRelevant =
    (list === "whitelist" && isWhitelistActive) ||
    (list === "blacklist" && isBlacklistActive);

  async function addByPhone(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    try {
      // 1. Upsert contato por número (cria se não existir)
      const created = await upsertContact.mutateAsync({
        phone: phone.replace(/\D/g, ""),
        name: name.trim() || undefined,
      });
      // 2. Adiciona à lista desta sessão
      await addContact.mutateAsync({
        contactId: created.id,
        list,
        note: note.trim() || undefined,
      });
      // Limpa form
      setPhone("");
      setName("");
      setNote("");
    } catch {
      /* toast tratado no hook */
    }
  }

  return (
    <div className="space-y-5 pt-2">
      {/* Aviso de relevância da lista */}
      {!listIsRelevant && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/40 bg-amber-50/50 p-3 text-xs text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-200">
          <ListFilter className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {list === "whitelist" ? (
              <>
                A whitelist está desativada (modo <strong>none</strong>).
                Contatos adicionados aqui ficam salvos mas não restringem
                ninguém até você ativar o modo <strong>whitelist</strong> em
                <em> Geral</em>.
              </>
            ) : (
              <>A blacklist sempre bloqueia quando preenchida.</>
            )}
          </span>
        </div>
      )}
      {listIsRelevant && list === "whitelist" && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-300/40 bg-emerald-50/50 p-3 text-xs text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Whitelist ativa. Mensagens dos contatos abaixo passam para o
            bot; os demais são bloqueados (não entram no banco).
            {filterMode === "whitelist" && contacts.data?.length === 0 && (
              <em> Lista vazia = passa qualquer um.</em>
            )}
          </span>
        </div>
      )}
      {listIsRelevant && list === "blacklist" && (
        <div className="flex items-start gap-2 rounded-md border border-rose-300/40 bg-rose-50/50 p-3 text-xs text-rose-900 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Blacklist sempre ativa. Mensagens dos contatos abaixo são
            bloqueadas (não entram no banco), independente do modo de
            whitelist.
          </span>
        </div>
      )}

      {/* Adicionar por número */}
      <form onSubmit={addByPhone} className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
        <div className="flex items-center gap-1.5">
          <UserPlus className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Adicionar contato por número</h4>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
          <div className="space-y-1">
            <Label htmlFor={`phone-${list}`} className="text-xs">
              Número (com DDI)
            </Label>
            <Input
              id={`phone-${list}`}
              placeholder="5511999999999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`name-${list}`} className="text-xs">
              Nome (opcional)
            </Label>
            <Input
              id={`name-${list}`}
              placeholder="ex.: João Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`note-${list}`} className="text-xs">
            Observação (opcional)
          </Label>
          <Input
            id={`note-${list}`}
            placeholder={list === "whitelist" ? "ex.: cliente VIP" : "ex.: concorrente"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="text-sm"
          />
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={
            addContact.isPending || upsertContact.isPending || !phone.trim()
          }
        >
          {(addContact.isPending || upsertContact.isPending) && (
            <Loader2 className="animate-spin" />
          )}
          <Plus className="h-4 w-4" />
          Adicionar à {list === "whitelist" ? "whitelist" : "blacklist"}
        </Button>
      </form>

      {/* Lista atual */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium">
            Contatos na {list === "whitelist" ? "whitelist" : "blacklist"}
          </h4>
          {contacts.data && contacts.data.length > 0 && (
            <Badge variant="outline" className="gap-1">
              {contacts.data.length}
            </Badge>
          )}
        </div>
        {contacts.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : !contacts.data || contacts.data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {list === "whitelist"
              ? "Whitelist vazia. Se o modo whitelist estiver ativo, todos passam; se não, a whitelist fica sem efeito."
              : "Blacklist vazia — ninguém está bloqueado."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {contacts.data.map((item) => (
              <ContactListRow
                key={item.id}
                item={item}
                list={list}
                onRemove={() => removeContact.mutate({ itemId: item.id, list })}
                isRemoving={
                  removeContact.isPending &&
                  removeContact.variables?.itemId === item.id
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ContactListRow({
  item,
  list,
  onRemove,
  isRemoving,
}: {
  item: SessionContactListItem;
  list: ContactList;
  onRemove: () => void;
  isRemoving: boolean;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-card p-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-mono">
        {item.contact.name?.charAt(0).toUpperCase() ?? "?"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {item.contact.name || "Sem nome"}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {item.contact.phone}
        </p>
        {item.note && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
            {item.note}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        disabled={isRemoving}
        aria-label={`Remover ${item.contact.name ?? item.contact.phone} da ${list}`}
        className="h-8 shrink-0 gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        {isRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        Remover
      </Button>
    </li>
  );
}
