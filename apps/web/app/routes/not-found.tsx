import { data } from 'react-router';
import { NotFoundPage } from '../components/StatusPages.tsx';

// Any address the website doesn't have: the "not found" page, with the
// status 404, so search engines drop it.
export function loader() {
  return data(null, { status: 404 });
}

export default function NotFound() {
  return <NotFoundPage />;
}
