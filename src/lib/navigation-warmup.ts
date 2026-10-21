type Job = { run: () => Promise<unknown>; promise: Promise<void>; resolve: () => void };

/** Uma fila por sessão, independente das montagens/desmontagens das telas. */
export function createWarmupQueue(concurrency: number) {
  const jobs = new Map<string, Job>();
  let pending: string[] = [];
  let running = 0;
  let generation = 0;
  const drain = () => {
    while (running < concurrency && pending.length) {
      const key = pending.shift()!;
      const job = jobs.get(key)!;
      const version = generation;
      running += 1;
      void Promise.resolve()
        .then(() => (version === generation ? job.run() : undefined))
        .catch(() => {
          if (jobs.get(key) === job) jobs.delete(key);
        })
        .finally(() => {
          job.resolve();
          if (version !== generation) return;
          running -= 1;
          drain();
        });
    }
  };
  return {
    enqueue(key: string, run: () => Promise<unknown>, priority = false) {
      const existing = jobs.get(key);
      if (existing) {
        if (priority && pending.includes(key)) {
          pending = [key, ...pending.filter((item) => item !== key)];
        }
        return existing.promise;
      }
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      jobs.set(key, { run, promise, resolve });
      if (priority) pending.unshift(key);
      else pending.push(key);
      queueMicrotask(drain);
      return promise;
    },
    reset() {
      generation += 1;
      for (const key of pending) jobs.get(key)?.resolve();
      pending = [];
      running = 0;
      jobs.clear();
    },
  };
}

const codeQueue = createWarmupQueue(2);
const dataQueue = createWarmupQueue(1);
let currentScope = "";

export const isNavigationScopeCurrent = (scope: string) => currentScope === scope;

export function resetNavigationWarmup() {
  codeQueue.reset();
  dataQueue.reset();
  currentScope = "";
}

export function warmNavigationRoutes(options: {
  scope: string;
  hrefs: string[];
  dataHrefs?: string[];
  currentHref: string;
  preloadCode?: (href: string) => Promise<unknown>;
  loadData: (href: string) => Promise<unknown>;
}) {
  if (currentScope !== options.scope) {
    resetNavigationWarmup();
    currentScope = options.scope;
  }
  const normalize = (href: string) => href.split("?")[0].replace(/\/$/, "") || "/";
  const hrefs = [...new Set(options.hrefs.map(normalize))];
  const dataHrefs = [...new Set((options.dataHrefs ?? options.hrefs).map(normalize))];
  const currentHref = normalize(options.currentHref);
  if (dataHrefs.includes(currentHref)) {
    // A tela aberta tem prioridade. O cache deduplica sua consulta já em curso.
    void dataQueue.enqueue(currentHref, () => options.loadData(currentHref), true);
  }
  for (const href of hrefs) {
    if (options.preloadCode)
      void codeQueue.enqueue(href, () => options.preloadCode!(href), href === currentHref);
  }
  for (const href of dataHrefs)
    void dataQueue.enqueue(href, () => options.loadData(href), href === currentHref);
}
