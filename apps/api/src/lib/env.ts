/**
 * Centrale omgevings-policy.
 *
 * `mocksAllowed()` is dé plek waar "nooit mocks/fake succes in productie"
 * wordt afgedwongen. Alle feature-specifieke guards (sourcing, job-boards,
 * whatsapp, voice) delegeren hierheen, zodat de policy grep-baar en in één
 * regel aanpasbaar is. Functie (geen constante) zodat tests NODE_ENV kunnen
 * wisselen zonder module-cache-gedoe.
 */
export function mocksAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}
