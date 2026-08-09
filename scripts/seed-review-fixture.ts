/**
 * Dev fixture: create a CV document + a human-centered ModeStep for the test
 * account, and print the /review URL. Used to exercise the review screen
 * without driving a file upload through the browser.
 *
 *   npx tsx scripts/seed-review-fixture.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CV = `Alex Rivera
alex.rivera@example.com | Dublin, Ireland

PROFESSIONAL SUMMARY
Backend developer with five years building web services. Comfortable owning
features from design through release. Interested in reliable systems and clear
interfaces between teams.

EXPERIENCE
Senior Developer, Meridian Systems (2021-present)
Built and maintained REST services used by the customer billing platform.
Worked with the data team to move reporting jobs onto a scheduled pipeline.
Mentored two junior developers and ran the weekly code review session.

Developer, Fathom Analytics (2019-2021)
Wrote Python services for ingesting third-party marketing data.
Helped migrate a monolithic Django app towards smaller deployable services.

SKILLS
Python, Go, PostgreSQL, Docker, REST APIs, Git, Linux

EDUCATION
BSc Computer Science, University College Dublin (2019)`;

const JD = `Senior Backend Engineer

We are looking for a senior backend engineer to join our platform team.

Responsibilities:
- Design, build and operate distributed backend services at scale
- Own services end to end, including on-call and production reliability
- Work closely with product and data teams to define APIs
- Mentor engineers and raise the technical bar across the team

Requirements:
- Strong experience with Go or Python in production
- Experience with Kubernetes and containerised deployments
- Solid grounding in relational databases, especially PostgreSQL
- Experience designing and documenting REST or gRPC APIs
- Track record of mentoring and code review
- Familiarity with observability tooling such as Prometheus and Grafana
- AWS experience preferred`;

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "test@study.local" },
  });
  if (!user) throw new Error("test@study.local not provisioned");

  const doc = await prisma.cvDocument.create({
    data: {
      userId: user.id,
      fileName: "alex-rivera-cv.pdf",
      format: "pdf",
      data: Buffer.from(CV, "utf-8"),
      extractedText: CV,
    },
  });

  const step = await prisma.modeStep.create({
    data: {
      userId: user.id,
      mode: "HUMAN_CENTERED",
      cvDocumentId: doc.id,
      cvFileName: doc.fileName,
      cvFormat: doc.format,
      jdText: JD,
    },
  });

  console.log(`http://localhost:3000/review/${step.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
