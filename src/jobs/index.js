const { RetryOutgoingMessagesJob } = require('./retryOutgoingMessages.job');
const { ResyncContactsJob } = require('./resyncContacts.job');

/**
 * Background worker registry. Jobs share the repository/logger singletons
 * and are started/stopped by the server lifecycle (see src/server.js).
 */
function createJobs() {
  return {
    retryOutgoing: new RetryOutgoingMessagesJob(),
    resyncContacts: new ResyncContactsJob(),
  };
}

function startJobs(jobs) {
  const started = [];
  for (const [name, job] of Object.entries(jobs)) {
    if (job && typeof job.start === 'function') {
      job.start();
      started.push(name);
    }
  }
  return started;
}

function stopJobs(jobs) {
  for (const job of Object.values(jobs)) {
    if (job && typeof job.stop === 'function') job.stop();
  }
}

module.exports = { createJobs, startJobs, stopJobs };
