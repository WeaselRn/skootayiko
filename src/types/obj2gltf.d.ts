declare module "obj2gltf" {
  export default function obj2gltf(path: string, options?: { binary?: boolean; [k: string]: unknown }): Promise<any>;
}
