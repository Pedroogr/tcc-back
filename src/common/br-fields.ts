import { BadRequestException } from '@nestjs/common';

export function onlyDigits(value?: string | null) {
  return value?.replace(/\D/g, '') ?? '';
}

export function isValidCpf(value: string) {
  const cpf = onlyDigits(value);

  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  const firstDigit = calculateCpfDigit(cpf.slice(0, 9));
  const secondDigit = calculateCpfDigit(`${cpf.slice(0, 9)}${firstDigit}`);

  return cpf === `${cpf.slice(0, 9)}${firstDigit}${secondDigit}`;
}

export function isValidCnpj(value: string) {
  const cnpj = onlyDigits(value);

  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) {
    return false;
  }

  const firstDigit = calculateCnpjDigit(cnpj.slice(0, 12));
  const secondDigit = calculateCnpjDigit(`${cnpj.slice(0, 12)}${firstDigit}`);

  return cnpj === `${cnpj.slice(0, 12)}${firstDigit}${secondDigit}`;
}

export function normalizeCpfOrCnpj(value?: string) {
  if (!value?.trim()) {
    return undefined;
  }

  const document = onlyDigits(value);

  if (document.length !== 11 && document.length !== 14) {
    throw new BadRequestException(
      document.length <= 11
        ? 'CPF deve conter 11 digitos.'
        : 'CNPJ deve conter 14 digitos.',
    );
  }

  if (document.length === 11 && !isValidCpf(document)) {
    throw new BadRequestException('CPF invalido.');
  }

  if (document.length === 14 && !isValidCnpj(document)) {
    throw new BadRequestException('CNPJ invalido.');
  }

  return document;
}

export function normalizeCnpj(value?: string) {
  if (!value?.trim()) {
    return undefined;
  }

  const cnpj = onlyDigits(value);

  if (cnpj.length !== 14) {
    throw new BadRequestException('CNPJ deve conter 14 digitos.');
  }

  if (!isValidCnpj(cnpj)) {
    throw new BadRequestException('CNPJ invalido.');
  }

  return cnpj;
}

export function normalizeBrazilianPhone(value?: string) {
  if (!value?.trim()) {
    return undefined;
  }

  const phone = onlyDigits(value);

  if (phone.length !== 10 && phone.length !== 11) {
    throw new BadRequestException(
      'Telefone deve conter DDD e numero completo.',
    );
  }

  if (phone.length === 11 && phone[2] !== '9') {
    throw new BadRequestException(
      'Celular deve conter 11 digitos com DDD e nono digito.',
    );
  }

  return phone;
}

export function generateValidCpf() {
  const base = Array.from({ length: 9 }, () => randomDigit()).join('');
  const firstDigit = calculateCpfDigit(base);
  const secondDigit = calculateCpfDigit(`${base}${firstDigit}`);

  return `${base}${firstDigit}${secondDigit}`;
}

export function generateValidCnpj() {
  const base = Array.from({ length: 12 }, () => randomDigit()).join('');
  const firstDigit = calculateCnpjDigit(base);
  const secondDigit = calculateCnpjDigit(`${base}${firstDigit}`);

  return `${base}${firstDigit}${secondDigit}`;
}

function randomDigit() {
  return Math.floor(Math.random() * 10);
}

function calculateCpfDigit(base: string) {
  const sum = base
    .split('')
    .reduce(
      (total, digit, index) =>
        total + Number(digit) * (base.length + 1 - index),
      0,
    );
  const rest = (sum * 10) % 11;

  return rest === 10 ? 0 : rest;
}

function calculateCnpjDigit(base: string) {
  const weights =
    base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = base
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  const rest = sum % 11;

  return rest < 2 ? 0 : 11 - rest;
}
