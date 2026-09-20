/**
 * The scheduler. One prompt at a time, never during a telegraph, gone the moment the player
 * does the thing (docs/design/ONBOARDING.md §3, §5).
 *
 * Every tick:
 *   1. retire every lesson whose `satisfied` fact is now true — prompted or not. Each of
 *      those facts is a positive statement about something the player did, and starts false,
 *      so "already did it unprompted" is the same code path as "did it because we asked".
 *   2. drop the active prompt if it is satisfied, expired, no longer triggered, or blocked;
 *   3. if nothing is showing, the cooldown has passed and nothing is covering the stage,
 *      take the highest-priority lesson that is triggered and not retired.
 *
 * Nothing here touches the DOM, `window` or React. The caller assembles the context.
 */
import { LESSON_BY_ID, LESSONS } from './lessons';
import { emptyState, type OnboardingState } from './localStore';
import type { ActivePrompt, FieldNote, Lesson, LessonContext, OnboardingView } from './types';

/** Quiet gap between one prompt leaving and the next arriving. Two lines at once read as noise. */
export const PROMPT_COOLDOWN_MS = 900;
/**
 * A prompt cut off before this has not been read, so it is put back in the queue rather than
 * counted as taught. Combat interrupts constantly; a line that flashed for a second and was
 * then retired forever would be worse than no line.
 */
export const MIN_VISIBLE_MS = 1800;
/** How many times one lesson may be interrupted before we stop trying. */
const MAX_INTERRUPTIONS = 3;

export interface EngineOptions {
  state?: OnboardingState;
  /** Called whenever the persisted half of the state changes. */
  onPersist?: (state: OnboardingState) => void;
  /** Called whenever the visible half changes. */
  onView?: (view: OnboardingView) => void;
}

export class OnboardingEngine {
  private state: OnboardingState;
  private prompt: ActivePrompt | null = null;
  /** Shown this run, so a `run`-scoped lesson does not repeat inside one expedition. */
  private shownThisRun = new Set<string>();
  private runId = '';
  private nextAllowedMs = 0;
  private sessionOff = false;
  private interruptions = new Map<string, number>();

  constructor(private readonly options: EngineOptions = {}) {
    this.state = options.state ?? emptyState();
  }

  getView(): OnboardingView {
    return { prompt: this.hintsOff() ? null : this.prompt, notes: this.state.notes, hintsOff: this.hintsOff() };
  }

  getState(): OnboardingState {
    return this.state;
  }

  hintsOff(): boolean {
    return this.sessionOff || this.state.off;
  }

  /** `?hints=off` for a clean capture. The menu page uses `setHintsOff`, which persists. */
  setSessionOff(off: boolean): void {
    this.sessionOff = off;
    if (off) this.prompt = null;
    this.publishView();
  }

  setHintsOff(off: boolean): void {
    this.state = { ...this.state, off };
    if (off) this.prompt = null;
    this.persist();
    this.publishView();
  }

  /** `?hints=reset`, and the Field Notes button. Forgets every hint and every note. */
  reset(): void {
    this.state = emptyState();
    this.prompt = null;
    this.shownThisRun.clear();
    this.interruptions.clear();
    this.nextAllowedMs = 0;
    this.persist();
    this.publishView();
  }

