# Post-Task Survey — build sheet for Microsoft Forms

Derived from `Data_Collection_Instruments.docx` (May 2026), section A, and from
the VSD values in [`src/lib/values.ts`](../src/lib/values.ts).

Six questions in Forms. Ten Likert items in two grids.

## What changed, and why

**The approved instrument measures one tool.** Every item says "the AI
assistant" or "the tool", singular. The study is within-subjects — each
participant uses the one-click baseline *and* the review mode — so a single set
of answers cannot say which arm produced them, and the comparison the thesis
rests on could not be computed from it. Each item is therefore asked twice, with
**identical wording in both grids**, so the pair is directly comparable.

**Transparency was not measured at all.** It is the value the prototype makes
its loudest claim about — every suggestion carries a chip and the review screen
carries a legend explaining it — and the instrument had no construct for it. The
closest item, "the explanations provided for each suggestion were helpful", asks
whether explanations were *liked*, not whether they made the reasoning
*visible*, and it is unanswerable for a baseline that has none. Transparency is
now a construct of its own.

**One item per value instead of three.** Ten Likert rows rather than the
twenty-four a full three-item battery over two arms would need. The cost is
stated under *Limitations* below.

**Perceived usefulness is gone as a separate construct.** It is a TAM construct
that was sitting alongside four VSD values it does not belong with. Whether the
tool was workable is covered by usability; whether it helped is what the forced
choice and the interview measure.

## The five items

One per design value, each worded as the participant-facing test of that value's
claim — so the survey asks whether people perceived what the interface promised.

| Value | Claim made in the app | Survey item |
| --- | --- | --- |
| Transparency | You can see why every change is proposed | I could see why each change was being proposed. |
| User control | Every change is yours to accept, edit, reject, or undo | I decided which changes were made to my CV. |
| Authenticity | The assistant may only rework what your CV already says | The final CV still represented me accurately. |
| Usability | The work should be readable and never leave you stuck | This version was clear to use, and I always knew what to do next. |
| Trust | *no feature of its own — expected to follow from the other four* | I would rely on this version when applying for a real job. |

All five are answerable for both versions, which is what keeps the pair
comparable. The baseline scoring low on transparency and control is then a
finding about the design rather than an artefact of an unanswerable question.

Row order is identical in both grids, and it is the order the values appear in
the app: transparency, control, authenticity, usability, trust.

## The form

Scale on both grids: **1 = Strongly Disagree … 5 = Strongly Agree.**

| Q | Type | Content |
| --- | --- | --- |
| 1 | Short answer, **required** | Enter the 6-character code shown on screen at the end of your session (for example `K3F9QT`). |
| 2 | Likert, 5 rows | Section A — the **One-click rewrite** version |
| 3 | Likert, 5 rows | Section B — the **Review each change** version |
| 4 | Choice, **required** | If you were applying for a real job tomorrow, which version would you use? — `One-click rewrite` / `Review each change` |
| 5 | Long answer | You used two versions. What made you prefer the one you chose? |
| 6 | Long answer | What did you find most problematic or frustrating? |

Section A description: *These questions are about the version that rewrote your
whole CV in one step and downloaded it straight away.*

Section B description: *These questions are about the version that showed you
each proposed change with a reason, and let you accept, edit or reject it.*

No neutral option on Q4, deliberately. A midpoint collects the participants who
would rather not choose, and the choice is the study. The two labels must match
what participants saw on screen; the app records the same decision as
`ONE_CLICK` / `HUMAN_CENTERED`, so the form answer can be checked against
`local_preference` in `sessions.csv`.

## Limitations to state in Chapter 3

Each construct has **one item**, so there is no internal reliability to report —
a single item has nothing to correlate with, so no Cronbach's alpha. With twenty
participants an alpha would have been unstable regardless, and this is an
exploratory comparison rather than a psychometric validation. If reliability is
wanted, the fix is a second item per value, which takes the form back to twenty
Likert rows.

Two open-ended items were dropped ("most useful", "anything you would change").
The interview guide covers both in more depth; the two kept here are the ones
that support the forced choice.

**This is a change to an approved instrument.** Confirm it with your supervisor,
and check your ethics approval covers it, before collecting data.

## Building it

Use the **Likert** question type — *Add question → "…" → Likert* — not
individual choice questions. One Likert question holds all five statements
against one shared scale, so participants see the scale twice rather than ten
times. Quick Import cannot produce Likert grids; it only makes separate radio
questions, which is what made the first attempt so long.

**Pre-filling the code.** *Collect responses → Get pre-filled link*, put any
value in Q1, copy the URL, then replace that value with `{code}`:

```
STUDY_FEEDBACK_FORM_URL=https://forms.office.com/…&r1b2c3=%7Bcode%7D
```

The app substitutes each participant's real code, so nobody types anything.

**Settings.** Accept anonymous responses — requiring a sign-in records TU Dublin
identities against answers you promised were pseudonymous. Leave "one response
per person" off; it is enforced by sign-in, which you are not using.

**Order.** Q1 first, always. Sections A and B in a fixed order for everyone,
which will not match the order participants used the tools in — that is recorded
separately as `chosen_first` in `sessions.csv`, and the analysis reads it there.
