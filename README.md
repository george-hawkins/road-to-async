Asynchronous Javascript
=======================

Javascript is single threaded (if we ignore [web workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) for the moment) but Node has shown that if you avoid blocking at all costs you can still achieve really impressive throughput and still write applications like web servers that handle large numbers of concurrent clients.

Over the years the techniques for handling asynchronous events have evolved, here I'm going to go through callbacks, promises and finally the new `async` and `await` keywords.

But before that I'm going to start perhaps a little surprisingly with iterators, move onto generators and then callbacks etc.

Iterables and iterators
-----------------------

In Javascript an _iterable_ implements `iterator()` (actually `[Symbol.iterator]()` for reasons we won't go into here) and the _iterator_ that is returned implements `next()` (which returns objects with fields `value` and `done`, if `done` isn't present then it's taken to be false, so for infinite sequences you can just return objects with the single field `value` without ever worrying about `done`).

Let's just pretend you can't create an iterator directly from an array - instead you could do:

```Javascript
function makeIterator(arr) {
    var i = 0;
    return {
        next: function() {
            return i < arr.length ? { value: arr[i++], done: false } : { done: true };
        }
    };
}
```

Iterators like this requires careful programming due to the need to explicitly maintain their internal state.

Generators
----------

Generators allow you to define an iterative algorithm by writing a single function which can maintain its own state:

```Javascript
function* makeIterator(arr) {
    var i = 0;

    while (i < arr.length) {
        yield arr[i++];
    }
}
```

A generator function, i.e. using the `function*` syntax seen here, works as a factory for iterators.

Note: you declare a generator _function_ which returns generator _objects_. A generator is a special kind of iterator that can suspend execution while retaining its context. When people say "generator" they generally mean the generator object rather than generator function that created it.

You could swap in either implementation of `makeIterator(...)` above and they would behave the same here:

```Javascript
const x = [1, 2, 3];
const iter = makeIterator(x);
x.next();
// { value: 1, done: false }
```

Well not quite identically, the iterator returned by the generator function is also an iterable, to get this same behavior from our non-generator function we'd have to define another method in addition to the `next()` function:

```Javascript
[Symbol.iterator]: function() { return this; }
```

Now our iterator can be asked for an iterator (and just returns itself), so while it can still only be used once it can now be used in situations where you need an iterable:

```Javascript
for (const val of makeIterator(x)) console.log(val);
```

I asked about this in an [SO question](https://stackoverflow.com/q/49170998/245602) - it seems that an iterator also being an iterable is common in the Javascript world.

A simple generator with two loops that hopefully make clear the order in which things are happening:

```Javascript
function* foo() {
  yield 'p';
  console.log('o');
  yield 'n';
  console.log('y');
  yield 'f';
  console.log('o');
  yield 'o';
  console.log('!');
}

var g1 = foo();
for (let v of g1) {
  console.log(v);
  // <- 'p'
  // <- 'o'
  // <- 'n'
  // <- 'y'
  // <- 'f'
  // <- 'o'
  // <- 'o'
  // <- '!'
}

var g2 = foo();
console.log(Array.from(g2));
// <- 'o'
// <- 'y'
// <- 'o'
// <- '!'
// <- ['p', 'n', 'f', 'o']
```

Aside: `Array.from(x)` is just a function that creates an array out of an iterable - Javascript has a [spread syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax) that allows you to e.g. do `[...g2]` which achieves the same thing.

When we invoke a generator function we get back an iterator object where any arguments passed to the function become the object's member variables and the body of the generator function becomes its `next()` method (sort of).

The first time the `next()` method is invoked it runs until the first `yield` at which point it pushes its stack frame somewhere internal to its containing object and returns `{ value: xyz, done: false }` where `xyz` is the argument to `yield`. Each subsequent time `next()` is invoked the existing stack frame is popped and the method continues from where it last paused.

So looking above, when do you get a result from `next()` where `done` is `true`? It's not when you hit the final `yield`, i.e. `yield 'o'` above, but when you hit the end of the function (or a `return`). Let's take a simpler example:

```
$ node
> function* foo() {
    yield 'a';
    console.log('b');
}
> const iter = foo();
> iter.next();
{ value: 'a', done: false }
> iter.next();
b
{ value: undefined, done: true }
```

See when the `b` got printed. And see how `done` wasn't set to `true` when we got the one and only element. We see this same behavior with a simple single element array:

```
> const bar = ['a'];
> const iter = bar[Symbol.iterator]();
> iter.next();
{ value: 'a', done: false }
> iter.next();
{ value: undefined, done: true }
```

So `value` should be ignored when `done` is `true`.

**Update:** actually this isn't strictly true, if your generator function contained e.g. the line `return 42` this would mark the end of the sequence and result in `next()` returning `{ value: 42, done: true }` (however `for (let x of gen)`, `[...gen]` and `Array.from(gen)` would all ignore such a value). You can even trigger this behavior from the caller side, e.g. `iter.return(42)`.

Note that `yield` can have a return value - this value is passed in by the caller of `next()`:

```
$ node
> function* foo() {
    const bar = yield 'a';
    console.log(bar);
}
> const iter = foo();
> iter.next();
{ value: 'a', done: false }
> iter.next(42);
42
```

You can even tell the `yield` to throw an exception, e.g. instread on `next(42)`:

```
> iter.throw('foobar');
Thrown: foobar
```

There's also an additional form - `yield*` - that delegates to another generator or iterable:

```Javascript
function* g1() {
  yield 2;
  yield 3;
}

function* g2(arr) {
  yield 1;
  yield* g1();
  yield* arr;
}

const iter = g2([4, 5]);
```

Roles played by generators
--------------------------

Aside: thanks to [ES6 generators in depth](http://2ality.com/2015/03/es6-generators.html#roles-played-by-generators) for much of the information in this section.

So generators can play three roles:

* Iterators (data producers).
* Observers (data consumers) - they can be data consumers that pause until a new value is pushed into them via `next()`.
* Coroutines (data producers and consumers) - as pausable producers and consumers, little is needed to turn them into coroutines (cooperatively multitasked tasks).

`next()`, `return()` and `throw()` actually make up the `Observer` interface (given in here in TypeScript syntax):

```TypeScript
interface Observer {
    next(value?: any): void;
    return(value?: any): void;
    throw(error): void;
}
```

We can create a data consumer like so:

```Javascript
function* dataConsumer() {
    console.log('Started');
    console.log(`1. ${yield}`);
    console.log(`2. ${yield}`);
}
```

Note: you'll have to kick off this consumer with an initial `next()` before you hit the first `yield` and can start feeding it values:

```Javascript
const consumer = dataConsumer();
next();

next('a');
next('b');
```

Example of a data consumer that adds line numbers:

```
$ node
> function* numberLines() {
    var lineNo = 1;
    while (true) {
        var line = yield;
        console.log(`${lineNo++}: ${line}`);
    }
}
> const g = numberLines();
> g.next();
> g.next('alpha');
1: alpha
> g.next('beta');
2: beta
```

Note: the node REPL shows the results of the next calls, i.e. `{ value: ..., done: ... }`, but I've omitted them as we're not interested in them here.

You could imagine the above being used with some asynchronous process that receives lines now and then and calls `next(line)` whenever it receives a line.

There are various Javascript libraries where this pattern of calling the generator function and then calling `next()` immediately are wrapped up in a trivial library function. So we could rewrite the above without the risk of forgetting the initial `next()` like so:

```Javascript
const numberLines = coroutine(function* () { ... });
const g = numberLines();
g.next('alpha');
```

Callbacks, promises and generators
----------------------------------

Originally for asynchronous operations it was always just callback hell. Callbacks nested within callbacks nested within...:

```Javascript
request('http://www.somepage.com', function (firstError, firstResponse, firstBody) {
    if (firstError){
        // Handle error.
    } else {
        request(`http://www.somepage.com/${firstBody.someValue}`, function (secondError, secondResponse, secondBody) {
            if(secondError){
                // Handle error.
            } else {
                // Use secondBody for something.
            }
        });
    }
});
```

Promises were eventually introduced as a nice solution to the callback hell of a sequence of asynchronous operations:

```Javascript
asyncThing1().then(function(response) {
  return asyncThing2();
}).then(function(response) {
  return asyncThing3();
}).then(function(response) {
  return asyncThing4();
}).then(function(response) {
  console.log("Success - final result:", response);
}).catch(function(err) {
  console.log("Failed!", error);
});
```

This chain of promises is a sequence of steps that looks a lot closer to a nice bit of synchronous code.

Note: there is one thing that we've lost in moving to promises, in the original callback example state accumulated as we proceeded through our steps, i.e. when we get `secondBody` we can still see `firstBody`. You don't get this for free in the same way with promises. When we come to using generators later we'll see that we get this back, i.e. state accumulates as we proceed through our generator function (just as it does in a normal function).

You can wrap up existing callback based logic as a promise like so:

```Javascript
function get(url) {
  return new Promise(function(resolve, reject) {
    var req = new XMLHttpRequest();
    req.open('GET', url);

    req.onload = function() {
      if (req.status == 200) {
        resolve(req.response);
      }
      else {
        reject(Error(req.statusText));
      }
    };

    req.send();
  });
}
```

In our old-school `onload` callback we call the `resolve` or `reject` methods of our promise. Note that in reality `XMLHttpRequest` is a bit more complicated and there are more failure situations that have to be handled.

Now that we've wrapped things up we can do things like this:

```Javascript
get('story.json').then(function(response) {
  return JSON.parse(response);
}).then(function(response) {
  console.log("Yey JSON!", response);
});
```

Actually we don't have to create an additional lambda for `JSON.parse`, we can just do:

```Javascript
get('story.json').then(JSON.parse).then(function(response) {
  console.log("Yey JSON!", response);
});
```

Aside: you'll see a lot of pointless lambdas later, e.g. `g(x => f(x))` rather than `g(f)`, on the basis that providing an explicit argument with a name _may_ make it clearer what's going on.

It's important to realize, to quote Domenic Denicola, that "`then` is not a mechanism for attaching callbacks to an aggregate collection. It’s a mechanism for applying a transformation to a promise, and yielding a new promise from that transformation."

So the `then` method of a promise itself returns a promise and (along with the `catch` method) allows promises to be chained, i.e. composed. The function passed to the `then` method often itself returns a promise (e.g. `function(url) { return get(url); }`) but can also return any arbitrary value (in this case when the function is invoked the value returned will be used to resolve the promise created by the `then`):

```Javascript
var promise = new Promise(function(resolve, reject) {
  resolve(1);
});

