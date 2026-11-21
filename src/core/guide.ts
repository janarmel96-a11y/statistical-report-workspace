// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { LEVEL_NAMES, SAMPLES, sampleGuideId, type Sample } from './samples';

/**
 * The next-step guide: suggests what to click next on each screen, in the order a new user learns best.
 * Screen elements carry a data-guide name. Clicking one marks it done, so the guide moves on by itself.
 */

export type GuideRoute = 'home' | 'prepare' | 'report';

export interface GuideInput {
  route: GuideRoute;
  /** Step ids and data-guide names already done or skipped. */
  done: string[];
  /** data-guide names visible on the screen right now. */
  onScreen: string[];
  autoMode: boolean;
  /** Data issues waiting for the person's decision. */
  review: number;
  /** A filter or chart selection is applied. */
  filtered: boolean;
}

export interface GuideStep {
  id: string;
  /** data-guide names. The first one on the screen is the one to click. */
  targets: string[];
  title: string;
  why: string;
  /** Opens the hidden part of the screen that holds the target. */
  reveal?: 'assistant';
  /** Done only by its own id, not by clicking its target, so it can be suggested again later. */
  idOnly?: boolean;
}

/** The first sample not opened yet, from the simplest to the most advanced. */
export const nextSample = (done: string[]): Sample | undefined => SAMPLES.find((s) => !done.includes(sampleGuideId(s)));

const levelText = (s: Sample) => `Level ${s.level}, ${LEVEL_NAMES[s.level]}. ${s.learn}`;

/** Every step for this screen, in teaching order. */
export function guideSteps(input: GuideInput): GuideStep[] {
  const { route, done, review } = input;
  const sample = nextSample(done);
  const issues = `${review} data ${review === 1 ? 'issue' : 'issues'}`;
  if (route === 'home') {
    const steps: GuideStep[] = [];
    if (sample) steps.push({ id: sampleGuideId(sample), targets: [sampleGuideId(sample)], title: `Open the ${sample.name} sample`, why: levelText(sample) });
    if (!input.autoMode && done.some((d) => d.startsWith('sample-'))) steps.push({ id: 'auto-mode', targets: ['auto-mode'], title: 'Turn on Automatic report', why: 'Your next file opens as a finished report, with errors already corrected.' });
    steps.push({ id: 'upload', targets: ['upload'], title: sample ? 'Or add your own file' : 'Add your own file', why: 'Drop an Excel, CSV, PDF, Word, or PowerPoint file, or choose one from your computer.' });
    return steps;
  }
  if (route === 'prepare') {
    return [
      { id: 'checks', targets: ['checks'], title: 'See what was corrected', why: review ? `Corrections are listed here, and ${issues} need your decision. Turn a correction off to keep the original value.` : 'Every correction is listed here. Turn one off to keep the original value.' },
      { id: 'grid-head', targets: ['grid-head'], title: 'Click a column header to clean it', why: 'Rename it, fill blanks, split it, or remove outliers. Every change can be undone.' },
      { id: 'build', targets: ['build'], title: 'Build the report', why: 'Charts, findings, and filters are created from the corrected data.' },
    ];
  }
  const steps: GuideStep[] = [
    { id: 'analyst', targets: ['analyst-panel', 'analyst'], title: 'Read the analyst brief', why: 'A plain-language summary, forecast, and recommended actions, worked out from your numbers.' },
    { id: 'add-filter', targets: ['slicer', 'add-filter'], title: 'Filter the whole report', why: 'Open a filter such as a region or month and pick values. Every chart updates at once.' },
    { id: 'assistant-tab', targets: ['assistant-tab'], reveal: 'assistant', title: 'Ask the assistant a question', why: 'Try "What should I improve?" or "Show the top 5". Answers come from this report only.' },
    { id: 'add-page', targets: ['add-page'], title: 'Add a page from a template', why: 'Ready-made pages for trends, comparisons, and data quality.' },
    { id: 'design', targets: ['design'], title: 'Change the colors and fonts', why: 'Pick a theme or add your logo.' },
  ];
  if (review) steps.push({ id: 'data', targets: ['data'], title: `Review ${issues}`, why: 'These could not be corrected safely without your decision.' });
  steps.push(
    { id: 'present', targets: ['present'], title: 'Present it as an animated slideshow', why: 'Full screen slides with a summary, key figures, and a forecast. Press Play and turn on the voice to hear it narrated.' },
    { id: 'video', targets: ['video'], title: 'Turn the report into a video', why: 'A narrated video with captions that you can download and share.' },
    { id: 'download', targets: ['download'], title: 'Download the report', why: 'Excel, PDF, PowerPoint, PNG, or CSV, with the charts and corrections included.' },
  );
  if (sample) steps.push({ id: `next-${sampleGuideId(sample)}`, targets: ['home'], idOnly: true, title: `Next, try the ${sample.name} sample`, why: levelText(sample) });
  return steps;
}

export function isStepDone(step: GuideStep, input: Pick<GuideInput, 'done' | 'filtered'>): boolean {
  if (input.done.includes(step.id)) return true;
  if (step.idOnly) return false;
  if (step.id === 'add-filter' && input.filtered) return true;
  return step.targets.some((t) => input.done.includes(t));
}

/** The steps still to do that can be shown now, and how far along this screen the person is. */
export function guidePlan(input: GuideInput): { pending: GuideStep[]; done: number; total: number } {
  const steps = guideSteps(input);
  const open = steps.filter((s) => !isStepDone(s, input));
  return {
    pending: open.filter((s) => s.reveal || s.targets.some((t) => input.onScreen.includes(t))),
    done: steps.length - open.length,
    total: steps.length,
  };
}
