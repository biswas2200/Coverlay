/** The Lay AI mark: a black square with a white triangle (it flips when the chat opens, see .lay-tri in app.css). */
export function LayMark() {
  return (
    <svg className="lay-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#000" />
      <path className="lay-tri" d="M16 8.5 25 23.5H7z" fill="#fff" />
    </svg>
  );
}
