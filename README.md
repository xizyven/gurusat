<p align="center">
  <img src="public/brand/wordmark.png" alt="GuruSat" width="280">
</p>

<p align="center"><b>Your own Bluebook-style digital SAT practice room.</b><br>
Upload your teacher's mock tests, take them in a test-day interface, and get a realistic score with a full question-by-question analysis.</p>

---

## What's inside

**A test screen that feels like test day**
- Section / module header, countdown timer (hide/show, 5-minute warning), Directions panel
- Reading & Writing split view with a draggable divider and expand buttons
- Mark for Review, the ABC answer-eliminator, Highlights & Notes (3 colors, underline, notes)
- Math: Desmos graphing + scientific calculator, a reference sheet, grid-in answers with the real input rules and an Answer Preview
- Question navigator, "Check Your Work" page, module transitions, and the break between sections
- Adaptive Module 2: add a *harder* and an *easier* Module 2, and Module 1 decides where you go
- Line reader, keyboard shortcuts (press `?` during a test), standard / 1.5× / 2× / untimed modes
- Auto-save: refresh or close the tab and pick up exactly where you left off

**Realistic scores**
- 400–1600 total and 200–800 section scores from conversion curves modeled on the official Bluebook practice tests
- Score range and approximate percentile, difficulty weighting when questions are tagged, and the score cap that comes with the easier Module 2

**Analysis**
- Score report with *Knowledge and Skills* bars for every SAT content domain
- Pacing chart (time per question vs. target pace), automatic insights (time sinks, rushed endings, answer changes)
- Review every question in the test layout: your answer vs. the correct one, the explanation, time spent, and your highlights
- Mistake Notebook: every missed question across all tests, tag *why* you missed it, retry them as a practice set

## Adding a test

Go to **Add a Test** and pick a method:

| Method | Best for |
|---|---|
| **Paste text** | Copy everything from the teacher's PDF / Word file and paste. |
| **Upload a PDF** | Text PDFs are read automatically. Crop graphs straight from the pages. |
| **Screenshots** | Scanned PDFs or anything tricky. Snip each question (`Win + Shift + S`) and paste with `Ctrl + V`. |
| **GuruSat file** | A `.json` test or a backup from another device. |

The text reader understands:

```
Reading and Writing — Module 1          ← section / module headers

1                                         ← question numbers ("1", "1.", "1)", "Question 1")
The passage text … ______ …
Which choice completes the text with the most logical and precise word or phrase?
A) first choice                           ← "A)", "A.", "(A)" — or all four on one line
B) second choice
C) third choice
D) fourth choice
Answer: B                                 ← optional inline answer
Explanation: …                            ← optional

Math — Module 1
1. If 3x + 5 = 20, what is x?
2. What is 2/5 + 1/10?                    ← no choices → grid-in question

Answer Key                                ← optional key at the end
Reading and Writing Module 1: 1. B  2. D
Math Module 1: 1. 5  2. 1/2
```

After importing, the **editor** shows a live preview of every question. Use **Answer key** to type a whole module's answers at once (`B D A C 7/2 …`).

### Formatting inside questions

`**bold**` · `*italic*` · `__underlined__` · `______` (blank) · `$x^2$` (math via KaTeX) · `\$5` (a literal dollar sign) · lines starting with `- ` make a list · `| a | b |` makes a table.

### JSON test format

```jsonc
{
  "title": "Mock Test 1",
  "breakMinutes": 10,
  "routingThreshold": 0.6,          // Module-1 accuracy needed for the harder Module 2
  "sections": [
    {
      "kind": "rw",                 // "rw" or "math"
      "modules": [
        {
          "stage": 1,               // 1 or 2
          "variant": "standard",    // "standard" | "harder" | "easier"
          "minutes": 32,
          "questions": [
            {
              "type": "mcq",        // "mcq" or "spr" (grid-in)
              "passage": "…",
              "prompt": "Which choice …?",
              "choices": [{ "text": "…" }, { "text": "…" }, { "text": "…" }, { "text": "…" }],
              "answer": "B",        // grid-ins: "answers": ["7/2", "3.5"]
              "explanation": "…",
              "skill": "Words in Context",
              "difficulty": "medium"
            }
          ]
        }
      ]
    }
  ]
}
```

See [`public/tests/demo.json`](public/tests/demo.json) for a complete example.

## Privacy

Everything you add — tests, answers, results, notes — is stored **only in your browser** (IndexedDB). Nothing is uploaded, and this repository contains only the app and an original demo test. To move to another device, use **Settings → Download a backup**, then **Restore** it there.

## Notes

- Scores are estimates. The real SAT uses item response theory and each form has its own scale, so expect your official score to land within the shown range.
- The calculator uses the free Desmos API demo key, which shows a small "Trial Key" badge you can close.
- GuruSat is an independent study tool. It is not affiliated with or endorsed by College Board. SAT® and Bluebook™ are trademarks of College Board.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

```bash
npm run deploy   # build and publish to GitHub Pages (the gh-pages branch)
```
