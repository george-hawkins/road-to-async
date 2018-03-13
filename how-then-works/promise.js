function Promise(executorFn) {
  var state = 'pending';
  var value;
  var deferred = null;

  function resolve(newValue) {
    value = newValue;
    state = 'resolved';

    if (deferred) {
      handle(deferred);
    }
  }

  function handle(handler) {
    if (state === 'pending') {
      deferred = handler;
      return;
    }

    if (!handler.onResolved) {
      handler.resolve(value);
      return;
    }

    queueMicrotask(() => {
      var ret = handler.onResolved(value);
      handler.resolve(ret);
    });
  }
  
  var parent = this;

  this.then = function(onResolved) {
    var childExecutorFn = childResolveMethod => {
      var handler = {
        onResolved: onResolved,
        resolve: childResolveMethod
      };
      parent.handle(handler);
    };
    var child = new Promise(childExecutorFn);
    
    return child;
  };

  executorFn(resolve);
}