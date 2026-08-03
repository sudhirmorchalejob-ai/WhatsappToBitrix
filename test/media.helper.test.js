const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mediaTypeFromMime } = require('../src/helpers/media');
const { MESSAGE_TYPE } = require('../src/constants');

test('maps image mime and image extensions to image/IMAGE', () => {
  assert.deepEqual(mediaTypeFromMime('image/jpeg', 'photo.jpg'), { providerType: 'image', dbType: MESSAGE_TYPE.IMAGE });
  assert.deepEqual(mediaTypeFromMime('', 'screenshot.PNG'), { providerType: 'image', dbType: MESSAGE_TYPE.IMAGE });
});

test('maps video mime and extensions to video/VIDEO', () => {
  assert.deepEqual(mediaTypeFromMime('video/mp4', 'clip.mp4'), { providerType: 'video', dbType: MESSAGE_TYPE.VIDEO });
});

test('maps audio mime and extensions to audio/AUDIO', () => {
  assert.deepEqual(mediaTypeFromMime('audio/mpeg', 'note.mp3'), { providerType: 'audio', dbType: MESSAGE_TYPE.AUDIO });
});

test('maps PDF by mime or extension to document/PDF', () => {
  assert.deepEqual(mediaTypeFromMime('application/pdf', 'doc.pdf'), { providerType: 'document', dbType: MESSAGE_TYPE.PDF });
  assert.deepEqual(mediaTypeFromMime('', 'invoice.PDF'), { providerType: 'document', dbType: MESSAGE_TYPE.PDF });
});

test('falls back to document/DOCUMENT for unknown types', () => {
  assert.deepEqual(mediaTypeFromMime('application/octet-stream', 'archive.zip'), {
    providerType: 'document',
    dbType: MESSAGE_TYPE.DOCUMENT,
  });
  assert.deepEqual(mediaTypeFromMime(null, null), { providerType: 'document', dbType: MESSAGE_TYPE.DOCUMENT });
});