promise.then(function(val) {
  return val + 2;
}).then(function(val) {
  console.log(val); // 3
});
```

For a much more detailed walkthru of what's happening in promises and in `then` in particular see [`how-then-works`](how-then-works) here. Read this now - really! It's worth getting this clear before going further.

We could combine promises and generators to come up with something even closer to a nice sequence of synchronous calls. We'll also start using the nice new arrow syntax for lambdas:

```Javascript
function* printRandomArticle() {
    try {
        var html = yield;

        var md = hget(html, { markdown: true, root: 'main' });

        var txt = marked(md, { renderer: new marked.Renderer() });

        console.log(txt);
    } catch (err) {
        console.log(err);
    }
});

const g = printRandomArticle();
g.next();

get('https://ponyfoo.com/articles/random')
    .then(html => g.next(html)) // Or just ".then(g.next)"
    .catch(err => g.throw(err)) // Or just ".catch(g.throw)"
```

This looks kind of interesting but we've got bits of our logic in `printRandomArticle()` and bits in the place where we create the promise and the `yield` doesn't make for a very clear linkage between the two. But you can actually get quite far with this approach. The body of the the generator _function_ doesn't have access to the generator _objects_ it creates so you can't e.g. do:

```Javascript
get('https://ponyfoo.com/articles/random').then(g.next).catch(g.throw);
var html = yield
```

But it can yield promises and then leave it to some generic functionality outside it that just takes the produced generator objects and consumes its promises, wiring each up such that it will call `next` etc. on the generator. So you end up with something very clear in your generator function like this:

```Javascript
var html = yield get('https://ponyfoo.com/articles/random');
```

And then you need some library functionality outside to wire up the created generator objects appropriately. The article ["The Hidden Power of ES6 Generators"](https://medium.com/javascript-scene/the-hidden-power-of-es6-generators-observable-async-flow-control-cfa4c7f31435) takes you through how simple such functionality is - just search down for "the whole thing is about 22 lines of code" and just work thru the code block below that includes the implementation of `getsync` (our library functionality) followed by an example that makes use of it. Note that the example `asyncFunction` is called with parameters (`'param1'` etc.) even though the generator function passed to `getsync` doesn't want any arguments (but if it did it would get them as we see in the `next(fn(...args), ...)` logic in `getsync`).

As noted in the article there's a bit more to it (like error handling) and really you'd use a library like [co](https://github.com/tj/co). Or `await` and `async` - coming up next.

Note: you can only use `yield` directly within a generator function, you can't call it from within a lambda or other such constructs. So while the following is fine:

```Javascript
function* forEachGen(array, fn) { for (var i of array) yield* fn(i); }
```

This is not fine:

```Javascript
function* forEachGen(array, fn) { array.forEach(i => yield* fn(i)); }
```

Async and await
---------------

If you look at [co](https://github.com/tj/co) (the previously mentioned library that handles wiring up the promises yielded by generators) you'll see it describes itself now as just a "a stepping stone towards the async/await proposal."

`async` and `await` are just are just an extra level of sugar coating. We can rewrite our logic above replacing `function*` with `async` and `yield` with an `await` on a specific promise. It's important though to realize that our function now is something quite different - `function*` denotes a function that creates generators while `async` functions create promises.

```Javascript
async function printRandomArticle() {
    try {
        var html = await get('https://ponyfoo.com/articles/random');

        var md = hget(html, { markdown: true, root: 'main' });

        var txt = marked(md, { renderer: new marked.Renderer() });

        console.log(txt);
    } catch (err) {
        console.log(err);
    }
});
```

It's important to be aware that when you call `printRandomArticle()` you're _not_ invoking a function, you're creating a promise. The function body above has no return value but look:

```Javascript
var p = printRandomArticle(); // p is a promise.

