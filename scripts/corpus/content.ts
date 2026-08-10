/**
 * One CV, described structurally, rendered through many templates.
 *
 * The point of the corpus is ground truth: because every document is generated
 * from this object, the correct extraction is known in advance. A template can
 * then be judged by whether the pipeline recovers this structure from it,
 * rather than by someone reading the output and deciding it looks right.
 */

export type CorpusEntry = {
  left: string;
  right: string;
  subLeft?: string;
  subRight?: string;
  bullets: string[];
};

export type CorpusSection = {
  heading: string;
  entries?: CorpusEntry[];
  paragraphs?: string[];
  /** "Label: value" lines, as skills sections are usually written. */
  labelled?: { label: string; value: string }[];
};

export type CorpusCv = {
  name: string;
  subtitle?: string;
  contact: string[];
  sections: CorpusSection[];
};

export const CV: CorpusCv = {
  name: "Morgan Whitfield",
  subtitle: "Backend Engineer",
  contact: [
    "Dublin, Ireland",
    "+353 87 111 2222",
    "morgan.whitfield@example.com",
    "linkedin.com/in/morganwhitfield",
  ],
  sections: [
    {
      heading: "Professional Summary",
      paragraphs: [
        "Backend engineer with six years building payment and reporting services. Comfortable owning a service end to end, from design through on-call. Interested in systems that stay understandable as they grow.",
      ],
    },
    {
      heading: "Professional Experience",
      entries: [
        {
          left: "Senior Backend Engineer",
          right: "Mar 2022 – Present",
          subLeft: "Kestrel Payments",
          subRight: "Dublin, Ireland",
          bullets: [
            "Designed and operated the settlement service handling twelve million transactions each month, owning its on-call rotation.",
            "Reduced median reconciliation latency from four hours to eleven minutes by replacing a nightly batch with an event stream.",
            "Mentored three engineers and introduced the weekly design review that the platform group still runs.",
          ],
        },
        {
          left: "Backend Engineer",
          right: "Jul 2019 – Feb 2022",
          subLeft: "Harbour Analytics",
          subRight: "Cork, Ireland",
          bullets: [
            "Built ingestion pipelines in Python for third-party marketing data, growing from six sources to forty.",
            "Split a Django monolith into four deployable services without a customer-visible outage.",
          ],
        },
      ],
    },
    {
      heading: "Education",
      entries: [
        {
          left: "MSc Computer Science",
          right: "Expected 09/2026",
          subLeft: "Trinity College Dublin",
          subRight: "GPA: 3.7/4",
          bullets: [],
        },
        {
          left: "BSc Software Engineering",
          right: "Graduated 06/2019",
          subLeft: "University College Cork",
          subRight: "First Class Honours",
          bullets: [],
        },
      ],
    },
    {
      heading: "Technical Skills",
      labelled: [
        { label: "Languages", value: "Python, Go, TypeScript, SQL" },
        { label: "Infrastructure", value: "Kubernetes, Docker, Terraform, AWS" },
        { label: "Data", value: "PostgreSQL, Kafka, Redis, Snowflake" },
      ],
    },
  ],
};

/** Every bullet in the CV, for coverage assertions. */
export function allBullets(cv: CorpusCv = CV): string[] {
  return cv.sections.flatMap((s) => (s.entries ?? []).flatMap((e) => e.bullets));
}

/** Every title/date row, including sub-rows. */
export function allEntryRows(
  cv: CorpusCv = CV,
): { left: string; right: string }[] {
  const rows: { left: string; right: string }[] = [];
  for (const s of cv.sections)
    for (const e of s.entries ?? []) {
      rows.push({ left: e.left, right: e.right });
      if (e.subLeft && e.subRight)
        rows.push({ left: e.subLeft, right: e.subRight });
    }
  return rows;
}
