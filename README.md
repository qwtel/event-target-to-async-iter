# EventTarget to Async Iterable

Takes an [`EventTarget`][et] and an event name and turns it into an [async iterable](https://qwtel.com/posts/software/async-generators-in-the-wild/).

Note that the async iterable will not complete until either 
- an abort controller aborts it,
- the `return` function is called, or 
- a `returnEvent` is provided and gets dispatched on the event target.

[et]: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget


## Example 1
Waiting for web socket messages:

```js
const socket = new WebSocket('wss://example.com/socketserver');

const iter = eventTargetToAsyncIter(socket, 'message', { 
  returnEvent: 'close'
});

for await (const message of iter) {
  console.log(message)
}
```

## Example 2
Say you have a heavily callback-based API such as [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter) and would prefer to process it as an async iterable. You can use a custom event target and `eventTargetToAsyncIter`:

```js
const target = new EventTarget();
const iter = eventTargetToAsyncIter(target, 'data');

// Helper function that consumes a readable stream
async function consume(stream) {
  const reader = stream.getReader();
  while (await reader.read().then(x => !x.done)) {}
}

const response = new HTMLRewriter()
  .on('.athing[id]', {
    element(el) {
      target.dispatchEvent(new CustomEvent('data', { 
        detail: el.getAttribute('id'),
      }));
    }
  })
  .transform(await fetch('https://news.ycombinator.com'));

// No await here
consume(response.body)
  .then(() => iter.return()) // Don't create an endless loop
  .catch(e => iter.throw(e)) // Don't swallow errors

for await (const event of iter) {
  const id = Number(event.detail);
  console.log(id);
}
```
