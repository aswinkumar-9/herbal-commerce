import { Leaf } from '@phosphor-icons/react';
import { useState } from 'react';
import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import type { ProductImage } from '../catalog.server.ts';
import { text } from '../text/en.ts';

// The API's small file fits 400 px on its longest side (SMALL_SIDE).
const SMALL_SIDE = 400;

// The small file's size, from the large one's.
export function smallSize({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const scale = Math.min(1, SMALL_SIDE / Math.max(width, height));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

// A product's photos: one large, in a square that keeps its place while it
// loads, and the others as thumbnails that show it in its place. Without a
// script, a thumbnail is a link to the page with that photo shown.
export function Gallery({
  images,
  first,
}: {
  images: readonly ProductImage[];
  first: number;
}) {
  const [shown, setShown] = useState(first);
  // The photo the page opened with loads first; a chosen one fades in.
  const [chosen, setChosen] = useState(false);
  const image = images[shown] ?? images[0];

  if (!image) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-3xl bg-surface">
        <Leaf
          aria-hidden="true"
          weight="light"
          className="size-16 text-ink-muted"
        />
      </div>
    );
  }

  const choose =
    (index: number) =>
    (event: MouseEvent<HTMLAnchorElement>): void => {
      // Opening it in a new tab still works as a link.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      setShown(index);
      setChosen(true);
    };
  const small = smallSize(image);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-3xl bg-surface">
        <img
          key={image.url}
          src={image.url}
          srcSet={`${image.thumbnailUrl} ${small.width}w, ${image.url} ${image.width}w`}
          sizes="(min-width: 64rem) 34rem, 100vw"
          width={image.width}
          height={image.height}
          alt={image.altText}
          fetchPriority={chosen ? undefined : 'high'}
          decoding="async"
          className={`size-full object-contain${chosen ? ' animate-fade-in' : ''}`}
        />
      </div>
      {images.length > 1 ? (
        <ul
          aria-label={text.productPage.photos}
          className="flex flex-wrap gap-3"
        >
          {images.map((each, index) => {
            const thumbnail = smallSize(each);
            return (
              <li key={each.url}>
                <Link
                  to={`?photo=${index + 1}`}
                  replace
                  preventScrollReset
                  onClick={choose(index)}
                  aria-label={text.productPage.showPhoto(
                    index + 1,
                    images.length,
                  )}
                  aria-current={index === shown ? 'true' : undefined}
                  className="block size-20 overflow-hidden rounded-2xl bg-surface ring-2 ring-transparent transition hover:ring-line-strong active:scale-98 aria-[current=true]:ring-primary"
                >
                  <img
                    src={each.thumbnailUrl}
                    alt=""
                    width={thumbnail.width}
                    height={thumbnail.height}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
