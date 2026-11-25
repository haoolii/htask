#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { OpenCodeV2 } = require('./lib/opencode');
const { readTaskEnv } = require('./lib/task-env');

const root = path.join(__dirname, '.runs');
const help = `Usage: ./htask task <command>

  run "PROMPT"                        Start a task in a new container
  ls                                  List tasks
  status RUN_ID                       Show task and container status
  attach RUN_ID                       Open the existing OpenCode session
  shell RUN_ID                        Open Bash without launching OpenCode
  exec RUN_ID [COMMAND [ARGS...]]       Open Bash or run a command in the container
  logs RUN_ID                         Show container logs
  abort RUN_ID                        Interrupt the OpenCode turn
  cleanup RUN_ID                      Remove the container; keep artifacts
  clean [--dry-run] [--include-artifacts | --all]
                                      Clean local records; --all also removes containers
  gc --dry-run                         List expired tasks without removing them
  help                                Show this help`;

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw new Error(`docker ${args[0]} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout.trim();
}

function bindMount(source, target, readOnly = false) {
  return ['--mount', `type=bind,"source=${source.replaceAll('"', '""')}",target=${target}${readOnly ? ',readonly' : ''}`];
}

function load(id) {
  if (!/^task-[a-f0-9]{16}$/.test(id || '')) throw new Error('Invalid run ID');
  return JSON.parse(fs.readFileSync(path.join(root, id, 'metadata.json'), 'utf8'));
}

function containerStates() {
  const output = docker(['ps', '-a', '--filter', 'label=local.run-task.id',
    '--format', '{{.Names}} {{.State}}'], { timeout: 5000 });
  return new Map(output ? output.split(/\r?\n/).map(line => line.split(' ')) : []);
}

function currentRun(run, states) {
  if (run.state === 'destroyed') return run;
  const containerState = (states ?? containerStates()).get(run.id) ?? 'missing';
  if (containerState !== 'running') {
    const state = ['exited', 'dead'].includes(containerState) ? 'stopped' : containerState;
    return { ...run, state, containerState };
  }
  run = { ...run, containerState };
  if (!run.background || run.state !== 'background-started') return run;
  const result = spawnSync('docker', ['exec', run.id, 'cat', '/tmp/htask-status.json'], {
    encoding: 'utf8', timeout: 5000,
  });
  if (result.status !== 0) return run;
  const { state, sessionId, error } = JSON.parse(result.stdout);
  return { ...run, state, sessionId, error };
}

