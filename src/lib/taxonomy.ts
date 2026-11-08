// Digital SAT content domains & skills, plus an automatic tagger for imported questions.
import type { Question, SectionKind } from './types';

export const DOMAINS: Record<SectionKind, { name: string; share: string; skills: string[] }[]> = {
  rw: [
    {
      name: 'Information and Ideas',
      share: '≈26%',
      skills: ['Central Ideas and Details', 'Command of Evidence', 'Inferences'],
    },
    {
      name: 'Craft and Structure',
      share: '≈28%',
      skills: ['Words in Context', 'Text Structure and Purpose', 'Cross-Text Connections'],
    },
    {
      name: 'Expression of Ideas',
      share: '≈20%',
      skills: ['Rhetorical Synthesis', 'Transitions'],
    },
    {
      name: 'Standard English Conventions',
      share: '≈26%',
      skills: ['Boundaries', 'Form, Structure, and Sense'],
    },
  ],
  math: [
    {
      name: 'Algebra',
      share: '≈35%',
      skills: [
        'Linear equations in one variable',
        'Linear functions',
        'Linear equations in two variables',
        'Systems of linear equations',
        'Linear inequalities',
      ],
    },
    {
      name: 'Advanced Math',
      share: '≈35%',
      skills: ['Equivalent expressions', 'Nonlinear equations and systems', 'Nonlinear functions'],
    },
    {
      name: 'Problem-Solving and Data Analysis',
      share: '≈15%',
      skills: [
        'Ratios, rates, and units',
        'Percentages',
        'One-variable data',
        'Two-variable data',
        'Probability',
        'Sample statistics and margin of error',
        'Evaluating statistical claims',
      ],
    },
    {
      name: 'Geometry and Trigonometry',
      share: '≈15%',
      skills: ['Area and volume', 'Lines, angles, and triangles', 'Right triangles and trigonometry', 'Circles'],
    },
  ],
};

export function domainOfSkill(kind: SectionKind, skill?: string): string | undefined {
  if (!skill) return undefined;
  return DOMAINS[kind].find((d) => d.skills.includes(skill))?.name;
}

const has = (s: string, re: RegExp) => re.test(s);

/** Best-effort guess of domain + skill from the question wording. */
export function classify(kind: SectionKind, q: Pick<Question, 'prompt' | 'passage' | 'choices' | 'type'>): {
  domain: string;
  skill: string;
} {
  const p = (q.prompt || '').toLowerCase();
  const all = `${q.passage || ''} ${q.prompt || ''} ${q.choices.map((c) => c.text).join(' ')}`.toLowerCase();

  if (kind === 'rw') {
    const pick = (skill: string) => ({ skill, domain: domainOfSkill('rw', skill)! });
    if (has(p, /conventions of standard english|standard english/)) {
      // Boundaries = punctuation between clauses; otherwise grammar/usage
      const punct = q.choices.filter((c) => /[;:,—–.]|\bdash\b/.test(c.text)).length;
      const choiceWords = q.choices.map((c) => c.text.replace(/[^a-z ]/gi, '').trim().toLowerCase());
      const sameWords = new Set(choiceWords).size <= 2;
      return pick(punct >= 2 && sameWords ? 'Boundaries' : punct >= 3 ? 'Boundaries' : 'Form, Structure, and Sense');
    }
    if (has(p, /logical transition|most logical transition/)) return pick('Transitions');
    if (has(p, /student wants to|notes|uses relevant information/)) return pick('Rhetorical Synthesis');
    if (has(p, /logical and precise word|precise word or phrase|as used in the text|most nearly mean/)) return pick('Words in Context');
    if (has(all, /text 1/) && has(all, /text 2/)) return pick('Cross-Text Connections');
    if (has(p, /main purpose|overall structure|function of the underlined|best describes the function|primarily/)) return pick('Text Structure and Purpose');
    if (has(p, /main idea|central idea|best states|according to the text|based on the text, what|best describes/)) return pick('Central Ideas and Details');
    if (has(p, /quotation|illustrate the claim|support the|finding|data|table|graph|weaken|undermine|chart/)) return pick('Command of Evidence');
    if (has(p, /most logically completes|logically completes/)) return pick('Inferences');
    return pick('Central Ideas and Details');
  }

  const pick = (skill: string) => ({ skill, domain: domainOfSkill('math', skill)! });
  if (has(all, /circle|radius|diameter|arc|circumference|\(x\s*-\s*\d+\)\^2\s*\+\s*\(y/)) return pick('Circles');
  if (has(all, /\bsin\b|\bcos\b|\btan\b|sine|cosine|tangent|hypotenuse|right triangle|radians?/)) return pick('Right triangles and trigonometry');
  if (has(all, /volume|surface area|cube|cylinder|sphere|cone|prism|area of/)) return pick('Area and volume');
  if (has(all, /triangle|angle|parallel|perpendicular lines|degrees|polygon|congruent|similar/)) return pick('Lines, angles, and triangles');
  if (has(all, /probability|at random|chance/)) return pick('Probability');
  if (has(all, /margin of error|sample|survey|random(ly)? selected/)) return pick('Sample statistics and margin of error');
  if (has(all, /percent|%/)) return pick('Percentages');
  if (has(all, /\bmean\b|median|mode|standard deviation|range of|average|outlier/)) return pick('One-variable data');
  if (has(all, /scatterplot|line of best fit|bivariate/)) return pick('Two-variable data');
  if (has(all, /ratio|rate|per hour|per minute|miles|unit|proportion|convert/)) return pick('Ratios, rates, and units');
  if (has(all, /\^\s*[2-9]|squared|quadratic|parabola|vertex|exponential|polynomial|zeros?\b|x\^|√|sqrt|\\sqrt|\\frac\{[^}]*x/)) {
    if (has(p, /equivalent|which expression/)) return pick('Equivalent expressions');
    if (has(all, /f\(x\)|g\(x\)|function|graph/)) return pick('Nonlinear functions');
    return pick('Nonlinear equations and systems');
  }
  if (has(all, /system of|solution \(x, y\)|\(x,\s*y\)|intersect/)) return pick('Systems of linear equations');
  if (has(all, /inequalit|<|>|≤|≥|\\le|\\ge|at least|at most/)) return pick('Linear inequalities');
  if (has(all, /f\(x\)|function|slope|y-intercept|linear relationship/)) return pick('Linear functions');
  if (has(all, /\by\b/) && has(all, /\bx\b/)) return pick('Linear equations in two variables');
  return pick('Linear equations in one variable');
}

export function ensureTags(kind: SectionKind, q: Question): Question {
  if (q.domain && q.skill) return q;
  const c = classify(kind, q);
  return { ...q, domain: q.domain || c.domain, skill: q.skill || c.skill };
}