p.then(() => console.log('Article has been printed');
```

Despite everything looking like normal sequential code you still have to think a bit about the order that things will happen:

```Javascript
async function foo() {
    console.log('2');
    var value = await Promise.resolve(4);
    console.log(value);
}

console.log('1');
foo().then(() => console.log('5'));
console.log('3');
```

This will print out 1, 2, 3, 4, 5. If this seems a little surprising then let's rewrite it using just promises:

```Javascript
function foo() {
    return new Promise(resolve => {
        console.log('2');
        Promise.resolve(4)
            .then(value => {
                console.log(value);
                resolve();
            });
    });
}

console.log('1');
foo().then(() => console.log('5'));
console.log('3');
```

Remember Javascript is single threaded. The executor function passed to the `Promise` constructor is not handed off to some other thread, instead it's executed immediately but the handler function passed to `then` is guaranteed to be called asynchronously.

I.e. even if the executor function involves no asynchronous tasks itself (such as making a HTTP request) the calling of the _fulfilled_ handler function will be queued as a microtask that will happen later.

```Javascript
var resolvedPromise = Promise.resolve(4);
var onFulfiled = i => console.log(i);

resolvedPromise.then(onFulfiled);
```

Our `resolvedPromise` is super simple, it already has its result, but the promise resulting from the `then`, despite the passed in function not involving any deferred operations, will not be resolved immediately. Instead its creation will result in something like the following happening:

```Javascript
queueMicrotask(() => {
  val v = onFulfiled(result);
  resolve(v);
});
```

I.e. the work will be queued for later (in our simple example `onFulfiled` doesn't have a useful return value). The Javascript engine will execute such microtask once the current task is finished, e.g. up above the main task will finish after `console.log('3');` and the engine will start executing any queued microtasks.

Note: the microtask seen here is clearly queued before we hit the end of our main task so it's there and does get executed before the engine exits. If e.g. you requested a web page via a method that returns a promise and then hit the end of your task before the web page you requested has been retrieved then it may not be entirely clear whether the engine will exit or not. Outstanding unresolved promises will _not_ cause the engine not to exit, however things will depend on how the logic around the call to a particular promise's `resolve(...)` is implemented. Often this is handled through [events](https://nodejs.org/api/events.html) with the promise resoluion triggered in a one-shot event handler (that deregisters itself when the event that triggers it finally occurs). The engine will _not_ exit while there are still handlers that have not yet been deregistered - so such promise resolving event handlers will result in the engine not exiting until they've all fired.

For a very nice walkthru of when promises and other logic result in tasks and microtasks and when these are executed by the engine see the article "[tasks, microtasks, queues and schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/)" by Jake Archibald (you can stop reading once he gets onto HTML tags in the browser and the like). It includes a nice little graphic walkthru where you can step through a piece of code and see what ends up on what queues and when things get executed.

So we've seen how `aync` allows us to more transparently create promises and how `await` is kind of like `yield` in that it pushes the current stack state until something else explicitly causes it to be popped and execution resumed. But who triggers resumption is a bit different between `await` and `yield`:

* In the case of `await` execution will always be resumed via a microtask, i.e. the relevant promise is resolved and a task placed on the microtask queue and when this task is taken off the queue and executed the `await` will return and execution continue within our `async` function.
* In the case of `yield` execution will resume via an explicit call to `next(...)` on the relevant generator in some of our code (rather than in the event dispatching code of the engine).

As `await` waits on promises and there's no difference between the promises created the classic way (`new Promise(...)` etc.) or with `async` you can do:

```Javascript
var alpha = Promise.resolve(42);

async function beta() { return 21; }

async function gamma(classic) {
    var value = await (classic ? alpha : beta());

    console.log(value);
}

gamma(true);
gamma(false);
console.log('Finished');
```

I.e. there's no difference between calling `await` on `beta()`, an `async` function that creates a promise, or on `alpha`, i.e. a promise created in the classic fashion.

Depending on how you like to think about things you may like to think of `async` being implemented in a similar fashion to `yield` with some kind of stack pushing and popping logic or you may prefer to think of it being rewritten behind the scenes to a `then(...)` call on its promise.

The rewritting is a little complex (you also have to take exceptions and scoping into account) but what you get afterwards is something you can reason about entirely in terms of classic simple Javascript - the microtasks queue and everything else are things you could code up in your own logic - whereas stack pushing and popping, while not much more complicated, is something that couldn't easily simulate in your own logic but needs to be supported in the engine itself (or handled by something like Babel's [transform-async-to-generator](https://babeljs.io/docs/plugins/transform-async-to-generator) that compiles your `async`/`await` code into Javascript that older engines can consume).

Limitations of await
--------------------

Promises are really quite flexible and that there are a lot of libraries built around doing interesting things with them and it turns out that `async` / `await` don't allow you to banish all explicit references to `Promise` from your code.

E.g. `Promise.all([ ... ])` allows you to wait on a number of promises:

```Javascript
async function alpha() { ... }
async function beta() { ... }

Promise.all([ alpha(), beta() ]);
```

You might naively implement this with `await` as:

```Javascript
await alpha();
await beta();
```

But here `beta()` won't start at all until `alpha()` has completed entirely. To get around this you'd have to do:

```Javascript
var p1 = alpha();
var p2 = beta();

// The executor functions of both promises have now already been invoked before we await anything.

await p1;
await p2;
```

Now awaiting on `p1` isn't stopping `p2` being resolved. But while you end up with the same behavior as `Promise.all(...)` then intention is less clear and the risk of messing up higher. As `Promise.all` itself returns a promise you're better off mixing `await` and `Promise.all` like so:

```Javascript
var [a, b] = await Promise.all([ alpha(), beta() ]);
```

Note: initially there was a proposal for a `await*` keyword that could take an iterable of promises but this was rejected as it was felt it would create the false impression that it was analagous to `yield*` (search for `await*` in the [April 10, 2014 ECMA meeting note](https://github.com/rwaldron/tc39-notes/blob/master/es6/2014-04/apr-10.md)).

Similarly bad is `Promise.race(...)`, take a look at the following:

```Javascript
function random(high) {
    // Generate a random number in the range [0, high).
    return Math.random() * high;
}

function alpha(message) {
    // Resolve to the given message after a random timeout of at most 2 seconds.
    return new Promise(resolve => {
        var ms = random(2000);
        setTimeout(() => resolve(message), ms);
    });
}

// Print out the result of the promise that is resolved first.
Promise.race([ alpha('a'), alpha('b') ])
    .then(message => console.log(message));
```

There's no way to ask `await` to give you the first result of multiple promises, so as with `Promise.all` you have to mix `await` and `Promise.race` like so:

```Javascript
var message = await Promise.race([ alpha('a'), alpha('b') ]);

console.log(message);
```

Further reading
---------------

There seems to be no end to how far one can go with all this. The next step seems to be asynchronous iterators, with a new for-await-of construct and using `async` with `function*`. These are discussed in the [ECMA asynchronous iterators proposal](https://github.com/tc39/proposal-async-iteration) which is only just being introduced into engines (it first made it into the V8 engine in Chrome 63 released in December 2017).

Axel Rauschmayer discusses all this in detail in the article "[ES2018: asynchronous iteration](http://2ality.com/2016/10/asynchronous-iteration.html)", however in his [conclusion](http://2ality.com/2016/10/asynchronous-iteration.html#is-async-iteration-worth-it) he does discuss whether it's all worth it and notes that "async iteration brings with it considerable additional cognitive load."

I'd say this is already true for `async`/`await` - it may result in cleaner looking code than chaining promises but it seems to me that the pushing and popping of stack frames is far harder to think clearly about than what's happening when one explicitly uses promises.

Axel mentions Reactive, i.e. for Javascript [RxJS](https://github.com/ReactiveX/RxJS), as an alternative approach.

Eric Elliot also mentions RxJS in his "[The Hidden Power of ES6 Generators](https://medium.com/javascript-scene/the-hidden-power-of-es6-generators-observable-async-flow-control-cfa4c7f31435)" article in the section "From Promises to Observables". In this section he discusses moving from promises (that can only emit one value) to observables (that can emit many values over time). He also references the "[General Theory of Reactivity](https://github.com/kriskowal/gtor)" presentation that looks like it might itself be interesting to go through.

Note: don't get `Observable` mixed up with `Observer` which was mentioned up above. The `Observer` interface discussed up there combines with the `Iterator` interface to form the [`Generator` interface](http://2ality.com/2015/03/es6-generators.html#the-full-generator-interface). In Reactive you have both [observers](http://reactivex.io/RxJava/2.x/javadoc/io/reactivex/Observer.html) and [observables](http://reactivex.io/RxJava/2.x/javadoc/io/reactivex/Observable.html) - for a discussion of the relationship between the two see [here](http://reactivex.io/documentation/observable.html).
