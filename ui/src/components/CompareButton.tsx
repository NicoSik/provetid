import { BUTTON } from "./buttons";
/** Opens the before-and-after view, which belongs to no step of its own (D40). */
export function CompareButton() {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.hash = "#/foer-etter";
      }}
      className={BUTTON.secondary}
    >
      Se før og etter
    </button>
  );
}
