"use client";

// Opens the browser's print dialog (which also offers "Save as PDF").
// Hidden when printing so it never appears on the document itself.
export default function PrintButton() {
  return (
    <>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <button
        className="no-print"
        onClick={() => window.print()}
        style={{ marginTop: 24, padding: "9px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "1px solid #bbb", background: "#fff", cursor: "pointer" }}
      >
        Print / Save as PDF
      </button>
    </>
  );
}
