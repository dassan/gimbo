import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ChevronDown,
  Receipt,
  CreditCard,
  BarChart3,
  Landmark,
  HeartPulse,
  PiggyBank,
  HardDrive,
  FileJson,
  FolderSync,
  Ban,
  UserX,
  Gift,
  Smartphone,
} from 'lucide-react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { cn } from '@/lib/utils'
import type { Locale } from '@/types'

export default function Landing() {
  const { t, i18n } = useTranslation()
  const locale = useWorkspaceStore((s) => s.workspace.locale)
  const setLocale = useWorkspaceStore((s) => s.setLocale)

  function toggleLocale() {
    const next: Locale = locale === 'pt-BR' ? 'en-US' : 'pt-BR'
    setLocale(next)
    void i18n.changeLanguage(next)
  }

  const features = [
    { icon: Receipt, title: t('landing.features.f1Title'), body: t('landing.features.f1Body') },
    {
      icon: CreditCard,
      title: t('landing.features.f2Title'),
      body: t('landing.features.f2Body'),
    },
    {
      icon: BarChart3,
      title: t('landing.features.f3Title'),
      body: t('landing.features.f3Body'),
    },
    { icon: Landmark, title: t('landing.features.f4Title'), body: t('landing.features.f4Body') },
    {
      icon: HeartPulse,
      title: t('landing.features.f5Title'),
      body: t('landing.features.f5Body'),
    },
    {
      icon: PiggyBank,
      title: t('landing.features.f6Title'),
      body: t('landing.features.f6Body'),
    },
  ]

  const pillars = [
    {
      icon: HardDrive,
      title: t('landing.privacy.pillar1Title'),
      body: t('landing.privacy.pillar1Body'),
    },
    {
      icon: FileJson,
      title: t('landing.privacy.pillar2Title'),
      body: t('landing.privacy.pillar2Body'),
    },
    {
      icon: FolderSync,
      title: t('landing.privacy.pillar3Title'),
      body: t('landing.privacy.pillar3Body'),
    },
  ]

  const trustItems = [
    { icon: Ban, label: t('landing.trust.item1') },
    { icon: UserX, label: t('landing.trust.item2') },
    { icon: Gift, label: t('landing.trust.item3') },
    { icon: Smartphone, label: t('landing.trust.item4') },
  ]

  const faqItems = [
    { q: t('landing.faq.q1'), a: t('landing.faq.a1') },
    { q: t('landing.faq.q2'), a: t('landing.faq.a2') },
    { q: t('landing.faq.q3'), a: t('landing.faq.a3') },
    { q: t('landing.faq.q4'), a: t('landing.faq.a4') },
    { q: t('landing.faq.q5'), a: t('landing.faq.a5') },
    { q: t('landing.faq.q6'), a: t('landing.faq.a6') },
    { q: t('landing.faq.q7'), a: t('landing.faq.a7') },
    { q: t('landing.faq.q8'), a: t('landing.faq.a8') },
  ]

  return (
    <div className="min-h-screen bg-surface">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-outline-variant/0">
        <div
          className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3"
          style={{
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
          }}
        >
          <div className="absolute inset-0 -z-10 bg-surface/80" />
          <GimboLogo />

          <nav className="hidden items-center gap-8 md:flex">
            <a
              href="#funcionalidades"
              className="text-sm text-on-surface/60 transition-colors hover:text-on-surface"
            >
              {t('landing.nav.features')}
            </a>
            <a
              href="#privacidade"
              className="text-sm text-on-surface/60 transition-colors hover:text-on-surface"
            >
              {t('landing.nav.privacy')}
            </a>
            <a
              href="#faq"
              className="text-sm text-on-surface/60 transition-colors hover:text-on-surface"
            >
              {t('landing.nav.faq')}
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleLocale}
              className="rounded-full px-2 py-1 text-base transition-opacity hover:opacity-70"
              aria-label="Toggle language"
            >
              {locale === 'pt-BR' ? '🇧🇷' : '🇺🇸'}
            </button>
            <Link
              to="/onboarding"
              className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-110 active:scale-[0.97]"
            >
              {t('landing.nav.cta')}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-7xl px-6 pt-16 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="label inline-block rounded-full bg-primary/10 px-3 py-1.5 text-primary">
              {t('landing.hero.eyebrow')}
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-[1.15] tracking-tight text-on-surface lg:text-5xl xl:text-6xl">
              {t('landing.hero.headline')}
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-on-surface/60">
              {t('landing.hero.subtitle')}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                to="/onboarding"
                className="flex items-center gap-2 rounded-2xl bg-primary px-6 py-4 text-sm font-semibold text-on-primary transition hover:brightness-110 active:scale-[0.97]"
              >
                {t('landing.hero.ctaPrimary')}
                <ArrowRight size={16} strokeWidth={2.5} />
              </Link>
              <a
                href="#funcionalidades"
                className="rounded-2xl px-6 py-4 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
              >
                {t('landing.hero.ctaSecondary')}
              </a>
            </div>

            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3">
              {trustItems.map((item, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-on-surface/50">
                  <item.icon size={14} strokeWidth={1.5} />
                  {item.label}
                </div>
              ))}
            </div>
          </div>

          <HeroMock />
        </div>
      </section>

      {/* ── Steps ── */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-on-surface/40">
          {t('landing.steps.title')}
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            { title: t('landing.steps.step1Title'), body: t('landing.steps.step1Body') },
            { title: t('landing.steps.step2Title'), body: t('landing.steps.step2Body') },
            { title: t('landing.steps.step3Title'), body: t('landing.steps.step3Body') },
          ].map((step, i) => (
            <div key={i} className="rounded-2xl bg-surface-container-lowest p-6 shadow-card">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {i + 1}
              </span>
              <p className="mt-4 text-base font-semibold text-on-surface">{step.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-on-surface/60">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Funcionalidades ── */}
      <section id="funcionalidades" className="mx-auto max-w-7xl scroll-mt-20 px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="whitespace-pre-line text-3xl font-bold tracking-tight text-on-surface">
            {t('landing.features.title')}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-on-surface/60">
            {t('landing.features.subtitle')}
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <div
              key={i}
              className="rounded-2xl bg-surface-container-lowest p-6 shadow-card transition hover:shadow-card-ambient hover:-translate-y-0.5"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.icon size={20} strokeWidth={1.5} />
              </span>
              <p className="mt-4 text-base font-semibold text-on-surface">{f.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-on-surface/60">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Privacidade ── */}
      <section
        id="privacidade"
        className="scroll-mt-20 bg-[#143326] py-16 text-white dark:bg-surface-container"
      >
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              <Trans
                i18nKey="landing.privacy.title"
                components={{ hl: <span className="text-[#D4A017]" /> }}
              />
            </h2>
            <p className="mt-4 text-base leading-relaxed text-white/60 dark:text-on-surface/60">
              {t('landing.privacy.intro')}
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {pillars.map((p, i) => (
              <div key={i} className="rounded-2xl bg-white/5 p-6 dark:bg-surface-container-high">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white dark:bg-primary/10 dark:text-primary">
                  <p.icon size={20} strokeWidth={1.5} />
                </span>
                <p className="mt-4 text-base font-semibold">{p.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/60 dark:text-on-surface/60">
                  {p.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-2">
            <Link
              to="/why-local-storage"
              className="text-sm text-white/70 underline-offset-4 hover:text-white hover:underline dark:text-primary dark:hover:text-primary/80"
            >
              {t('landing.privacy.linkWhyBrowser')}
            </Link>
            <Link
              to="/privacy"
              className="text-sm text-white/70 underline-offset-4 hover:text-white hover:underline dark:text-primary dark:hover:text-primary/80"
            >
              {t('landing.privacy.linkPolicy')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="mx-auto max-w-2xl scroll-mt-20 px-6 py-16">
        <h2 className="text-center text-3xl font-bold tracking-tight text-on-surface">
          {t('landing.faq.title')}
        </h2>

        <div className="mt-10 space-y-3">
          {faqItems.map((item, i) => (
            <FaqItem key={i} question={item.q} answer={item.a} />
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="rounded-3xl bg-primary px-8 py-14 text-center shadow-ambient">
          <h2 className="text-3xl font-bold tracking-tight text-on-primary lg:text-4xl">
            {t('landing.finalCta.title')}
          </h2>
          <p className="mt-3 text-base text-on-primary/80">{t('landing.finalCta.subtitle')}</p>
          <Link
            to="/onboarding"
            className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-on-primary px-6 py-4 text-sm font-semibold text-primary transition hover:brightness-95 active:scale-[0.97]"
          >
            {t('landing.finalCta.cta')}
            <ArrowRight size={16} strokeWidth={2.5} />
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-outline-variant px-6 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <GimboLogo compact />
            <span className="text-xs text-on-surface/40">{t('landing.footer.tagline')}</span>
          </div>
          <div className="flex gap-6">
            <Link
              to="/privacy"
              className="text-xs text-on-surface/50 transition-colors hover:text-on-surface"
            >
              {t('landing.footer.privacy')}
            </Link>
            <Link
              to="/terms"
              className="text-xs text-on-surface/50 transition-colors hover:text-on-surface"
            >
              {t('landing.footer.terms')}
            </Link>
            <Link
              to="/origin"
              className="text-xs text-on-surface/50 transition-colors hover:text-on-surface"
            >
              {t('landing.footer.origin')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ─── Hero mock: illustrative preview card built from real design tokens ──────

function HeroMock() {
  const { t } = useTranslation()
  const bars = [
    { label: t('landing.hero.mockCategory1'), pct: 88, color: 'bg-[#2D6A4F]' },
    { label: t('landing.hero.mockCategory2'), pct: 62, color: 'bg-[#1B4F72]' },
    { label: t('landing.hero.mockCategory3'), pct: 40, color: 'bg-[#D4A017]' },
    { label: t('landing.hero.mockCategory4'), pct: 22, color: 'bg-[#A8AA9F]' },
  ]

  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-sm rounded-3xl bg-[#143326] p-6 text-white shadow-ambient sm:p-8"
    >
      <p className="label text-white/50">{t('landing.hero.mockLabel')}</p>
      <p className="mt-2 text-4xl font-medium tabular-nums" style={{ letterSpacing: '-0.03em' }}>
        {t('landing.hero.mockValue')}
      </p>
      <p className="mt-1 text-xs font-medium text-[#3D9E82]">{t('landing.hero.mockDelta')}</p>

      <div className="mt-8 space-y-3">
        {bars.map((bar, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>{bar.label}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={cn('h-full rounded-full', bar.color)}
                style={{ width: `${bar.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── FAQ item ─────────────────────────────────────────────────────────────

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-on-surface">{question}</span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={cn(
            'shrink-0 text-on-surface/40 transition-transform duration-250',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && <p className="px-6 pb-4 text-sm leading-relaxed text-on-surface/60">{answer}</p>}
    </div>
  )
}

// ─── Logo ─────────────────────────────────────────────────────────────────

function GimboLogo({ compact = false }: { compact?: boolean }) {
  const size = compact ? 28 : 36
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect width="48" height="48" rx="10" fill="#2D6A4F" />
        <text
          x="24"
          y="34"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="28"
          fontWeight="600"
          fill="#FFFFFF"
          textAnchor="middle"
        >
          G
        </text>
      </svg>
      {!compact && (
        <span className="text-xl font-bold tracking-tight text-on-surface">
          Gim<span className="text-[#D4A017]">bo</span>
        </span>
      )}
    </Link>
  )
}
