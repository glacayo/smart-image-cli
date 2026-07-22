export const EXIT_CODES = {
  SUCCESS: 0,
  NO_MATCH: 2,
  INVALID_INPUT: 3,
  PROVIDER_ERROR: 4,
  FILESYSTEM_ERROR: 5
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export function isKnownExitCode(value: number): value is ExitCode {
  return Object.values(EXIT_CODES).includes(value as ExitCode);
}
