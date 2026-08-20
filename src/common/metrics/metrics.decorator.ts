import {
  methodInvocationDurationHistogram,
  methodInvocationsCounter,
  methodErrorsCounter,
  blockchainTransactionDurationHistogram,
  blockchainTransactionCounter,
  blockchainTransactionErrorsCounter,
  cacheOperationDurationHistogram,
  databaseTransactionDurationHistogram,
} from './metrics.constants';

export interface TrackMetricsOptions {
  /**
   * Custom operation or method name to record in metric labels.
   * Defaults to the decorated method name.
   */
  operation?: string;

  /**
   * Custom class name. Defaults to constructor name.
   */
  className?: string;

  /**
   * Category of the operation for specialized metric routing.
   * Options: 'generic' | 'blockchain' | 'cache' | 'database' | 'auth'
   */
  category?: 'generic' | 'blockchain' | 'cache' | 'database' | 'auth' | string;

  /**
   * If true, also records blockchain transaction metrics:
   * `blockchain_transaction_duration_ms`, `blockchain_transaction_total`, `blockchain_transaction_errors_total`
   */
  trackBlockchain?: boolean;

  /**
   * If true, also records cache operation metrics:
   * `cache_operation_duration_ms`
   */
  trackCache?: boolean;

  /**
   * If true, also records database transaction metrics:
   * `database_transaction_duration_ms`
   */
  trackDatabase?: boolean;

  /**
   * Optional custom error type extractor.
   */
  getErrorType?: (error: unknown) => string;
}

/**
 * Classifies an error into a standardized error type string for metric labels.
 */
export function extractErrorType(error: unknown): string {
  if (!error) {
    return 'UnknownError';
  }
  if (typeof error === 'object') {
    const errorObj = error as Record<string, any>;
    if (errorObj.constructor && errorObj.constructor.name && errorObj.constructor.name !== 'Object') {
      return errorObj.constructor.name;
    }
    if (errorObj.name && typeof errorObj.name === 'string') {
      return errorObj.name;
    }
    if (errorObj.code && typeof errorObj.code === 'string') {
      return errorObj.code;
    }
  }
  if (typeof error === 'string') {
    return error.slice(0, 50);
  }
  return 'Error';
}

/**
 * Decorator to auto-instrument method calls with duration, status, operation count, and error count.
 * 
 * Works transparently on both synchronous and asynchronous methods.
 * 
 * @example
 * ```typescript
 * class UserService {
 *   @TrackMetrics()
 *   async getUser(id: string) { ... }
 * 
 *   @TrackMetrics({ category: 'blockchain', trackBlockchain: true })
 *   async sendMintTx(userId: number) { ... }
 * }
 * ```
 */
export function TrackMetrics(options?: TrackMetricsOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    if (typeof originalMethod !== 'function') {
      return descriptor;
    }

    const defaultClassName =
      typeof target === 'function'
        ? target.name
        : target?.constructor?.name || 'AnonymousClass';
    const className = options?.className || defaultClassName;
    const methodName = options?.operation || propertyKey;
    const category = options?.category || 'generic';

    descriptor.value = function (...args: any[]) {
      const startTime = Date.now();

      const recordSuccess = () => {
        const durationMs = Date.now() - startTime;
        const status = 'success';

        // 1. Method invocation metrics
        methodInvocationsCounter.inc({
          class_name: className,
          method_name: methodName,
          status,
        });
        methodInvocationDurationHistogram.observe(
          {
            class_name: className,
            method_name: methodName,
            status,
          },
          durationMs,
        );

        // 2. Specialized category metrics
        if (options?.trackBlockchain || category === 'blockchain') {
          blockchainTransactionCounter.inc({
            method: methodName,
            status,
          });
          blockchainTransactionDurationHistogram.observe(
            {
              method: methodName,
              status,
            },
            durationMs,
          );
        }

        if (options?.trackCache || category === 'cache') {
          cacheOperationDurationHistogram.observe(
            {
              operation: methodName,
              status,
            },
            durationMs,
          );
        }

        if (options?.trackDatabase || category === 'database') {
          databaseTransactionDurationHistogram.observe(
            {
              transaction_name: methodName,
              status,
            },
            durationMs,
          );
        }
      };

      const recordError = (err: unknown) => {
        const durationMs = Date.now() - startTime;
        const status = 'error';
        const errorType = options?.getErrorType
          ? options.getErrorType(err)
          : extractErrorType(err);

        // 1. Method invocation & error metrics
        methodInvocationsCounter.inc({
          class_name: className,
          method_name: methodName,
          status,
        });
        methodInvocationDurationHistogram.observe(
          {
            class_name: className,
            method_name: methodName,
            status,
          },
          durationMs,
        );
        methodErrorsCounter.inc({
          class_name: className,
          method_name: methodName,
          error_type: errorType,
        });

        // 2. Specialized category metrics
        if (options?.trackBlockchain || category === 'blockchain') {
          blockchainTransactionCounter.inc({
            method: methodName,
            status,
          });
          blockchainTransactionDurationHistogram.observe(
            {
              method: methodName,
              status,
            },
            durationMs,
          );
          blockchainTransactionErrorsCounter.inc({
            method: methodName,
            error_type: errorType,
          });
        }

        if (options?.trackCache || category === 'cache') {
          cacheOperationDurationHistogram.observe(
            {
              operation: methodName,
              status,
            },
            durationMs,
          );
        }

        if (options?.trackDatabase || category === 'database') {
          databaseTransactionDurationHistogram.observe(
            {
              transaction_name: methodName,
              status,
            },
            durationMs,
          );
        }
      };

      try {
        const result = originalMethod.apply(this, args);

        if (result && typeof result.then === 'function') {
          return result
            .then((resolvedValue: any) => {
              recordSuccess();
              return resolvedValue;
            })
            .catch((rejectionError: any) => {
              recordError(rejectionError);
              throw rejectionError;
            });
        }

        recordSuccess();
        return result;
      } catch (synchronousError) {
        recordError(synchronousError);
        throw synchronousError;
      }
    };

    // Copy metadata and preserve function name
    Object.defineProperty(descriptor.value, 'name', {
      value: propertyKey,
      configurable: true,
    });

    return descriptor;
  };
}
