declare const Deno: {
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): Record<string, string>;
  };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
  serve(options: { port?: number; hostname?: string }, handler: (req: Request) => Promise<Response> | Response): void;
};