  tick(ctx: LessonContext): void {
    if (ctx.facts.runId !== this.runId) {
      this.runId = ctx.facts.runId;
      this.shownThisRun.clear();
      this.prompt = null;
    }

    const promptBefore = this.prompt;
    const notesBefore = this.state.notes.length;
    let persistNeeded = false;

    // 1. Retire everything the player has already done, whether or not we ever asked.
    for (const lesson of LESSONS) {
      if (!lesson.satisfied || this.state.satisfied[lesson.id] !== undefined) continue;
      if (!lesson.satisfied(ctx)) continue;
      this.state = { ...this.state, satisfied: { ...this.state.satisfied, [lesson.id]: ctx.nowMs } };
      persistNeeded = true;
    }

    // 2. The active prompt.
    if (this.prompt) {
      const lesson = LESSON_BY_ID.get(this.prompt.id);
      const done = this.state.satisfied[this.prompt.id] !== undefined;
      const cut = ctx.blocked || !lesson || !lesson.trigger(ctx);
      if (done || cut || ctx.nowMs >= this.prompt.expiresAtMs) {
        // A line that flashed for a second was not read. Put it back rather than call it taught.
        if (!done && cut && ctx.nowMs - this.prompt.shownAtMs < MIN_VISIBLE_MS) this.requeue(this.prompt.id);
        this.prompt = null;
        this.nextAllowedMs = ctx.nowMs + PROMPT_COOLDOWN_MS;
      }
    }

    // 3. Pick the next one. A strictly higher priority preempts whatever is on screen and
    // skips the cooldown: a downed teammate cannot wait behind a note about rubble. Nothing
    // flaps, because showing a lesson retires it immediately.
    if (!this.hintsOff() && !ctx.blocked) {
      const ready = this.pick(ctx);
      if (ready && (!this.prompt ? ctx.nowMs >= this.nextAllowedMs : ready.lesson.priority > (LESSON_BY_ID.get(this.prompt.id)?.priority ?? 0))) {
        this.show(ready, ctx);
      }
    }

    if (persistNeeded) this.persist();
    if (promptBefore !== this.prompt || this.state.notes.length !== notesBefore) this.publishView();
  }

  // ---- internals -------------------------------------------------------------------

  /** Put an interrupted lesson back in the running. The Field Notes entry stays: it was shown. */
  private requeue(id: string): void {
    const count = (this.interruptions.get(id) ?? 0) + 1;
    this.interruptions.set(id, count);
    if (count > MAX_INTERRUPTIONS) return;
    this.shownThisRun.delete(id);
    const seen = { ...this.state.seen };
    delete seen[id];
    this.state = { ...this.state, seen };
    this.persist();
  }

  private retired(lesson: Lesson): boolean {
    if (this.state.satisfied[lesson.id] !== undefined) return true;
    if (lesson.scope === 'device' || lesson.silent === true) return this.state.seen[lesson.id] !== undefined;
    return this.shownThisRun.has(lesson.id);
  }

  /**
   * The highest-priority lesson that is triggered and not retired. Silent lessons never win:
   * they are written into Field Notes here and drop out of the running.
   */
  private pick(ctx: LessonContext): { lesson: Lesson; text: string } | null {
    let best: { lesson: Lesson; text: string } | null = null;
    for (const lesson of LESSONS) {
      if (this.retired(lesson) || !lesson.trigger(ctx)) continue;
      const text = typeof lesson.text === 'function' ? lesson.text(ctx) : lesson.text;
      if (!text) continue;
      if (lesson.silent) {
        this.record(lesson, text, ctx.nowMs);
        continue;
      }
      if (!best || lesson.priority > best.lesson.priority) best = { lesson, text };
    }
    return best;
  }

  private show({ lesson, text }: { lesson: Lesson; text: string }, ctx: LessonContext): void {
    this.prompt = {
      id: lesson.id,
      group: lesson.group,
      keys: lesson.keys ?? [],
      text,
      shownAtMs: ctx.nowMs,
      expiresAtMs: ctx.nowMs + lesson.holdMs,
    };
    this.shownThisRun.add(lesson.id);
    this.record(lesson, text, ctx.nowMs);
  }

  /** Write the line into this device's Field Notes, once, and remember that it was shown. */
  private record(lesson: Lesson, text: string, nowMs: number): void {
    const seen = { ...this.state.seen, [lesson.id]: nowMs };
    const notes = this.state.notes.some((note) => note.id === lesson.id)
      ? this.state.notes
      : [...this.state.notes, { id: lesson.id, group: lesson.group, keys: lesson.keys ?? [], text, atMs: nowMs } satisfies FieldNote];
    this.state = { ...this.state, seen, notes };
    this.persist();
  }

  private persist(): void {
    this.options.onPersist?.(this.state);
  }

  private publishView(): void {
    this.options.onView?.(this.getView());
  }
}
