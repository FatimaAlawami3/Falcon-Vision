export const PASSWORD_REQUIREMENTS_ERROR =
  'Password must be at least 8 characters and include uppercase, lowercase, number, and symbol.';

export const PASSWORD_REQUIREMENTS = [
  { text: 'At least 8 characters', test: (value: string) => value.length >= 8 },
  { text: 'Contains uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { text: 'Contains lowercase letter', test: (value: string) => /[a-z]/.test(value) },
  { text: 'Contains number', test: (value: string) => /[0-9]/.test(value) },
  { text: 'Contains symbol', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

export function getPasswordError(password: string) {
  return PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(password))
    ? undefined
    : PASSWORD_REQUIREMENTS_ERROR;
}

export function isStrongPassword(password: string) {
  return getPasswordError(password) === undefined;
}
