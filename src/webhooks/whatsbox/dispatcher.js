/**
 * Routes canonical webhook events to the responsible domain handler.
 * Handlers are injected so the controller stays testable and the
 * incoming/status implementations can be swapped independently.
 */
class WebhookDispatcher {
  constructor({ messageHandler, statusHandler }) {
    this.messageHandler = messageHandler;
    this.statusHandler = statusHandler;
  }

  async dispatch(canonical, context = {}) {
    if (!canonical || !canonical.event) {
      return { handled: false, skipped: true, reason: 'no-event' };
    }

    if (canonical.event === 'message') {
      return this.messageHandler.handle(canonical, context);
    }

    if (canonical.event === 'status') {
      return this.statusHandler.handle(canonical, context);
    }

    return { handled: false, skipped: true, reason: `unknown-event:${canonical.event}` };
  }
}

module.exports = { WebhookDispatcher };
