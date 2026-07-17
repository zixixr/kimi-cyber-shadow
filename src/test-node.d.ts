// vitest 单测读磁盘资产（assets/puppets/**）用的最小 node:fs 类型声明。
// 项目未引 @types/node（保持依赖最小）；仅声明单测用到的 readFileSync 签名。

declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
