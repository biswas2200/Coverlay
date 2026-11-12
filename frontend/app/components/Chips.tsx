/** A row of skill chips (`tone` is the colour: green for what you have, amber for what to add). */
export function Chips({ items, tone, label }: { items: readonly string[]; tone?: 'green' | 'amber'; label?: string }) {
  return (
    <ul className={`chips${tone ? ` chips-${tone}` : ''}`} aria-label={label}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
