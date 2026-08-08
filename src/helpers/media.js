const { MESSAGE_TYPE } = require('../constants');

/**
 * Maps a provider-neutral media descriptor (mime type + filename) to the
 * type each layer understands:
 *
 *   providerType - the value the WhatsApp send APIs accept
 *                  (image | video | audio | document)
 *   dbType       - the local Message.type stored on the row
 *
 * Symmetric with the inbound normalizers and the retry job's
 * TYPE_TO_WHATSBOX map, so an attachment stored on a message can always
 * be re-sent through the same provider.
 */

function mediaTypeFromMime(mimeType = '', filename = '') {
  const mime = String(mimeType || '').toLowerCase();
  const name = String(filename || '').toLowerCase();

  if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg|heic)$/.test(name)) {
    return { providerType: 'image', dbType: MESSAGE_TYPE.IMAGE };
  }
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv|m4v)$/.test(name)) {
    return { providerType: 'video', dbType: MESSAGE_TYPE.VIDEO };
  }
  if (mime.startsWith('audio/') || /\.(mp3|ogg|m4a|wav|aac|opus)$/.test(name)) {
    return { providerType: 'audio', dbType: MESSAGE_TYPE.AUDIO };
  }
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return { providerType: 'document', dbType: MESSAGE_TYPE.PDF };
  }
  return { providerType: 'document', dbType: MESSAGE_TYPE.DOCUMENT };
}

module.exports = { mediaTypeFromMime };
