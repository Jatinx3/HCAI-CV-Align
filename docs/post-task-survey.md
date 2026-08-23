# Post-Task Survey — build sheet for Microsoft Forms

Derived from `Data_Collection_Instruments.docx` (May 2026), section A.

**What changed and why.** The approved instrument is written for one tool: every
item says "the AI assistant" or "the tool", singular. The study is
within-subjects — each participant uses both the one-click baseline and the
review mode — so a single set of answers cannot say which arm produced them, and
the comparison the thesis is built on could not be computed. Each construct is
therefore asked twice, once per mode, with **identical wording in both blocks**
so the pair is directly comparable.

The item wording changed in three places, for the same reason. "I was able to
accept, modify, or reject suggestions easily" and "The explanations provided for
each suggestion were helpful" describe features only the review mode has. Asked
about the baseline they are unanswerable — a participant cannot say whether
absent explanations were helpful, and a low score would conflate *absent* with
*unhelpful*. Both are reworded to describe the outcome rather than the
mechanism, so they mean something in both arms and the baseline's low score is a
finding rather than an artefact.

**This is a change to an approved instrument.** Confirm it with your supervisor,
and check whether your ethics approval covers it, before collecting data.

Scale for all Likert items: **1 = Strongly Disagree … 5 = Strongly Agree.**

---

## Q1 — Participant code

**Type:** Short answer · **Required** · First question in the form.

> Enter the 6-character code shown on screen at the end of your session.

Help text:

> It looks like `K3F9QT`. This is the only thing that links your answers to what
> the tool recorded, and it is not linked to your name.

This is the join key. `npm run export-study` writes the same value as
`participant_code` in every CSV. Without it the survey and the behavioural data
cannot be matched, and the session is unusable.

---

## Section A — The **One-click rewrite** version

Introduce the section with:

> These questions are about the version that rewrote your whole CV in one step
> and downloaded it straight away.

| ID | Item |
| --- | --- |
| A-T1 | I trusted this version to provide reliable suggestions. |
| A-T2 | I felt confident that the changes were appropriate for the job description. |
| A-T3 | I would rely on this version when applying for a real job. |
| A-C1 | I felt in control of the editing process. |
| A-C2 | I could decide which individual changes were made to my CV. |
| A-C3 | This version gave me enough options to make my own decisions. |
| A-U1 | The changes improved my CV. |
| A-U2 | I understood why each change had been made. |
| A-U3 | I would use this version again in the future. |
| A-A1 | The final CV still felt like it represented me accurately. |
| A-A2 | I did not feel pressured to include content that was not true. |
| A-A3 | This version respected the content I originally wrote. |

## Section B — The **Review each change** version

Introduce the section with:

> These questions are about the version that showed you each proposed change
> with a reason, and let you accept, edit or reject it.

| ID | Item |
| --- | --- |
| B-T1 | I trusted this version to provide reliable suggestions. |
| B-T2 | I felt confident that the changes were appropriate for the job description. |
| B-T3 | I would rely on this version when applying for a real job. |
| B-C1 | I felt in control of the editing process. |
| B-C2 | I could decide which individual changes were made to my CV. |
| B-C3 | This version gave me enough options to make my own decisions. |
| B-U1 | The changes improved my CV. |
| B-U2 | I understood why each change had been made. |
| B-U3 | I would use this version again in the future. |
| B-A1 | The final CV still felt like it represented me accurately. |
| B-A2 | I did not feel pressured to include content that was not true. |
| B-A3 | This version respected the content I originally wrote. |

`T` trust, `C` perceived control, `U` perceived usefulness, `A` authenticity —
the four constructs from the approved instrument, unchanged. Three items each
keeps every construct scoreable on its own and lets you report a reliability
figure per construct per arm.

---

## Q26 — Forced choice

**Type:** Choice · **Required** · Two options, no neutral.

> If you were applying for a real job tomorrow, which version would you use?

- `One-click rewrite`
- `Review each change`

The two labels must match exactly what participants saw on screen. The app
records the same choice locally as `ONE_CLICK` / `HUMAN_CENTERED`, so the form
answer can be checked against `local_preference` in `sessions.csv` — two
independent records of the same decision.

No neutral option on purpose. A midpoint here collects the participants who
would rather not choose, and the comparison is the study.

---

## Q27–Q30 — Open-ended

**Type:** Long answer · Optional.

| ID | Item |
| --- | --- |
| O1 | What did you find most useful about the assistant? |
| O2 | What did you find most problematic or frustrating? |
| O3 | Is there anything you would change about how the tool works? |
| O4 | You used two versions. What made you prefer the one you chose? |

O1–O3 are the approved wording, unchanged. O4 is added because the forced choice
records *what* they picked and nothing about *why*, and the interview guide's
comparison theme only reaches the participants you interview.

---

## Building it in Microsoft Forms

**Pre-filling the code.** Forms can generate a link with an answer already
filled. Create the form, use *Collect responses → Get pre-filled link*, put any
value in Q1, and copy the resulting URL. Replace that value with `{code}` and
give the whole URL to the app:

```
STUDY_FEEDBACK_FORM_URL=https://forms.office.com/…&r1b2c3=%7Bcode%7D
```

The app substitutes the real code per participant, so nobody has to type it.
Leave the placeholder out and the app falls back to showing the code on screen
for them to copy — which works, but is one more thing to get wrong at the end of
a session.

**Settings.** Accept anonymous responses — do not require a sign-in, or the form
records TU Dublin identities against answers you promised were pseudonymous. One
response per person should be **off**: it is enforced by sign-in, which you are
not using.

**Order.** Q1 first, always. Sections A and B in a fixed order for everyone,
which is not the order participants used the tools in — that is recorded
separately as `chosen_first` in `sessions.csv`, and the analysis reads it from
there rather than from the form.
