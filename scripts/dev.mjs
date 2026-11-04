import { spawn } from 'node:child_process';

const procs = ['@chalkline/server', '@chalkline/client'].map((w) =>
  spawn('npm', ['run', 'dev', '-w', w], { stdio: 'inherit', shell: true }),
);
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', stop));
