import { BadRequestException } from '@nestjs/common';
import { normalizeRegistrationForUf } from './br-fields';

describe('normalizeRegistrationForUf', () => {
  it.each([
    ['224/3658792', 'RS', '2243658792'],
    ['110.042.490.114', 'SP', '110042490114'],
    ['251.040.852', 'sc', '251040852'],
    ['123456-63', 'BA', '12345663'],
    ['1234567-63', 'BA', '123456763'],
    ['0321418-40', 'PE', '032141840'],
    ['18.1.001.0000004-9', 'PE', '18100100000049'],
  ])('keeps only the digits of %s for %s', (value, uf, expected) => {
    expect(normalizeRegistrationForUf(value, uf, 'Inscricao estadual')).toBe(
      expected,
    );
  });

  it.each([
    ['1100424', 'SP'],
    ['1104249011400', 'SP'],
    ['123456789012', 'BA'],
    ['1234567890', 'PE'],
    ['STATE-456', 'SP'],
  ])('rejects %s because it does not have the size used in %s', (value, uf) => {
    expect(() =>
      normalizeRegistrationForUf(value, uf, 'Inscricao estadual'),
    ).toThrow(BadRequestException);
  });

  it.each([undefined, '', '   '])('ignores the empty value %p', (value) => {
    expect(
      normalizeRegistrationForUf(value, undefined, 'Inscricao rural'),
    ).toBeUndefined();
  });

  it.each([undefined, '', 'XX'])(
    'rejects a filled registration with the UF %p',
    (uf) => {
      expect(() =>
        normalizeRegistrationForUf('110042490114', uf, 'Inscricao rural'),
      ).toThrow(BadRequestException);
    },
  );
});