async function main() {
  const [namespace, command, ...args] = process.argv.slice(2);
  const helpFlags = ['help', '-h', '--help'];
  if ((!namespace || helpFlags.includes(namespace)) || (namespace === 'task' && (!command || helpFlags.includes(command)))) {
    console.log(help);
    return;
  }
  if (namespace !== 'task') throw new Error('Unknown command. Run ./htask help.');
  if (command === 'run') {
    if (!args[0] || args.length !== 1) throw new Error('Usage: ./htask task run "your prompt"');
    const taskEnv = readTaskEnv(path.join(__dirname, '.env'));
    const configPath = path.join(__dirname, 'opencode.jsonc');
    const config = fs.statSync(configPath, { throwIfNoEntry: false });
    if (config && !config.isFile()) throw new Error('opencode.jsonc must be a file');
    const configMount = config ? bindMount(configPath, '/workspace/opencode.jsonc', true) : [];
    const id = `task-${crypto.randomBytes(8).toString('hex')}`;
    const password = crypto.randomBytes(32).toString('base64url');
    const dir = path.join(root, id);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(dir, { mode: 0o700 });
    const artifacts = path.join(dir, 'artifacts');
    fs.mkdirSync(artifacts, { mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(artifacts, 0o777);
    const env = { ...process.env, ...taskEnv, OPENCODE_PASSWORD: password };
    const dockerArgs = ['run', '-d', '--name', id, '--label', `local.run-task.id=${id}`,
      '--init', '--pids-limit', '512', '--memory', '2g', '--cpus', '2',
      '-p', '127.0.0.1::4096', '-e', 'OPENCODE_PASSWORD',
      ...Object.keys(taskEnv).flatMap(key => ['-e', key]),
      ...configMount,
      ...bindMount(artifacts, '/artifacts'),
      ...bindMount(artifacts, '/workspace/artifacts'),
      '--pull', 'never', 'htask:dev'];
    docker(dockerArgs, { env });
    const portOutput = docker(['port', id, '4096/tcp']);
    const port = Number(/127\.0\.0\.1:(\d+)/.exec(portOutput)?.[1]);
    if (!port) throw new Error(`Cannot identify loopback port; container retained: ${id}`);
    const metadata = { id, port, password, sessionId: null, createdAt: new Date().toISOString(), state: 'provisioning' };
    const metadataPath = path.join(dir, 'metadata.json');
    const save = () => fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
    save();
    try {
      docker(['exec', '-i', id, 'node', '-e',
        "const fs = require('node:fs'); fs.accessSync('/opt/htask/task-worker.js'); fs.accessSync('/artifacts', fs.constants.W_OK); fs.writeFileSync('/tmp/htask-input', fs.readFileSync(0), {mode: 0o600, flag: 'wx'});"],
      { input: args[0] });
      docker(['exec', '-d', id, 'node', '/opt/htask/task-worker.js', id]);
      metadata.background = true;
      metadata.state = 'background-started';
      save();
      console.log(`OK ${id}\nArtifacts: ${artifacts}\nStatus: ./htask task status ${id}`);
    } catch (error) {
      metadata.state = 'error';
      save();
      throw new Error(`${error.message}. Container retained: ${id}`);
    }
  } else if (command === 'ls') {
    if (!fs.existsSync(root)) return;
    const states = containerStates();
    for (const id of fs.readdirSync(root).filter(name => /^task-[a-f0-9]{16}$/.test(name))) {
      try { const run = currentRun(load(id), states); console.log(`${id} ${run.state} ${run.sessionId || '-'}`); } catch { console.log(`${id} unreadable`); }
    }
  } else if (command === 'clean') {
    if (new Set(args).size !== args.length || args.some(arg => !['--dry-run', '--include-artifacts', '--all'].includes(arg))) {
      throw new Error('Usage: ./htask task clean [--dry-run] [--include-artifacts | --all]');
    }
    const all = args.includes('--all');
    const dryRun = args.includes('--dry-run');
    if (!all && !fs.existsSync(root)) return;
    const entries = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [];
    const states = containerStates();
    if (all) {
      const containers = docker(['ps', '-a', '--no-trunc', '--filter', 'label=local.run-task.id',
        '--format', '{{.ID}} {{.Names}} {{.Label "local.run-task.id"}}'], { timeout: 5000 });
      for (const line of containers ? containers.split(/\r?\n/) : []) {
        const [containerId, name, label] = line.split(' ');
        if (!/^[a-f0-9]{64}$/.test(containerId) || !/^task-[a-f0-9]{16}$/.test(name) || label !== name) continue;
        if (!dryRun) docker(['rm', '-f', containerId]);
        states.delete(name);
        console.log(`${dryRun ? 'Would remove' : 'Removed'} container ${name}`);
      }
    }
    for (const entry of entries) {
      const id = entry.name;
      if (!entry.isDirectory() || !/^task-[a-f0-9]{16}$/.test(id) || states.has(id)) continue;
      const dir = path.join(root, id);
      let run;
      try {
        run = load(id);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (run.id !== id || (!all && run.state !== 'destroyed')) continue;
      const contents = fs.readdirSync(dir);
      if (contents.some(name => !['metadata.json', 'artifacts'].includes(name))) continue;
      if (contents.includes('artifacts')) {
        const artifacts = path.join(dir, 'artifacts');
        if (!fs.lstatSync(artifacts).isDirectory()) continue;
        if (!all && !args.includes('--include-artifacts') && fs.readdirSync(artifacts).length > 0) continue;
      }
      if (!dryRun) fs.rmSync(dir, { recursive: true });
      console.log(`${dryRun ? 'Would remove' : 'Removed'} ${id}`);
    }
  } else if (command === 'gc') {
    if (args.length !== 1 || args[0] !== '--dry-run') throw new Error('Only ./htask task gc --dry-run is supported');
    if (!fs.existsSync(root)) return;
    const cutoff = Date.now() - 4 * 60 * 60 * 1000;
    for (const id of fs.readdirSync(root).filter(name => /^task-[a-f0-9]{16}$/.test(name))) {
      try {
        const run = load(id);
        if (run.state !== 'destroyed' && Date.parse(run.createdAt) < cutoff) console.log(`${id} ${run.createdAt}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  } else if (command === 'finish') {
    throw new Error(`${command} is not implemented yet`);
  } else if (['attach', 'shell', 'exec', 'logs', 'status', 'abort', 'cleanup'].includes(command)) {
    if (!args[0] || (command !== 'exec' && args.length !== 1)) {
      throw new Error(`Usage: ./htask task ${command} RUN_ID${command === 'exec' ? ' [COMMAND [ARGS...]]' : ''}`);
    }
    const saved = load(args[0]);
    const run = ['status', 'attach', 'abort'].includes(command) ? currentRun(saved) : saved;
    if (['attach', 'abort'].includes(command) && run.containerState !== 'running') {
      throw new Error(`Container is not running (${run.containerState ?? run.state})`);
    }
    if (command === 'status') {
      console.log(JSON.stringify({ id: run.id, state: run.state, containerState: run.containerState, sessionId: run.sessionId, port: run.port, createdAt: run.createdAt, error: run.error }, null, 2));
    } else if (command === 'logs') {
      console.log(docker(['logs', run.id]));
    } else if (command === 'abort') {
      if (!run.sessionId) throw new Error('Session not available; check task status');
      const api = new OpenCodeV2(`http://127.0.0.1:${run.port}`, 10000, run.password);
      console.log(JSON.stringify(await api.interrupt(run.sessionId)));
    } else if (command === 'cleanup') {
      if (run.state === 'destroyed') {
        console.log(`${run.id} is already removed.`);
        return;
      }
      const label = docker(['inspect', '--format', '{{ index .Config.Labels "local.run-task.id" }}', run.id]);
      if (label !== run.id) throw new Error('Container label mismatch');
      docker(['rm', '-f', run.id]);
      run.state = 'destroyed';
      fs.writeFileSync(path.join(root, run.id, 'metadata.json'), JSON.stringify(run, null, 2), { mode: 0o600 });
      console.log(`Removed ${run.id}. Metadata retained.`);
    } else {
      if (command === 'attach' && !run.sessionId) throw new Error('Session not available; check task status');
      const interactive = command !== 'exec' || args.length === 1;
      const target = command === 'attach'
        ? ['opencode', '--server', 'http://127.0.0.1:4096', '--session', run.sessionId, '/workspace']
        : interactive ? ['bash'] : args.slice(1);
      const result = spawnSync('docker', ['exec', interactive ? '-it' : '-i', run.id, ...target], { stdio: 'inherit' });
      if (result.error || result.status !== 0) throw new Error(`${command} exited unsuccessfully`);
    }
  } else {
    throw new Error('Unknown task command. Run ./htask task help.');
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
