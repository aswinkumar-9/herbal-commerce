import {
  CalendarCheck,
  CheckCircle,
  Flask,
  Leaf,
  Plus,
  SealCheck,
} from '@phosphor-icons/react';
import { Fragment } from 'react';
import fields960 from '../art/fields-960.webp';
import fields1672 from '../art/fields-1672.webp';
import heroTall640 from '../art/hero-tall-640.webp';
import heroTall941 from '../art/hero-tall-941.webp';
import heroWide960 from '../art/hero-wide-960.webp';
import heroWide1672 from '../art/hero-wide-1672.webp';
import previewHome from '../art/preview-home.jpg';
import roots640 from '../art/roots-640.webp';
import roots1254 from '../art/roots-1254.webp';
import { listCategories } from '../catalog.server.ts';
import { getConfig } from '../config.server.ts';
import { Reveal, Tagline } from '../components/Reveal.tsx';
import { GOLD_PILL, GOLD_PILL_LARGE } from '../components/pills.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/home';

// The home page (part 14A, the website's rules part A): one action, to
// shop the herbs, and only what is true of the shop. The owner's pictures
// carry the colour; text on them sits on a scrim.
const home = text.home;
const PROMISE_ICONS = [Leaf, Flask, SealCheck, CalendarCheck] as const;

export async function loader({ request }: Route.LoaderArgs) {
  return {
    categories: await listCategories(request),
    origin: getConfig().origin,
  };
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const title = `${text.shop.name} · ${home.title}`;
  return loaderData
    ? pageMeta({
        title,
        description: home.description,
        origin: loaderData.origin,
        path: '/',
        image: {
          src: previewHome,
          alt: home.previewAlt,
          width: 1200,
          height: 630,
        },
      })
    : [{ title }];
};

export default function Home({ loaderData }: Route.ComponentProps) {
  const { categories } = loaderData;
  return (
    <>
      <Hero />
      <Promises />
      <Fields />
      <section
        aria-label={home.tagline.join(' ')}
        className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-24 md:grid-cols-12"
      >
        <Reveal className="order-2 md:order-1 md:col-span-5">
          <img
            src={roots1254}
            srcSet={`${roots640} 640w, ${roots1254} 1254w`}
            sizes="(min-width: 48rem) 28rem, 100vw"
            width={1254}
            height={1254}
            alt=""
            loading="lazy"
            decoding="async"
            className="aspect-square w-full rounded-3xl object-cover"
          />
        </Reveal>
        <div className="order-1 md:order-2 md:col-span-7">
          <Tagline lines={home.tagline} />
        </div>
      </section>
      <Steps />
      <section
        id="shop"
        aria-labelledby="shop-heading"
        className="mx-auto flex w-full max-w-6xl scroll-mt-24 flex-col gap-8 px-6 py-24"
      >
        <Reveal className="flex flex-col gap-8">
          <h2 id="shop-heading" className="heading-4 text-ink md:heading-3">
            {home.categories.heading}
          </h2>
          {categories.length === 0 ? (
            <p className="body-3 text-ink-muted">{home.categories.empty}</p>
          ) : (
            <ul className="flex flex-wrap gap-3">
              {categories.map((category) => (
                <li
                  key={category.slug}
                  className="title-3 rounded-full border border-line-strong px-6 py-3 text-ink"
                >
                  {category.name}
                </li>
              ))}
            </ul>
          )}
        </Reveal>
      </section>
      <Questions />
      <Closing />
    </>
  );
}

