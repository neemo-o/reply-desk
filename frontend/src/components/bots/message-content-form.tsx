/**
 * MessageContentForm — formulário de conteúdo de mensagem por tipo.
 *
 * Compartilhado entre:
 *  - steps de bots SIMPLE/AGENTS (text|list|buttons|media|handoff)
 *  - mensagem de broadcast em bot AUTO (text|list|buttons|media, sem handoff)
 *
 * `value` é o objeto `conteudo` do step/mensagem. `onChange` emite o novo
 * objeto. `allowHandoff` habilita a opção `handoff` (apenas bots SIMPLE/AGENTS)
 * — broadcasts (AUTO) não suportam handoff.
 *
 * Layout para inputs nativos segue o padrão shadcn adotado no restante do
 * app (selects nativos estilizados — ver whatsapp-page/session-settings-panel).
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type { StepMessageType } from "@/types/bots";

type AllowedTypes = StepMessageType[];

const TYPE_LABEL: Record<StepMessageType, string> = {
  text: "Texto",
  list: "Lista",
  buttons: "Botões",
  media: "Mídia",
  handoff: "Handoff (atendimento humano)",
};

export interface MessageContentFormProps {
  type: StepMessageType;
  onTypeChange: (next: StepMessageType) => void;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  allowHandoff: boolean;
  disabled?: boolean;
}

export function MessageContentForm({
  type,
  onTypeChange,
  value,
  onChange,
  allowHandoff,
  disabled,
}: MessageContentFormProps) {
  const allowed: AllowedTypes = allowHandoff
    ? ["text", "list", "buttons", "media", "handoff"]
    : ["text", "list", "buttons", "media"];

  function patch(next: Record<string, unknown>) {
    onChange({ ...value, ...next });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
          Tipo de mensagem
        </Label>
        <select
          value={type}
          onChange={(e) => onTypeChange(e.target.value as StepMessageType)}
          disabled={disabled}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {allowed.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {type === "text" && (
        <div className="space-y-1.5">
          <Label htmlFor="mc-text" className="text-xs">Texto</Label>
          <textarea
            id="mc-text"
            value={(value.text as string | undefined) ?? ""}
            onChange={(e) => patch({ text: e.target.value })}
            disabled={disabled}
            rows={3}
            placeholder="Digite a mensagem…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      )}

      {type === "media" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mc-url" className="text-xs">URL da mídia</Label>
            <Input
              id="mc-url"
              value={(value.url as string | undefined) ?? ""}
              onChange={(e) => patch({ url: e.target.value })}
              disabled={disabled}
              placeholder="https://…/imagem.jpg"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mc-caption" className="text-xs">Legenda (opcional)</Label>
            <Input
              id="mc-caption"
              value={(value.caption as string | undefined) ?? ""}
              onChange={(e) => patch({ caption: e.target.value })}
              disabled={disabled}
              placeholder="Descrição opcional"
            />
          </div>
        </div>
      )}

      {type === "buttons" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mc-btext" className="text-xs">Texto do passo</Label>
            <textarea
              id="mc-btext"
              value={(value.text as string | undefined) ?? ""}
              onChange={(e) => patch({ text: e.target.value })}
              disabled={disabled}
              rows={2}
              placeholder="Escolha uma opção:"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Botões</Label>
            <ButtonListEditor
              items={normalizeButtons(value.buttons)}
              onChange={(buttons) => patch({ buttons })}
              disabled={disabled}
            />
          </div>
        </div>
      )}

      {type === "list" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mc-ltext" className="text-xs">Texto do passo</Label>
            <textarea
              id="mc-ltext"
              value={(value.text as string | undefined) ?? ""}
              onChange={(e) => patch({ text: e.target.value })}
              disabled={disabled}
              rows={2}
              placeholder="Escolha uma opção da lista:"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="mc-ltitle" className="text-xs">Título da lista</Label>
              <Input
                id="mc-ltitle"
                value={(value.title as string | undefined) ?? ""}
                onChange={(e) => patch({ title: e.target.value })}
                disabled={disabled}
                placeholder="Opções"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mc-lbtn" className="text-xs">Rótulo do botão</Label>
              <Input
                id="mc-lbtn"
                value={(value.buttonText as string | undefined) ?? ""}
                onChange={(e) => patch({ buttonText: e.target.value })}
                disabled={disabled}
                placeholder="Ver opções"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Itens da lista</Label>
            <ListRowsEditor
              items={normalizeListRows(value.rows)}
              onChange={(rows) => patch({ rows })}
              disabled={disabled}
            />
          </div>
        </div>
      )}

      {type === "handoff" && (
        <div className="space-y-1.5">
          <Label htmlFor="mc-hmsg" className="text-xs">Mensagem antes do handoff</Label>
          <textarea
            id="mc-hmsg"
            value={(value.text as string | undefined) ?? ""}
            onChange={(e) => patch({ text: e.target.value })}
            disabled={disabled}
            rows={2}
            placeholder="Vou transferir você para um atendente humano…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground">
            O step final com handoff transfere o atendimento para um humano — não há próximos passos.
          </p>
        </div>
      )}
    </div>
  );
}

interface ButtonItem {
  id: string;
  title: string;
  description?: string;
}

function normalizeButtons(raw: unknown): ButtonItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((x) => ({
      id: String((x as { id?: unknown }).id ?? crypto.randomUUID()),
      title: String((x as { title?: unknown }).title ?? ""),
      description: typeof (x as { description?: unknown }).description === "string"
        ? String((x as { description?: unknown }).description)
        : undefined,
    }));
}

function ButtonListEditor({
  items,
  onChange,
  disabled,
}: {
  items: ButtonItem[];
  onChange: (next: ButtonItem[]) => void;
  disabled?: boolean;
}) {
  function update(id: string, patch: Partial<ButtonItem>) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function add() {
    onChange([...items, { id: crypto.randomUUID(), title: "" }]);
  }
  function remove(id: string) {
    onChange(items.filter((it) => it.id !== id));
  }

  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.id} className="flex items-start gap-2">
          <Input
            value={it.title}
            onChange={(e) => update(it.id, { title: e.target.value })}
            placeholder="Título do botão"
            disabled={disabled}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-destructive"
            onClick={() => remove(it.id)}
            disabled={disabled}
            aria-label="Remover botão"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={disabled || items.length >= 3}
      >
        <Plus className="h-4 w-4" /> Adicionar botão
      </Button>
      {items.length >= 3 && (
        <p className="text-xs text-muted-foreground">Máximo de 3 botões.</p>
      )}
    </div>
  );
}

interface ListRow {
  id: string;
  title: string;
  description?: string;
}

function normalizeListRows(raw: unknown): ListRow[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((x) => ({
      id: String((x as { id?: unknown }).id ?? crypto.randomUUID()),
      title: String((x as { title?: unknown }).title ?? ""),
      description: typeof (x as { description?: unknown }).description === "string"
        ? String((x as { description?: unknown }).description)
        : undefined,
    }));
}

function ListRowsEditor({
  items,
  onChange,
  disabled,
}: {
  items: ListRow[];
  onChange: (next: ListRow[]) => void;
  disabled?: boolean;
}) {
  function update(id: string, patch: Partial<ListRow>) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function add() {
    onChange([...items, { id: crypto.randomUUID(), title: "" }]);
  }
  function remove(id: string) {
    onChange(items.filter((it) => it.id !== id));
  }

  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.id} className="flex items-start gap-2">
          <Input
            value={it.title}
            onChange={(e) => update(it.id, { title: e.target.value })}
            placeholder="Título do item"
            disabled={disabled}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-destructive"
            onClick={() => remove(it.id)}
            disabled={disabled}
            aria-label="Remover item"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={disabled || items.length >= 10}
      >
        <Plus className="h-4 w-4" /> Adicionar item
      </Button>
      {items.length >= 10 && (
        <p className="text-xs text-muted-foreground">Máximo de 10 itens.</p>
      )}
    </div>
  );
}
