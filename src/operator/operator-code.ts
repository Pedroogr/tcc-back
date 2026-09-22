import { createHmac, randomBytes } from 'crypto';

export function generateOperatorCode() {
  return randomBytes(6)
    .toString('hex')
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join('-');
}

export function normalizeOperatorCode(code: string) {
  return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function hashOperatorCode(code: string) {
  return createHmac('sha256', operatorCodePepper())
    .update(normalizeOperatorCode(code))
    .digest('hex');
}

function operatorCodePepper() {
  if (process.env.OPERATOR_CODE_PEPPER) {
    return process.env.OPERATOR_CODE_PEPPER;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('OPERATOR_CODE_PEPPER is required in production');
  }

  return process.env.JWT_SECRET ?? 'dev-secret-change-me';
}
