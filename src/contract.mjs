// THE CONTRACT every session the runner starts is given, whoever made the job: run it, solve what
// broke, improve the thing that ran, report exactly once. The words a host's skills go by (how to
// debug, where an improvement goes) are options, so a host can name its own tools; the shape and
// the report are the runner's.

/** The run step for a job: a shell command, a slash command with arguments, or plain words. */
export function runStep(job, { root } = {}) {
  if (job.unattended) {
    return `Run its command from the workspace root (${root}) and keep its output:\n\n    ${job.unattended}\n\nExit 0 is green. Exit 75 means "not now" (a port held, the machine busy): there is nothing to fix, report deferred. Any other exit is a problem to solve.`;
  }
  if (job.command) {
    return `Run ${job.command}${job.arguments ? ` (pass the superskill exactly these arguments: ${job.arguments})` : ""}. Nobody is there to answer a question, so where it would ask, decide what it can decide and leave the rest named in your report.`;
  }
  return `Its method is these words, so do what they say:\n\n${job.prompt}`;
}

export const DEFAULT_SOLVE = "2. If it failed, solve it. Find the cause, fix it the way this workspace fixes things (a worktree, its tests), land the fix, and run it again. Anything that would reach another person, spend money or cannot be undone is not yours to do here: leave it, and say what the operator has to decide.";
export const defaultImprove = (file) => `3. Before you finish, improve it. Whatever would have made this run cheaper, faster or more reliable goes into ${file ? `its file (${file})` : "its file"}, the script it runs, or the skill it calls. Commit it with an explicit pathspec. If there is nothing to improve, say so in one line.`;

/**
 * The whole first message. `report` is the exact command the session runs to report;
 * `starter` names what started it; `solve` and `improve(file)` may be the host's own words.
 */
export function contractMessage({ what, job, report, file = null, root, extra = "", starter = "The session runner", solve = DEFAULT_SOLVE, improve = defaultImprove }) {
  return [
    `This is ${what}. ${starter} started this session on its own, with nobody present, so work it through from start to finish without waiting for anyone.`,
    `1. Run it. ${runStep(job, { root })}`,
    ...(extra ? [extra] : []),
    solve,
    improve(file),
    `4. Report exactly once, as your last step, then stop:\n\n    ${report}\n\nok: it ran and ended green, after your fix if you made one. deferred: it said not now. failed: it is still broken, and the sentence says what the operator needs to know. ok stamps the run and failed sends the operator one notice, so do neither by hand.`,
  ].join("\n\n");
}
