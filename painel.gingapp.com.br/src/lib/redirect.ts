/** Leva o navegador INTEIRO para outra página (ex.: OAuth do Mercado Pago). Isolado para os testes poderem trocá-lo. */
export function redirectTo(url: string): void {
  window.location.assign(url);
}
