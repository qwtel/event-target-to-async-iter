type Resolver<T> = (value: T | PromiseLike<T>) => void;
type Rejecter = (reason?: any) => void;

function newAbortError() {
  return new DOMException('eventTargetToAsyncIter was aborted via AbortSignal', 'AbortError');
}

const AsyncIteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(async function* () {}).prototype);

export interface EventTargetToAsyncIterOptions {
  /**
   * An abort signal to cancel async iteration.
   */
  signal?: AbortSignal,
  
  /**
   * An event name that marks the end of the async iterable. 
   * Note that this is a convenience option. 
   * The same result can be achieved by calling `return()` on the async generator.
   */
  returnEvent?: string,
}

/**
 * Takes an event target and an event name and turns it into an async iterable.
 * 
 * Note that the async iterable will not complete until either 
 * - an abort controller aborts it,
 * - the `return` function is called, or 
 * - a `returnEvent` is provided and gets dispatched on the event target.
 * 
 * Source: <https://github.com/nodejs/node/blob/5b59e14dafb43b907e711cb418bb9c302bce2890/lib/events.js#L1017>
 */
export function eventTargetToAsyncIterable<E extends Event>(
  target: EventTarget,
  event: string,
  options?: EventTargetToAsyncIterOptions,
): AsyncGenerator<E, void, unknown> {
  const signal = options?.signal;
  // validateAbortSignal(signal, 'options.signal');
  if (signal?.aborted)
    throw newAbortError();

  const returnEvent = options?.returnEvent

  const unconsumedEvents: E[] = [];
  const unconsumedPromises: { resolve: Resolver<IteratorResult<E, void>>, reject: Rejecter }[] = [];
  let error: any = null;
  let finished = false;

  const iterator = <AsyncGenerator<E, void, unknown>>Object.setPrototypeOf({
    next(): Promise<IteratorResult<E, void>> {
      // First, we consume all unread events
      const value = unconsumedEvents.shift();
      if (value) {
        return Promise.resolve({ value, done: false });
      }

      // Then we error, if an error happened
      // This happens one time if at all, because after 'error'
      // we stop listening
      if (error) {
        const p = Promise.reject(error);
        // Only the first element errors
        error = null;
        return p;
      }

      // If the iterator is finished, resolve to done
      if (finished) {
        return Promise.resolve({ value: undefined, done: true });
      }

      // Wait until an event happens
      return new Promise((resolve, reject) => {
        unconsumedPromises.push({ resolve, reject });
      });
    },

    return(): Promise<IteratorResult<E, void>> {
      target.removeEventListener(event, eventHandler);
      target.removeEventListener('error', errorHandler);
      if (returnEvent) target.removeEventListener(returnEvent, returnHandler);

      if (signal) {
        signal.removeEventListener('abort', abortListener);
      }

      finished = true;

      for (const promise of unconsumedPromises) {
        promise.resolve({ value: undefined, done: true });
      }

      return Promise.resolve({ value: undefined, done: true });
    },

    throw(err: any): Promise<IteratorResult<E, void>> {
      // if (!err || !(err instanceof Error)) {
      //   throw new ERR_INVALID_ARG_TYPE('EventEmitter.AsyncIterator',
      //                                  'Error', err);
      // }
      error = err;
      target.removeEventListener(event, eventHandler);
      target.removeEventListener('error', errorHandler);

      return Promise.reject(err)
    },

    [Symbol.asyncIterator]() {
      return this;
    }
  }, AsyncIteratorPrototype);

  target.addEventListener(event, eventHandler);
  if (event !== 'error') {
    target.addEventListener('error', errorHandler);
  }
  if (returnEvent && event !== returnEvent) {
    target.addEventListener(returnEvent, returnHandler)
  }

  if (signal) {
    signal.addEventListener('abort', abortListener, { once: true });
  }

  return iterator;

  function abortListener() {
    errorHandler(newAbortError());
  }

  function eventHandler(ev: Event) {
    const promise = unconsumedPromises.shift();
    if (promise) {
      promise.resolve({ value: ev as E, done: false }); // FIXME
    } else {
      unconsumedEvents.push(ev as E); // FIXME
    }
  }

  function errorHandler(err: any) {
    finished = true;

    const toError = unconsumedPromises.shift();

    if (toError) {
      toError.reject(err);
    } else {
      // The next time we call next()
      error = err;
    }

    iterator.return();
  }

  function returnHandler() {
    iterator.return();
  }
}

export { 
  eventTargetToAsyncIterable as eventTargetToAsyncIter,
  eventTargetToAsyncIterable as eventTargetToAsyncGenerator,
}
