What's `Promise.then` really doing?
===================================

In "[You're Missing the Point of Promises](https://blog.domenic.me/youre-missing-the-point-of-promises/)" Domenic Denicola insists that "`then` is not a mechanism for attaching callbacks to an aggregate collection. It’s a mechanism for applying a transformation to a promise, and yielding a new promise from that transformation."

So if `then` isn't just adding a callback, to the promise that it acts on, what is it doing? What is this transformation?

The code here in [`promise.js`](promise.js) is a slightly modified version of the `Promise` implementation seen in "[JavaScript Promises ... In Wicked Detail](http://www.mattgreer.org/articles/promises-in-wicked-detail/)" in the section that introduces chaining (the wicked-detail article then goes on and refines this implementation further in following sections but this version will do for our purposes).

So `promise.js` provides us with a simple but fairly solid implementation of `Promise` where the `then`, as required, returns a promise. Print it out now or open it in an under window so you can refer to it while going through the rest of this page. The implementation in `promise.js` allows us to walk through exactly what happens with the following simple example usage:

```Javascript
var p = new Promise(resolve => {
    var httpGet = ...;
    httpGet.onSuccess = data => resolve(data);
  })
  .then(data => JSON.parse(data));
```

We have some old-style HTTP retrieval logic with an `onSuccess` callback that we wrap up in a promise. We then call `then` on this promise to transform it into a promise whose resolved value will be the JSON that results from parsing the retrieved text.

So first we create our initial promise, let's call it `alpha` - we run through the body of `Promise`, i.e. the promise constructor, and end up with a situation where:

```Javascript
alpha.state = 'pending';
alpha.value = undefined;
alpha.deferred = null;
```

The last step of the constructor is to pass a reference to the promise's `resolve` method to the passed in function, and this function wraps things up such that when the text is successfully retrieved the `resolve` method will be called with this text.

OK - now we've got `alpha` setup we call `then` on it - let's call the promise that the `then` creates `beta`. By the time we run through the constructor for this promise we'll end up with a similar situation to before:

```Javascript
beta.state = 'pending';
beta.value = undefined;
beta.deferred = null;
```
    
However interesting things start to happen on hitting the end of the constructor - the `childExecutorFn` gets invoked and we create a `handler` object like this:

```Javascript
var handler = {
  onResolved: data => JSON.parse(data),
  resolve: beta.resolve
};
```
    
And then we pass this `handler` to the `handle` method of the parent, i.e. `alpha`. As `alpha` is still in pending state all that happens is:

```Javascript
alpha.deferred = {
  onResolved: data => JSON.parse(data),
  resolve: beta.resolve
};
```
    
Now we're all done with the setup and `p` is the promise created by the `then`, i.e. `beta`.

So our classic logic goes off and does its work and retrieves the text `"{ x: true }"` and calls its `onSuccess` handler which is pointing to `alpha.resolve`. When `alpha.resolve` is called the following happens:

```Javascript
alpha.value = `"{ x: true }"`;
alpha.state = 'resolved';
```

Then it passes the `alpha.deferred` value to `handle`, this skips over the first two if-conditions and does the following (as a microtask):

```Javascript
var ret = JSON.parse("{ x: true }"); // I.e. the hander.onResolved function.
beta.resolve(ret); // I.e. the handler.resolve function.
```
    
So that's all the work for `alpha` done and the `resolve` method of `beta` is called with the JSON parsed from `"{ x: true }"`. When `beta.resolve` is called the following happens:

```Javascript
beta.value = ...; // The parsed JSON.
beta.state = 'resolved';
```

And that's it - it doesn't go any further as, unlike `alpha`, the `beta.deferred` value isn't set to anything.

So at this point anyone who cares to look at `p` will see that it's resolved and its value is the parsed JSON.

`onResolved` function that returns a promise
--------------------------------------------

If you're looking carefully you'll notice the `then` implementation is a simplification that only works nicely for `onResolved` functions that don't themselves return a promise. This works fine for our example and it's complex enough without adding more logic for this case. Handling this case is pretty simple though - we don't though check the thing that's returned when we call `onResolved` to see if it's a promise or not, instead we just add a few lines to the start of `resolve` like so:

```Javascript
function resolve(newValue) {
  if (newValue && typeof newValue.then === 'function') {
    newValue.then(resolve);
    return;
  }
  state = 'resolved';
  value = newValue;

  if (deferred) {
    handle(deferred);
  }
}
```

If the `JSON.parse` in our original example returned a promise rather than the parsed JSON then this new implmentation would result in dramatically different behaviour on the call to `beta.resolve` to that described above. Instead of the `state` and `value` fields of `beta` getting set we simply call the `then` method on the promise returned by `JSON.parse` such that when the relevant parsed JSON is produced we'll retry `beta.resolve` and this time we'll pass the initial check and set `state` to `'resolved'` and `value` to the parsed JSON.

Something about this implementation makes me feel a little uncomfortable but I'm not sure what. Can it be extended properly such that `catch` and proper error handling can be implemented? The wicked-detail article does note that it's "worth pointing out, this implementation does not meet the spec. Nor will we fully meet the spec in this regard in the article" and then suggests the curious look at the "[promise resolution procedure](https://promisesaplus.com/#the-promise-resolution-procedure)" documented in the Promises/A+ specification.

`onResolved` check
------------------

The `!handler.onResolved` check in `handle` is a little odd. Apparently the following is valid (and results in `onResolved` being undefined):

    var p = new Promise(...).then();
    
So in this case the `!handler.onResolved` check results in the promise created by the `then()` ending up resolved with the same value as the parent promise. I.e. in the setup above the thing we called `beta` would end up with its `value` and `state` fields set to the same values as in `alpha`, i.e. to `"{ x: true }"` and `'resolved'` respectively.

So could you not move the check into the `then` and rewrite it as follows?

```Javascript
this.then = function(onResolved) {
  if (!handler.onResolved) {
    return this;
  }
  ...
```
      
Changes
-------

As noted the `Promise` code in `promise.js` is a slightly modified version of the version seen in "[JavaScript Promises ... In Wicked Detail](http://www.mattgreer.org/articles/promises-in-wicked-detail/)" in the section that introduces chaining.

I've added in `parent`, `child` and `childExecutorFn` for the `then` function in the hope of making things a little clearer but all this naming of things can be done without.

Similarly I renamed `fn` to `executorFn` to try and make it a little clearer what we're dealing with ("executor" is the name that the MDN [promise documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) uses).

I also wrapped the logic around invoking the `onResolved` method in a lambda that's then added to the microtask queue, rather than doing it immediatelly inline. I think it's quite important to highlight that the function passed to `then` will never be called immediatelly even in a situation like this:

```Javascript
Promise.resolved(42).then(value => console.log(value));
```

The name `queueMicrotask` is just made up - you'll have to look elesewhere for how tasks end up on the microtasks queue.
