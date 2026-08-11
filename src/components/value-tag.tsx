import { TRUST_NOTE, VALUE_ORDER, VALUES, type ValueId } from "@/lib/values";

/**
 * A quiet label naming the design value an affordance serves.
 *
 * Every value shares one neutral appearance on purpose. Colouring them apart
 * would collide with the colours already carrying meaning on this screen
 * (green = the assistant's proposal, amber = caution, red = removed text), and
 * a participant would read the value chips as interface state. Kept as an
 * annotation layer instead: same weight, same colour, unmistakably commentary
 * on the design rather than part of it.
 */
export function ValueTag({
  id,
  className = "",
}: {
  id: ValueId;
  className?: string;
}) {
  const value = VALUES[id];
  return (
    <span
      title={value.claim}
      className={`inline-block border border-border px-1.5 py-px text-[10px] font-semibold uppercase leading-[1.6] tracking-[0.12em] text-faint-foreground ${className}`}
    >
      <span className="sr-only">Design value: </span>
      {value.label}
    </span>
  );
}

/**
 * The key to the chips, shown once at the top of the review screen. Collapsed
 * by default: a participant who wants to know what the labels mean can open
 * it, and one who does not is not made to read a design rationale before
 * reviewing their CV.
 */
export function ValueLegend() {
  return (
    <details className="group mt-5 border border-border bg-background">
      <summary className="cursor-pointer list-none px-4 py-3">
        <span className="flex flex-wrap items-center gap-2">
          <span className="label-caps !text-foreground">
            Designed around four values
          </span>
          {VALUE_ORDER.map((id) => (
            <ValueTag key={id} id={id} />
          ))}
          <span className="ml-auto text-xs font-semibold text-accent">
            <span className="group-open:hidden">What these mean</span>
            <span className="hidden group-open:inline">Hide</span>
          </span>
        </span>
      </summary>
      <div className="border-t border-border px-4 py-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          These labels appear beside the parts of this screen that carry each
          value, so you can judge whether the assistant actually delivers what
          it claims.
        </p>
        <dl className="mt-4 flex flex-col gap-4">
          {VALUE_ORDER.map((id) => (
            <div key={id}>
              <dt className="flex flex-wrap items-baseline gap-2">
                <ValueTag id={id} />
                <span className="text-sm font-semibold text-foreground">
                  {VALUES[id].claim}
                </span>
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {VALUES[id].delivered}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-border pt-3 text-sm leading-relaxed text-faint-foreground">
          {TRUST_NOTE}
        </p>
      </div>
    </details>
  );
}
