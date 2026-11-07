/** Opens the before-and-after view, which belongs to no step of its own (D40). */
export function CompareButton() {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.hash = "#/foer-etter";
      }}
      className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink hover:bg-raised-hover"
    >
      Se før og etter
    </button>
  );
}
