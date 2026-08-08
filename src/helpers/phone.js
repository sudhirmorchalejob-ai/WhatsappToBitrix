/**
 * Phone helpers. WhatsApp numbers are stored as digits-only E.164
 * (e.g. 15551234567). Bitrix24 stores phones in free text, so we
 * normalize before comparing.
 */

function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

/**
 * True when both phones are the same after normalization.
 * Drops a leading country code if both otherwise match, to cope
 * with local (no-country-code) numbers stored in Bitrix24.
 */
function comparePhones(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 2 && na.slice(1) === nb) return true;
  if (nb.length > 2 && nb.slice(1) === na) return true;
  return false;
}

module.exports = { normalizePhone, comparePhones };
