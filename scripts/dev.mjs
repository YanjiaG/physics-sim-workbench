#!/usr/bin/env node
/**
 * 一条命令同时启动 AI 代理与前端开发服务器。
 * 不引入 concurrently：只用 node 自带的 child_process。
 */
import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const children = [];
let shuttingDown = false;

function run(name, args) {
  const child = spawn('pnpm', args, {
    stdio: 'inherit',
    shell: isWindows,
    env: process.env,
  });
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`\n[dev] ${name} 已退出（code ${code}），正在停止其余进程…`);
      shutdown(code ?? 0);
    }
  });
  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] 启动 AI 代理 (http://127.0.0.1:8787) 与前端 (http://127.0.0.1:5173)\n');
run('server', ['-F', '@psw/server', 'dev']);
run('web', ['-F', '@psw/web', 'dev']);
