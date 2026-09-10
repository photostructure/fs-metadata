// src/types/node-gyp-build.d.ts

declare module "node-gyp-build" {
  const NodeGypBuild: {
    (dir: string): unknown;
    path(dir: string): string;
  };
  export default NodeGypBuild;
}
