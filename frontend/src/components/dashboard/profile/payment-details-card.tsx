import { useState } from "react";
import { CreditCard, Loader2, FileText, ExternalLink, Receipt, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBillingDetails, useUpdatePaymentMethod } from "@/hooks/use-subscription";
import type { InvoiceItem } from "@/types/billing";

/** Brand → emoji/label amigável. */
const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  elo: "Elo",
  hipercard: "Hipercard",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unknown: "Cartão",
};

/** Status da invoice → label + variant. */
const INVOICE_STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  paid: { label: "Pago", variant: "success" },
  open: { label: "Em aberto", variant: "warning" },
  void: { label: "Anulada", variant: "destructive" },
  draft: { label: "Rascunho", variant: "secondary" },
  uncollectible: { label: "Não cobrável", variant: "destructive" },
  unknown: { label: "—", variant: "secondary" },
};

function formatCurrency(amount: number, currency = "brl") {
  return amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

function formatTimestamp(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("pt-BR");
}

function formatMonth(month: number) {
  return String(month).padStart(2, "0");
}

export function PaymentDetailsCard() {
  const { data: details, isLoading, isError } = useBillingDetails();
  const updatePm = useUpdatePaymentMethod();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="h-5 w-5" />
            Método de pagamento e faturas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  // 🔒 Se ocorreu erro ao carregar os detalhes (ex: webhook ainda não
  // processou, falha temporária no Stripe), mostra mensagem no próprio card
  // em vez de sumir silenciosamente. O BillingCard já mostra o estado da
  // assinatura; aqui focamos no feedback de que não foi possível carregar
  // os detalhes de faturamento.
  if (isError || !details) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="h-5 w-5" />
            Método de pagamento e faturas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">
              Detalhes de faturamento indisponíveis
            </p>
            <p className="mt-1 text-muted-foreground">
              Não foi possível carregar as informações de cartão e faturas agora.
              Atualize a página em alguns instantes.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sempre mostra o card se chegou aqui (o backend só retorna dados para
  // assinaturas recorrentes). Mesmo sem cartão/invoices, o usuário precisa
  // ver o botão "Adicionar cartão" durante o trial.

  const hasPaymentMethod = Boolean(details.paymentMethod);
  const hasInvoices = details.invoices.length > 0;
  const hasUpcoming = Boolean(details.upcomingInvoice);
  const isOneTime = details.subscription.billingType === "one_time";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CreditCard className="h-5 w-5" />
          Método de pagamento e faturas
        </CardTitle>
        <CardDescription>
          Gerencie seu cartão e acompanhe o histórico de cobranças.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Cartão salvo ── */}
        {hasPaymentMethod && details.paymentMethod && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-14 items-center justify-center rounded-md bg-secondary">
                <CreditCard className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">
                  {BRAND_LABELS[details.paymentMethod.brand] ?? details.paymentMethod.brand}{" "}
                  **** {details.paymentMethod.last4}
                </p>
                <p className="text-sm text-muted-foreground">
                  Validade: {formatMonth(details.paymentMethod.expMonth)}/
                  {String(details.paymentMethod.expYear).slice(-2)}
                </p>
              </div>
            </div>
            {/* Bloco "Atualizar cartão" só faz sentido para assinaturas recorrentes
                (o cartão salvo é cobrado automaticamente a cada mês). */}
            {!isOneTime && (
              <Button
                variant="outline"
                size="sm"
                disabled={updatePm.isPending}
                onClick={() => updatePm.mutate()}
              >
                {updatePm.isPending && <Loader2 className="animate-spin" />}
                Atualizar cartão
              </Button>
            )}
          </div>
        )}

        {/* ── Se não tem cartão, mostra aviso com botão para adicionar ── */}
        {/* Para pagamento único, o "Adicionar cartão" não tem efeito prático
            (cartão não fica salvo em modo payment) — só mostra o aviso. */}
        {!hasPaymentMethod && !isOneTime && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <div>
              <p className="font-medium text-amber-600 dark:text-amber-400">
                Nenhum cartão salvo
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {isOneTime
                  ? "Adicione um cartão para pagamentos únicos futuros mais rápidos."
                  : details.subscription.status === "trialing"
                    ? "Adicione um cartão para continuar usando o plano após o período de teste."
                    : "Adicione um cartão para que as próximas cobranças sejam processadas automaticamente."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={updatePm.isPending}
              onClick={() => updatePm.mutate()}
              className="border-amber-400 text-amber-600 hover:bg-amber-50"
            >
              {updatePm.isPending && <Loader2 className="animate-spin" />}
              Adicionar cartão
            </Button>
          </div>
        )}

        {/* ── Aviso para pagamento único: não há cobrança recorrente ── */}
        {isOneTime && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
            <p className="font-medium text-blue-600 dark:text-blue-400">
              Pagamento único (avulso)
            </p>
            <p className="mt-1 text-muted-foreground">
              Sua assinatura foi paga para 1 mês de acesso e não gera cobranças automáticas.
              Para continuar usando após o vencimento, faça um novo pagamento.
            </p>
          </div>
        )}

        {/* ── Próxima fatura (só recorrente) ── */}
        {hasUpcoming && details.upcomingInvoice && (
          <div className="rounded-lg border border-border p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Receipt className="h-4 w-4" />
              Próxima fatura
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-2xl font-semibold tracking-tight">
                  {formatCurrency(
                    details.upcomingInvoice.amountDue,
                    details.upcomingInvoice.currency,
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  Cobrança em {formatTimestamp(details.upcomingInvoice.periodEnd)}
                </p>
              </div>
              <div className="space-y-1 text-right text-xs text-muted-foreground">
                {details.upcomingInvoice.lines.map((line, i) => (
                  <p key={i} className="max-w-[280px] break-words sm:max-w-none">
                    {line.description}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Histórico de faturas (tabela paginada) ── */}
        {hasInvoices && (
          <InvoicesTable invoices={details.invoices} />
        )}
      </CardContent>
    </Card>
  );
}

/** 🔒 Tabela responsiva de faturas com paginação de 4 itens por página. */
const PAGE_SIZE = 4;

function InvoicesTable({ invoices }: { invoices: InvoiceItem[] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(invoices.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = invoices.slice(start, start + PAGE_SIZE);

  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-sm font-medium">
        <FileText className="h-4 w-4" />
        Histórico de faturas
      </p>

      {/* 📱 Desktop: tabela real; 📱 Mobile: vira "cards" empilhados via
          data-label + CSS (ocultamos o thead no mobile e mostramos o label
          em cada célula). */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="rd-invoices w-full text-sm">
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Fatura</th>
              <th className="px-4 py-2 font-medium">Data</th>
              <th className="px-4 py-2 text-right font-medium">Valor</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Recibo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pageItems.map((inv) => (
              <InvoiceRow key={inv.id} invoice={inv} />
            ))}
          </tbody>
        </table>
      </div>

      {/* 📄 Paginação */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Página {currentPage} de {totalPages} · {invoices.length}{" "}
            {invoices.length === 1 ? "fatura" : "faturas"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Próxima página"
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: InvoiceItem }) {
  const statusInfo = INVOICE_STATUS[invoice.status] ?? INVOICE_STATUS.unknown;

  // 🔒 Link externo: prioriza invoiceUrl (recorrente — hosted_invoice_url),
  // depois receiptUrl (one-time — charge.receipt_url), depois invoicePdf.
  const externalLink = invoice.invoiceUrl ?? invoice.receiptUrl ?? invoice.invoicePdf;
  const linkLabel = invoice.invoiceUrl
    ? "Ver fatura no Stripe"
    : invoice.receiptUrl
      ? "Ver recibo"
      : invoice.invoicePdf
        ? "Baixar PDF"
        : "Ver no Stripe";

  return (
    <tr className="hover:bg-muted/30">
      <td data-label="Fatura" className="px-4 py-3 align-top">
        <p className="truncate text-sm font-medium">
          {invoice.number ?? "Pagamento"}
        </p>
      </td>
      <td data-label="Data" className="px-4 py-3 align-top text-sm text-muted-foreground">
        {formatTimestamp(invoice.createdAt)}
        {invoice.paidAt && (
          <span className="block text-xs">
            pago em {formatTimestamp(invoice.paidAt)}
          </span>
        )}
      </td>
      <td data-label="Valor" data-align="right" className="px-4 py-3 align-top text-right text-sm font-medium">
        {formatCurrency(invoice.amountPaid || invoice.amountDue)}
      </td>
      <td data-label="Status" className="px-4 py-3 align-top">
        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
      </td>
      <td data-label="Recibo" data-align="right" className="px-4 py-3 align-top text-right">
        {externalLink ? (
          <a
            href={externalLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
            aria-label={linkLabel}
          >
            <ExternalLink className="h-4 w-4" />
            <span className="sm:hidden">{linkLabel}</span>
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}
