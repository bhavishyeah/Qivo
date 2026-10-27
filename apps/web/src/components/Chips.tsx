// Presentational chip renderer for array-valued answers (display only).
// Renders each array member as an indigo pill; exports and plain-string
// answers are handled elsewhere and are deliberately NOT chipped.
export function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <span>—</span>; // defensive: empty array
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((item, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            padding: "2px 10px",
            borderRadius: 999,
            background: "#eef2ff",
            color: "#3730a3",
            fontSize: "0.8rem",
            fontWeight: 600,
            maxWidth: "100%",
            overflowWrap: "anywhere", // long entries wrap instead of overflow
          }}
        >
          {item}
        </span>
      ))}
    </span>
  );
}
