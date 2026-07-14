export default function format(value: Model): { text: string } {
  return { text: String(value) };
}

export const enabled = true;
