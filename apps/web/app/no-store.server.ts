import type { MiddlewareFunction } from 'react-router';

// For a page whose address holds a secret, such as the token of an emailed
// link (part 14B): no cache may keep it.
export const keepOutOfCaches: MiddlewareFunction<Response> = async (
  _args,
  next,
) => {
  const response = await next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
};
