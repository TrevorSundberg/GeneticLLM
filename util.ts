export const defaulted = <T>(value: T | null | undefined, dfault: T) =>
  value !== null && value !== undefined ? value : dfault;

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));