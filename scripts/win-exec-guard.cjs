// 在受限沙箱下运行 vitest 的兼容层。
// Windows 上 Vite 首次解析路径时会调用 exec("net use") 探测网络驱动器；
// 沙箱禁止以管道方式创建子进程（spawn EPERM），这里把 exec 替换为同步失败回调，
// 让 Vite 走「无网络驱动器」分支，而不是抛出未捕获异常。
const cp = require('node:child_process');

function makeError() {
  const error = new Error('child_process.exec disabled by sandbox guard');
  error.code = 'EPERM';
  return error;
}

cp.exec = function exec(cmd, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  if (typeof cb === 'function') {
    process.nextTick(() => cb(makeError(), '', ''));
  }
  const handle = {
    pid: undefined,
    on() {
      return handle;
    },
    once() {
      return handle;
    },
    kill() {
      return true;
    },
    unref() {
      return handle;
    },
  };
  return handle;
};

cp.execFile = cp.exec;
