import { listCategories } from '../catalog.server.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/home';

// The home page. For now, the categories, as the API lists them; the full
// page, with the owner's pictures, comes next (part 14A, step 2).
export async function loader({ request }: Route.LoaderArgs) {
  return { categories: await listCategories(request) };
}

export const meta: Route.MetaFunction = () => [
  { title: text.home.title },
  { name: 'description', content: text.home.description },
];

export default function Home({ loaderData }: Route.ComponentProps) {
  const { categories } = loaderData;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 pt-40 pb-24">
      <h1 className="heading-2 text-hero max-w-[680px]">{text.home.heading}</h1>
      <section aria-labelledby="categories" className="flex flex-col gap-4">
        <h2 id="categories" className="heading-5 text-ink">
          {text.home.categories}
        </h2>
        {categories.length === 0 ? (
          <p className="body-3 text-ink-muted">{text.home.noCategories}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <li
                key={category.slug}
                className="body-5 rounded-full border border-line px-4 py-2 text-ink"
              >
                {category.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
