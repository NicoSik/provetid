import { PAGE } from "../screens/layout";

/** A step with nothing to show yet: its heading, why it is empty, and where to start (#121). */
export function EmptyStep({ title, text }: { title: string; text: string }) {
  return (
    <div className={`${PAGE} space-y-3`}>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="text-muted">{text}</p>
      <a
        href="#/stillingsannonse"
        className="inline-block font-medium text-ink underline underline-offset-4"
      >
        Start et intervju på Stillingsannonse
      </a>
    </div>
  );
}
