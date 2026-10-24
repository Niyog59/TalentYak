#!/usr/bin/env node
/**
 * Idle-timeout wrapper, required by the project rules → Interruption & failure protocol
 * ("HANGS"). Enforced in code rather than by an agent's memory.
 *
 *   node scripts/lib/with-idle-timeout.mjs <idleSeconds> <command> [args...]
 *
 * The kill signal is NO OUTPUT for the idle window — never elapsed wall-clock
 * time. A command that is actively printing runs as long as it needs to.
 *
 * Output is streamed through unbuffered, so diagnostic evidence is already on
 * the terminal before any kill happens. Termination is SIGTERM first, and
 * SIGKILL only after a grace period — never SIGKILL on a process whose output
 * has not been captured.
 *
 * Long-lived servers (`next dev`, `next start`) must NOT be wrapped: they are
 * legitimately idle for long stretches.
 *
 * Exit codes: the child's own code, or 124 when killed for being idle
 * (the same code GNU `timeout` uses).
 */
import { spawn } from "node:child_process";

const [idleArg, command, ...args] = process.argv.slice(2);
const idleSeconds = Number(idleArg);

if (!Number.isFinite(idleSeconds) || idleSeconds <= 0 || !command) {
  process.stderr.write(
    "usage: with-idle-timeout.mjs <idleSeconds> <command> [args...]\n",
  );
  process.exit(2);
}

const idleMs = idleSeconds * 1000;
const GRACE_MS = 5000;

const child = spawn(command, args, {
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env, PYTHONUNBUFFERED: "1", NODE_NO_READLINE: "1" },
});

let timer;
let killedForIdle = false;

function onIdle() {
  killedForIdle = true;
  process.stderr.write(
    `\n[with-idle-timeout] No output for ${idleSeconds}s from: ${command} ${args.join(" ")}\n` +
      `[with-idle-timeout] Treating as hung. Sending SIGTERM; SIGKILL in ${GRACE_MS / 1000}s if it does not exit.\n` +
      `[with-idle-timeout] All output produced before this point is above.\n`,
  );

  child.kill("SIGTERM");
  const hard = setTimeout(() => child.kill("SIGKILL"), GRACE_MS);
  hard.unref();
}

function resetTimer() {
  if (killedForIdle) return;
  clearTimeout(timer);
  timer = setTimeout(onIdle, idleMs);
}

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  resetTimer();
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  resetTimer();
});

child.on("error", (err) => {
  clearTimeout(timer);
  process.stderr.write(`[with-idle-timeout] Failed to start: ${err.message}\n`);
  process.exit(127);
});

child.on("close", (code, signal) => {
  clearTimeout(timer);
  if (killedForIdle) process.exit(124);
  if (signal) {
    process.stderr.write(`[with-idle-timeout] Child exited on ${signal}\n`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

resetTimer();
