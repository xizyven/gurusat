// Core data model for GuruSat.

export type SectionKind = 'rw' | 'math';
export type QuestionType = 'mcq' | 'spr';
export type Difficulty = 'easy' | 'medium' | 'hard';
/** standard = the only module 2; harder/easier = adaptive variants of module 2 */
export type ModuleVariant = 'standard' | 'harder' | 'easier';

export interface Choice {
  id: string;
  /** markup (supports $math$, **bold**, images) — may be empty for image-only questions */
  text: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  /** Left-pane text (RW passage / notes / tables) — markup */
  passage?: string;
  /** The actual question stem — markup */
  prompt: string;
  /** Optional figure (data URL or relative URL) */
  image?: string;
  /** Where the figure goes: in the passage pane (RW default) or with the question */
  imagePlacement?: 'passage' | 'question';
  choices: Choice[];
  /** mcq: "A".."D". spr: first accepted answer (see answers) */
  answer: string;
  /** spr: every accepted answer, e.g. ["7/2", "3.5"] */
  answers?: string[];
  explanation?: string;
  domain?: string;
  skill?: string;
  difficulty?: Difficulty;
}

export interface Module {
  id: string;
  /** 1 or 2 */
  stage: 1 | 2;
  variant: ModuleVariant;
  minutes: number;
  questions: Question[];
}

export interface Section {
  id: string;
  kind: SectionKind;
  modules: Module[];
}

export interface Test {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  sections: Section[];
  /** minutes of break between the RW and Math sections */
  breakMinutes: number;
  /** module-1 accuracy needed to be routed to the harder module 2 (0..1) */
  routingThreshold: number;
  /** true for the sample tests that ship with the app */
  builtIn?: boolean;
  source?: string;
  /** AI-built tests stay sealed (answers hidden) until you have taken them */
  sealed?: boolean;
  aiCostUsd?: number;
}

// ───────────────────────── Attempts ─────────────────────────

export type TimingMode = 'standard' | 'x1.5' | 'x2' | 'untimed';

export interface Response {
  answer?: string;
  /** first answer ever chosen — used to detect right→wrong changes */
  firstAnswer?: string;
  changes: number;
  marked: boolean;
  crossed: string[];
  timeMs: number;
  visits: number;
}

export interface Highlight {
  id: string;
  root: 'passage' | 'prompt';
  start: number;
  end: number;
  color: 'yellow' | 'blue' | 'pink';
  underline?: boolean;
  note?: string;
}

/** One module that is (or will be) taken during the attempt */
export interface Stage {
  sectionId: string;
  kind: SectionKind;
  sectionIndex: number;
  stage: 1 | 2;
  /** resolved module id — module 2 is resolved when module 1 ends */
  moduleId?: string;
}

export type Phase = 'intro' | 'module' | 'review' | 'transition' | 'break' | 'done';

export interface MistakeNote {
  tags: string[];
  text: string;
  mastered?: boolean;
}

export interface Attempt {
  id: string;
  testId: string;
  testTitle: string;
  /** frozen copy of the test so edits/deletes never break old results */
  test: Test;
  kind: 'full' | 'practice';
  timing: TimingMode;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  status: 'active' | 'completed';
  stages: Stage[];
  stageIndex: number;
  phase: Phase;
  qIndex: number;
  /** ms left in the current module (or elapsed when untimed) */
  remainingMs: number;
  breakRemainingMs?: number;
  responses: Record<string, Response>;
  highlights: Record<string, Highlight[]>;
  /** per-question notes the student writes while reviewing */
  notes: Record<string, MistakeNote>;
  result?: AttemptResult;
}

// ───────────────────────── Results ─────────────────────────

export interface SectionScore {
  kind: SectionKind;
  score: number;
  low: number;
  high: number;
  correct: number;
  total: number;
  percentile: number;
  route: ModuleVariant;
}

export interface AttemptResult {
  total?: number;
  totalLow?: number;
  totalHigh?: number;
  totalPercentile?: number;
  sections: SectionScore[];
  correct: number;
  incorrect: number;
  omitted: number;
  /** questions shown but not scored (no answer key) */
  unscored?: number;
  questionCount: number;
  timeMs: number;
}

export interface Settings {
  name: string;
  testDate: string; // yyyy-mm-dd
  targetScore: number;
  classicTheme: boolean; // Bluebook "test-day blue" interface
  defaultTiming: TimingMode;
  onboarded: boolean;
  /** Anthropic API key for the AI mock builder — stored only in this browser */
  apiKey: string;
  aiEffort: 'medium' | 'high' | 'max';
}
