import type { RegisteredScreen } from "../screens/registry";
import { ReplayBadge } from "./ReplayBadge";
import { ScamCheck } from "./ScamDialog";
import { SceneToggle } from "./SceneToggle";

const STEP_NAMES = [
  "Stillingsannonse",
  "Intervju",
  "Karakterkort",
  "Signeringsrett",
  "Prøvetid",
] as const;

type Props = {
  screens: RegisteredScreen[];
  currentPath: string;
};

/** The step bar. A step links when a registered screen has that step number. */
export function StepNav({ screens, currentPath }: Props) {
  return (
    <header
      data-stepnav
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-raised px-5 py-3"
    >
      <a href="#/" className="text-lg font-bold tracking-tight text-ink">
        Prøvetid
      </a>
      <nav aria-label="Steg" className="min-w-0 flex-1">
        <ol className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
          {STEP_NAMES.map((name, index) => {
            const target = screens.find((candidate) => candidate.meta.step === index + 1);
            const isCurrent = target?.meta.path === currentPath;
            return (
              <li key={name}>
                {target ? (
                  <a
                    href={`#${target.meta.path}`}
                    aria-current={isCurrent ? "step" : undefined}
                    className={`block rounded-md px-2.5 py-1.5 text-sm font-medium ${
                      isCurrent ? "bg-pagar/15 text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    {name}
                  </a>
                ) : (
                  <span
                    aria-disabled="true"
                    className="block cursor-default rounded-md px-2.5 py-1.5 text-sm text-muted/50"
                  >
                    {name}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="flex items-center gap-2">
        <ScamCheck />
        <ReplayBadge />
        <SceneToggle />
      </div>
    </header>
  );
}
