export const defaulted = <T>(value: T | null | undefined, dfault: T) =>
  value !== null && value !== undefined ? value : dfault;

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export const shuffle = <T>(array: T[], random: () => number): T[] => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export const clamp = (value: number, min: number, max: number) => {
  if (isNaN(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

export const saturate = (value: number) => clamp(value, 0, 1);
