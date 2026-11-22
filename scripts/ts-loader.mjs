// 极简 TypeScript ESM loader：让 `node --import ./scripts/register-ts.mjs` 能直接跑 packages/core 的 .ts 源码。
// 仅用于沙箱内的本地验证（沙箱禁止 vitest/esbuild 通过管道创建子进程），发布/常规开发仍用 vitest。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  isolatedModules: true,
  esModuleInterop: true,
  jsx: ts.JsxEmit.ReactJSX,
};

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('.') || specifier.startsWith('/');
  if (relative && !path.extname(specifier)) {
    const baseDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    const target = path.resolve(baseDir, specifier);
    for (const candidate of [`${target}.ts`, path.join(target, 'index.ts')]) {
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const fileName = fileURLToPath(url);
    const source = readFileSync(fileName, 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: COMPILER_OPTIONS, fileName });
    return { format: 'module', source: output.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
