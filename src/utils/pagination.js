/**
 * List metadata shared by every paginated endpoint. Keeps the response
 * envelope consistent: { total, limit, offset, page, pages, hasMore }.
 */
function paginateMeta({ total = 0, limit = 50, offset = 0 } = {}) {
  const safeLimit = limit > 0 ? limit : 50;
  const page = Math.floor(offset / safeLimit) + 1;
  const pages = Math.max(1, Math.ceil(total / safeLimit));
  return {
    total,
    limit: safeLimit,
    offset,
    page,
    pages,
    hasMore: offset + safeLimit < total,
  };
}

module.exports = { paginateMeta };
