/**
 * Normalização de números de telefone para comparação robusta.
 *
 * 🔒 Brasil (DDI 55) — Oscilação do nono dígito:
 *   Em números móveis brasileiros, alguns transportadores/Whitelist mantêm
 *   o 9 entre o DDD e o número (55119XXXXXXXX, 11 dígitos total), enquanto
 *   outros desconsideram (5511XXXXXXXX, 10 dígitos total). Ambos se referem
 *   ao mesmo número.
 *
 *   Para comparação, normalizamos a forma "com 9" para a forma "sem 9"
 *   removendo o 9 na posição específica (entre DDI+DDD e os 8 dígitos finais)
 *   quando o total de dígitos (após DDI) é 11 e o número começa com DDI 55.
 *
 *   DDDs válidos do Brasil: 11–99.
 *
 *   Exemplos:
 *     5575981520641 → 557581520641   (mesmo número, removido o 9)
 *     55119XXXXXXXX → 5511XXXXXXXX
 *     5511XXXXXXXX  → 5511XXXXXXXX   (já normalizado, idempotente)
 *     5512345678    → 5512345678     (fixo, 10 dígitos total sem 9 extra — não altera)
 *
 * Para DDI != 55 (não-Brasil), o valor é retornado inalterado (apenas
 * sanitizado para dígitos). A oscilação do 9 é específica do Brasil.
 */

const DDI_BRASIL = '55';

/**
 * Remove qualquer caractere não-dígito do telefone.
 * Retorna string vazia se input for vazio/inválido.
 */
export function sanitizeDigits(phone: string | null | undefined): string {
  if (!phone || typeof phone !== 'string') return '';
  return phone.replace(/\D/g, '');
}

/**
 * Normaliza um telefone E.164 (só dígitos, sem +) para forma canônica
 * usada em comparações internas. Idempotente.
 *
 * Aplica para Brasil (DDI 55):
 *   - remove o 9 entre DDD e os 8 últimos dígitos, se presente
 *
 * Caso o telefone esteja em formato com "+" ou espaços, sanitiza antes.
 */
export function normalizePhoneForCompare(phone: string | null | undefined): string {
  const digits = sanitizeDigits(phone);
  if (!digits) return '';

  // Brasil: DDI 55 + DDD (2 dígitos) + 9 + 8 dígitos = 13 dígitos.
  // Removemos o 9 extra (11 dígitos depois do DDI viram 10).
  if (digits.startsWith(DDI_BRASIL)) {
    const semDDI = digits.slice(2); // 11 dígitos formato BR móvel "9X...9XXXXXXXX"
    if (semDDI.length === 11) {
      // Primeiro dígito após DDD deve ser 9 em PLAN móvel com nono dígito.
      // Checagem defensiva: só removemos se for 9 mantendo os 8 últimos.
      const ddd = semDDI.slice(0, 2);
      const penultimo_bloco = semDDI.slice(2, 3); // '9'
      const ultimos_oito = semDDI.slice(3); // 8 dígitos
      if (penultimo_bloco === '9') {
        return `${DDI_BRASIL}${ddd}${ultimos_oito}`;
      }
    }
    // 10 dígitos (fixo): já está normalizado, retorna inalterado.
    // Outros comprimentos: não conhece padrão BR, retorna inalterado.
  }
  return digits;
}

/**
 * Compara dois telefones E.164 em qualquer formato (com/sem 9, com/sem +,
 * em PT-B) e retorna true se representam o mesmo número.
 */
export function phonesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhoneForCompare(a);
  const nb = normalizePhoneForCompare(b);
  if (!na || !nb) return false;
  return na === nb;
}