// The first screen: the owner's picture across it (a tall one on a phone
// held upright), the words over a veil at the foot, one gold pill.
function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative isolate flex min-h-svh flex-col justify-end overflow-hidden"
    >
      <picture>
        <source
          media="(max-width: 47.999rem) and (orientation: portrait)"
          srcSet={`${heroTall640} 640w, ${heroTall941} 941w`}
          sizes="100vw"
          width={941}
          height={1672}
        />
        <img
          src={heroWide1672}
          srcSet={`${heroWide960} 960w, ${heroWide1672} 1672w`}
          sizes="100vw"
          width={1672}
          height={941}
          alt=""
          fetchPriority="high"
          decoding="async"
          className="animate-settle absolute inset-0 -z-20 size-full object-cover"
        />
      </picture>
      {/* The veil rises behind the words, however many lines they wrap to. */}
      <div className="scrim-rise w-full pt-24">
        <div className="animate-rise-in mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-6 pb-16 text-white md:pb-24">
          <h1 id="hero-heading" className="heading-3 max-w-170 md:heading-1">
            {home.hero.heading.map((line, index) => (
              <Fragment key={line}>
                {index > 0 ? ' ' : null}
                <span className="block">{line}</span>
              </Fragment>
            ))}
          </h1>
          <p className="body-3 max-w-170 md:title-1">{home.hero.body}</p>
          <a href="#shop" className={GOLD_PILL_LARGE}>
            {home.hero.cta}
          </a>
          <ul className="caption-1 flex flex-wrap gap-x-6 gap-y-2">
            {home.hero.proof.map((fact) => (
              <li key={fact} className="flex items-center gap-2">
                <CheckCircle
                  aria-hidden="true"
                  weight="light"
                  className="size-4 shrink-0 text-gold"
                />
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Promises() {
  return (
    <section
      aria-labelledby="promises-heading"
      className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-24"
    >
      <Reveal>
        <h2 id="promises-heading" className="heading-4 text-ink md:heading-3">
          {home.promises.heading}
        </h2>
      </Reveal>
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {home.promises.items.map((item, index) => {
          const Icon = PROMISE_ICONS[index] ?? Leaf;
          return (
            <li key={item.title}>
              <Reveal className="flex h-full flex-col gap-4 rounded-3xl bg-surface p-8">
                <Icon
                  aria-hidden="true"
                  weight="light"
                  className="size-8 text-accent"
                />
                <h3 className="title-1 text-ink">{item.title}</h3>
                <p className="body-6 text-ink-muted">{item.body}</p>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The owner's fields: the picture with its words on a veil.
function Fields() {
  return (
    <section
      aria-labelledby="fields-heading"
      className="mx-auto w-full max-w-6xl px-6 py-12"
    >
      <Reveal>
        <figure className="relative isolate flex min-h-120 flex-col justify-end overflow-hidden rounded-3xl md:aspect-video md:min-h-0">
          <img
            src={fields1672}
            srcSet={`${fields960} 960w, ${fields1672} 1672w`}
            sizes="(min-width: 72rem) 72rem, 100vw"
            width={1672}
            height={941}
            alt={home.fields.alt}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 -z-20 size-full object-cover"
          />
          <figcaption className="scrim-rise flex flex-col gap-3 px-8 pt-24 pb-8 text-white md:px-12 md:pb-12">
            <h2
              id="fields-heading"
              className="heading-5 max-w-170 md:heading-3"
            >
              {home.fields.heading}
            </h2>
            <p className="body-3 max-w-170">{home.fields.body}</p>
          </figcaption>
        </figure>
      </Reveal>
    </section>
  );
}

function Steps() {
  return (
    <section
      aria-labelledby="steps-heading"
      className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-24"
    >
      <Reveal>
        <h2 id="steps-heading" className="heading-4 text-ink md:heading-3">
          {home.steps.heading}
        </h2>
      </Reveal>
      <ol className="grid gap-6 md:grid-cols-3">
        {home.steps.items.map((step, index) => (
          <li key={step.title}>
            <Reveal className="flex flex-col gap-3 border-t border-line-strong pt-6">
              <span className="caption-3 text-primary">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="title-1 text-ink">{step.title}</h3>
              <p className="body-6 text-ink-muted">{step.body}</p>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Plain questions and answers; each opens without a script.
function Questions() {
  return (
    <section
      aria-labelledby="questions-heading"
      className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-24"
    >
      <Reveal>
        <h2 id="questions-heading" className="heading-4 text-ink md:heading-3">
          {home.questions.heading}
        </h2>
      </Reveal>
      <Reveal className="flex flex-col gap-3">
        {home.questions.items.map((item) => (
          <details
            key={item.question}
            className="group rounded-3xl bg-surface px-6 py-4"
          >
            <summary className="title-2 flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl py-2 text-ink [&::-webkit-details-marker]:hidden">
              {item.question}
              <Plus
                aria-hidden="true"
                weight="light"
                className="size-6 shrink-0 text-primary transition-transform duration-300 group-open:rotate-45"
              />
            </summary>
            <p className="body-3 pt-2 pb-2 text-ink-muted">{item.answer}</p>
          </details>
        ))}
      </Reveal>
    </section>
  );
}

function Closing() {
  return (
    <section
      aria-labelledby="closing-heading"
      className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-6 pt-12 pb-24 text-center"
    >
      <Reveal className="flex flex-col items-center gap-8">
        <h2
          id="closing-heading"
          className="heading-4 text-hero max-w-170 md:heading-2"
        >
          {home.closing.heading}
        </h2>
        <a href="#shop" className={GOLD_PILL}>
          {home.closing.cta}
        </a>
      </Reveal>
    </section>
  );
}
