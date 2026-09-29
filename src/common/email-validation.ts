import { ValidateBy, type ValidationOptions } from 'class-validator';
import { parse } from 'tldts';

export function hasRecognizedPublicEmailSuffix(value: string) {
  const result = parse(value);

  return (
    result.domain !== null && result.isIcann === true && result.isIp === false
  );
}

export function IsPublicEmailDomain(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isPublicEmailDomain',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && hasRecognizedPublicEmailSuffix(value),
        defaultMessage: () =>
          'E-mail deve usar uma extensao publica reconhecida',
      },
    },
    validationOptions,
  );
}
