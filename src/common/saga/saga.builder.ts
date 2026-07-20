export interface SagaStep<TContext extends Record<string, any>> {
  name: string;
  execute: (ctx: TContext) => Promise<void>;
  compensate: (ctx: TContext) => Promise<void>;
}

export class SagaBuilder<TContext extends Record<string, any>> {
  private steps: SagaStep<TContext>[] = [];

  static create<TContext extends Record<string, any>>(): SagaBuilder<TContext> {
    return new SagaBuilder<TContext>();
  }

  step(
    name: string,
    execute: (ctx: TContext) => Promise<void>,
    compensate: (ctx: TContext) => Promise<void>,
  ): this {
    this.steps.push({ name, execute, compensate });
    return this;
  }

  async execute(ctx: TContext): Promise<void> {
    const executed: string[] = [];
    try {
      for (const step of this.steps) {
        await step.execute(ctx);
        executed.push(step.name);
      }
    } catch (error) {
      for (let i = executed.length - 1; i >= 0; i--) {
        try {
          await this.steps[i].compensate(ctx);
        } catch {
          // Compensation best-effort: continue rolling back remaining steps
        }
      }
      throw error;
    }
  }
}
